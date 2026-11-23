import type { FastifyInstance } from 'fastify'
import type { Pool, PoolClient } from 'pg'
import { randomUUID } from 'node:crypto'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { z } from 'zod'
import { requireUser } from '../../shared/security.js'
import { fail } from '../../shared/errors.js'
import { idSchema, bodySchema } from '../../shared/validation.js'
import { encryptPrivate, decryptPrivate } from '../../shared/crypto.js'
import { transaction } from '../../db/pool.js'

const partSize = 3 * 1024 * 1024
type Actor = { id: string; role: string }
type Upload = {
  id: string
  owner_id: string
  purpose: string
  resource_id: string
  name: string
  mime_type: string
  size: number
  parts: number
  media_id: string | null
  expires_at: Date
}
type Dependencies = {
  authorize: (user: Actor, purpose: string, resourceId: string, connection?: PoolClient) => Promise<void>
  save: (
    user: Actor,
    purpose: string,
    resourceId: string,
    file: { filename: string; mimetype: string; bytes: Buffer },
    connection?: PoolClient,
  ) => Promise<{ media: { id: string } }>
  storage: () => S3Client
  bucket: () => string
  dto: (row: any) => unknown
}
const partKey = (id: string, part: number) => `uploads/${id}/${part}`

async function removeParts(client: S3Client, bucket: string, upload: Upload) {
  for (let part = 0; part < upload.parts; part++)
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: partKey(upload.id, part),
      }),
    )
}

export async function cleanupMediaUploads(
  pool: Pool,
  storage: () => S3Client,
  bucket: string,
) {
  const client = storage()
  try {
    return await transaction(pool, async (db) => {
      const { rows } = await db.query<Upload>(
        'SELECT * FROM media_uploads WHERE expires_at <= now() ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT 25',
      )
      for (const upload of rows) {
        await removeParts(client, bucket, upload)
        await db.query('DELETE FROM media_uploads WHERE id=$1', [upload.id])
      }
      return rows.length
    })
  } finally {
    client.destroy()
  }
}

export async function deletePendingUploads(
  pool: Pool,
  storage: () => S3Client,
  bucket: string,
  ownerId: string,
  purpose?: string,
) {
  const client = storage()
  try {
    await transaction(pool, async (db) => {
      const { rows } = await db.query<Upload>(
        'SELECT * FROM media_uploads WHERE owner_id=$1 AND ($2::text IS NULL OR purpose=$2) FOR UPDATE',
        [ownerId, purpose || null],
      )
      for (const upload of rows) {
        await removeParts(client, bucket, upload)
        await db.query('DELETE FROM media_uploads WHERE id=$1', [upload.id])
      }
    })
  } finally {
    client.destroy()
  }
}

export async function mediaUploadRoutes(
  app: FastifyInstance,
  pool: Pool,
  dependencies: Dependencies,
) {
  const schema = {
    tags: ['Arquivos privados'],
    response: { '2xx': { type: 'object', additionalProperties: true } },
  }
  const input = z
    .object({
      purpose: z.enum([
        'verification',
        'instruction',
        'performance',
        'message',
      ]),
      resourceId: idSchema,
      name: z.string().min(1).max(150),
      mimeType: z.enum([
        'image/png',
        'image/jpeg',
        'image/webp',
        'application/pdf',
        'video/mp4',
        'video/webm',
      ]),
      size: z
        .number()
        .int()
        .positive()
        .max(50 * 1024 * 1024),
    })
    .strict()
  async function locked(db: PoolClient, id: string, user: Actor) {
    const account = await db.query(
      'SELECT 1 FROM users WHERE id=$1 AND disabled_at IS NULL FOR SHARE',
      [user.id],
    )
    if (!account.rowCount) fail(401, 'UNAUTHENTICATED', 'Conta indisponivel.')
    const upload = (
      await db.query<Upload>(
        'SELECT * FROM media_uploads WHERE id=$1 AND owner_id=$2 FOR UPDATE',
        [idSchema.parse(id), user.id],
      )
    ).rows[0]
    if (!upload || new Date(upload.expires_at).getTime() <= Date.now())
      fail(404, 'UPLOAD_NOT_FOUND', 'Envio expirado ou indisponivel.')
    await dependencies.authorize(user, upload.purpose, upload.resource_id, db)
    return upload
  }
  app.post(
    '/media/uploads',
    { schema: { ...schema, body: bodySchema(input) } },
    async (req, reply) => {
      const user = requireUser(req),
        data = input.parse(req.body)
      const video = data.mimeType.startsWith('video/')
      if (
        (!video && data.size > 10 * 1024 * 1024) ||
        (video && data.purpose === 'verification')
      )
        fail(
          400,
          'INVALID_FILE',
          'Tipo ou tamanho nao permitido para esta finalidade.',
        )
      await dependencies.authorize(user, data.purpose, data.resourceId)
      const upload = await transaction(pool, async (db) => {
        await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id])
        const active = (
          await db.query<{ count: number }>(
            'SELECT count(*)::int AS count FROM media_uploads WHERE owner_id=$1 AND media_id IS NULL AND expires_at>now()',
            [user.id],
          )
        ).rows[0].count
        if (active >= 3)
          fail(
            429,
            'UPLOAD_LIMIT',
            'Conclua os envios em andamento antes de iniciar outro.',
          )
        return (
          await db.query<Upload>(
            'INSERT INTO media_uploads(id,owner_id,purpose,resource_id,name,mime_type,size,parts) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
            [
              randomUUID(),
              user.id,
              data.purpose,
              data.resourceId,
              data.name,
              data.mimeType,
              data.size,
              Math.ceil(data.size / partSize),
            ],
          )
        ).rows[0]
      })
      return reply.code(201).send({
        upload: {
          id: upload.id,
          partSize,
          parts: upload.parts,
          expiresAt: upload.expires_at,
        },
      })
    },
  )
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  )
  app.put<{ Params: { id: string; part: string } }>(
    '/media/uploads/:id/parts/:part',
    { schema, bodyLimit: partSize },
    async (req) => {
      const user = requireUser(req),
        part = z.coerce.number().int().min(0).max(16).parse(req.params.part)
      await transaction(pool, async (db) => {
        const upload = await locked(db, req.params.id, user)
        if (upload.media_id)
          fail(409, 'UPLOAD_COMPLETE', 'Este envio ja foi concluido.')
        const expected = Math.min(partSize, upload.size - part * partSize)
        if (
          part >= upload.parts ||
          !Buffer.isBuffer(req.body) ||
          req.body.length !== expected
        )
          fail(400, 'INVALID_PART', 'Parte com indice ou tamanho invalido.')
        const client = dependencies.storage()
        try {
          await client.send(
            new PutObjectCommand({
              Bucket: dependencies.bucket(),
              Key: partKey(upload.id, part),
              Body: encryptPrivate(req.body.toString('base64')),
              ContentType: 'application/octet-stream',
            }),
          )
        } finally {
          client.destroy()
        }
      })
      return { ok: true }
    },
  )
  app.delete<{ Params: { id: string } }>(
    '/media/uploads/:id',
    { schema },
    async (req) => {
      const user = requireUser(req),
        client = dependencies.storage()
      try {
        await transaction(pool, async (db) => {
          const upload = (
            await db.query<Upload>(
              'SELECT * FROM media_uploads WHERE id=$1 AND owner_id=$2 FOR UPDATE',
              [idSchema.parse(req.params.id), user.id],
            )
          ).rows[0]
          if (!upload) fail(404, 'UPLOAD_NOT_FOUND', 'Envio indisponivel.')
          await removeParts(client, dependencies.bucket(), upload)
          await db.query('DELETE FROM media_uploads WHERE id=$1', [upload.id])
        })
        return { ok: true }
      } finally {
        client.destroy()
      }
    },
  )
  app.post<{ Params: { id: string } }>(
    '/media/uploads/:id/complete',
    { schema },
    async (req, reply) => {
      const user = requireUser(req),
        client = dependencies.storage()
      let createdId: string | undefined
      let committed = false
      try {
        const result = await transaction(pool, async (db) => {
          const upload = await locked(db, req.params.id, user)
          if (upload.media_id) {
            const media = (
              await db.query(
                'SELECT * FROM media WHERE id=$1 AND deleted_at IS NULL',
                [upload.media_id],
              )
            ).rows[0]
            if (!media) fail(404, 'NOT_FOUND', 'Arquivo indisponivel.')
            return { media: dependencies.dto(media) }
          }
          const chunks: Buffer[] = []
          for (let part = 0; part < upload.parts; part++) {
            try {
              const object = await client.send(
                new GetObjectCommand({
                  Bucket: dependencies.bucket(),
                  Key: partKey(upload.id, part),
                }),
              )
              if (!object.Body)
                fail(
                  409,
                  'MISSING_PART',
                  'Envie todas as partes antes de concluir.',
                )
              chunks.push(
                Buffer.from(
                  decryptPrivate(await object.Body.transformToString()),
                  'base64',
                ),
              )
            } catch (error) {
              if (
                (error as { $metadata?: { httpStatusCode?: number } }).$metadata
                  ?.httpStatusCode === 404
              )
                fail(
                  409,
                  'MISSING_PART',
                  'Envie todas as partes antes de concluir.',
                )
              throw error
            }
          }
          const bytes = Buffer.concat(chunks)
          if (bytes.length !== upload.size)
            fail(400, 'INVALID_FILE', 'Tamanho final incorreto.')
          const saved = await dependencies.save(
            user,
            upload.purpose,
            upload.resource_id,
            { filename: upload.name, mimetype: upload.mime_type, bytes },
            db,
          )
          createdId = saved.media.id
          await db.query('UPDATE media_uploads SET media_id=$1 WHERE id=$2', [
            saved.media.id,
            upload.id,
          ])
          return saved
        })
        committed = true
        const upload = (
          await pool.query<Upload>(
            'SELECT * FROM media_uploads WHERE id=$1 AND owner_id=$2',
            [req.params.id, user.id],
          )
        ).rows[0]
        if (upload)
          await removeParts(client, dependencies.bucket(), upload).catch(
            () => undefined,
          )
        return reply.code(201).send(result)
      } catch (error) {
        if (createdId && !committed)
          await client
            .send(
              new DeleteObjectCommand({
                Bucket: dependencies.bucket(),
                Key: `private/${createdId}`,
              }),
            )
            .catch(() => undefined)
        throw error
      } finally {
        client.destroy()
      }
    },
  )
}
