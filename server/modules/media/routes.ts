import type { FastifyInstance } from 'fastify'
import type { Pool, PoolClient } from 'pg'
import { randomUUID } from 'node:crypto'
import { basename, extname } from 'node:path'
import { Readable } from 'node:stream'
import { mediaUploadRoutes, deletePendingUploads } from './uploads.js'
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { z } from 'zod'
import { requireUser } from '../../shared/security.js'
import { fail } from '../../shared/errors.js'
import { encryptPrivate, decryptPrivate } from '../../shared/crypto.js'
import { idSchema, bodySchema } from '../../shared/validation.js'
import { transaction } from '../../db/pool.js'
import { assertContractAccess } from '../billing/access.js'
import { notifyUsers } from '../interactions/notifications.js'
import { installMediaLimits } from './limits.js'
import { encryptMedia, mediaObjectKey, parseMediaRange, readMedia } from './object-format.js'

type MediaRow = {
  id: string
  owner_id: string
  purpose: string
  resource_id: string
  name: string
  mime_type: string
  size: number
  object_key: string
  created_at: string
  deleted_at: string | null
}
export function mediaStorage() {
  return new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || 'http://127.0.0.1:8333',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || 'linkatletas-local',
      secretAccessKey:
        process.env.S3_SECRET_KEY || 'local-only-change-in-production',
    },
  })
}
export const mediaBucket = () => process.env.S3_BUCKET || 'linkatletas-private'
export async function ensureMediaBucket() {
  const client = mediaStorage()
  try {
    try {
      await client.send(new HeadBucketCommand({ Bucket: mediaBucket() }))
      return
    } catch (error) {
      if (
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode !== 404
      )
        throw error
    }
    await client.send(new CreateBucketCommand({ Bucket: mediaBucket() }))
  } catch (error) {
    if (
      !['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(
        (error as Error).name,
      )
    )
      throw error
  } finally {
    client.destroy()
  }
}
async function authorize(
  pool: Pool | PoolClient,
  user: { id: string; role: string },
  purpose: string,
  resourceId: string,
  write = false,
) {
  if (purpose === 'verification') {
    if (user.id !== resourceId && !(user.role === 'admin' && !write))
      fail(404, 'NOT_FOUND', 'Documento não encontrado.')
    if (write && user.role !== 'coach')
      fail(
        403,
        'FORBIDDEN',
        'Somente treinador envia comprovação profissional.',
      )
    return
  }
  const sql =
    purpose === 'message'
      ? 'SELECT id AS contract_id,athlete_id,coach_id,status FROM contracts WHERE id=$1'
      : 'SELECT c.id AS contract_id,c.athlete_id,c.coach_id,c.status,w.status AS workout_status FROM workouts w JOIN contracts c ON c.id=w.contract_id WHERE w.id=$1'
  const { rows } = await pool.query(sql, [resourceId]),
    row = rows[0]
  if (
    !row ||
    ![row.athlete_id, row.coach_id].includes(user.id) ||
    (user.id === row.athlete_id && row.workout_status === 'draft')
  )
    fail(404, 'NOT_FOUND', 'Recurso não encontrado.')
  if (write && row.status !== 'active')
    fail(403, 'INACTIVE_CONTRACT', 'O vínculo precisa estar ativo.')
  if (write) await assertContractAccess(pool, row.contract_id, user.id)
  if (write && purpose === 'instruction' && user.id !== row.coach_id)
    fail(403, 'FORBIDDEN', 'Somente o treinador envia orientações.')
  if (write && purpose === 'performance') {
    if (user.id !== row.athlete_id)
      fail(403, 'FORBIDDEN', 'Somente o atleta envia sua performance.')
    const consent = await pool.query(
      "SELECT 1 FROM consents WHERE user_id=$1 AND purpose='performance' AND granted=true",
      [user.id],
    )
    if (!consent.rowCount)
      fail(
        403,
        'CONSENT_REQUIRED',
        'Conceda consentimento de performance antes de enviar mídia.',
      )
  }
}
function fileType(
  bytes: Buffer,
): { mime: string; extensions: string[] } | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { mime: 'image/png', extensions: ['.png'] }
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return { mime: 'image/jpeg', extensions: ['.jpg', '.jpeg'] }
  if (
    bytes.subarray(0, 4).toString() === 'RIFF' &&
    bytes.subarray(8, 12).toString() === 'WEBP'
  )
    return { mime: 'image/webp', extensions: ['.webp'] }
  if (bytes.subarray(0, 5).toString() === '%PDF-')
    return { mime: 'application/pdf', extensions: ['.pdf'] }
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString() === 'ftyp')
    return { mime: 'video/mp4', extensions: ['.mp4'] }
  if (bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])))
    return { mime: 'video/webm', extensions: ['.webm'] }
  return null
}
function dto(row: MediaRow) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    purpose: row.purpose,
    resourceId: row.resource_id,
    name: row.name,
    mimeType: row.mime_type,
    size: row.size,
    createdAt: row.created_at,
  }
}
export async function deleteMediaObjects(
  pool: Pool,
  ownerId: string,
  purpose?: string,
) {
  await deletePendingUploads(
    pool,
    mediaStorage,
    mediaBucket(),
    ownerId,
    purpose,
  )
  const { rows } = await pool.query<MediaRow>(
    'SELECT * FROM media WHERE owner_id=$1 AND deleted_at IS NULL AND ($2::text IS NULL OR purpose=$2)',
    [ownerId, purpose || null],
  )
  const client = mediaStorage()
  try {
    for (const row of rows) {
      await client.send(
        new DeleteObjectCommand({ Bucket: mediaBucket(), Key: row.object_key }),
      )
      await transaction(pool, async (db) => {
        await db.query('UPDATE media SET deleted_at=now() WHERE id=$1', [
          row.id,
        ])
        await db.query('DELETE FROM media_feedback WHERE media_id=$1', [row.id])
      })
    }
  } finally {
    client.destroy()
  }
}
export async function mediaRoutes(app: FastifyInstance, pool: Pool) {
  installMediaLimits(app)
  const schema = {
    tags: ['Arquivos privados'],
    response: { '2xx': { type: 'object', additionalProperties: true } },
  }
  async function saveMedia(
    user: { id: string; role: string },
    purpose: string,
    resourceId: string,
    file: { filename: string; mimetype: string; bytes: Buffer },
    connection?: PoolClient,
  ) {
    const access = connection ?? pool
    await authorize(access, user, purpose, resourceId, true)
    const bytes = file.bytes,
      type = fileType(bytes),
      extension = extname(file.filename).toLowerCase()
    if (
      !type ||
      type.mime !== file.mimetype ||
      !type.extensions.includes(extension)
    )
      fail(
        400,
        'INVALID_FILE',
        'Formato, extensão ou assinatura do arquivo inválidos.',
      )
    const limit = type.mime.startsWith('video/')
      ? 50 * 1024 * 1024
      : 10 * 1024 * 1024
    if (bytes.length > limit)
      fail(413, 'TOO_LARGE', 'O arquivo ultrapassa o limite permitido.')
    if (purpose === 'verification' && type.mime.startsWith('video/'))
      fail(400, 'INVALID_FILE', 'Comprovação aceita imagem ou PDF.')
    const id = randomUUID(),
      objectKey = mediaObjectKey(id)
    const name = basename(file.filename.replaceAll('\\', '/'))
      .replace(/[\x00-\x1f\x7f"<>]/g, '_')
      .slice(0, 150)
    await ensureMediaBucket()
    const client = mediaStorage()
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: mediaBucket(),
          Key: objectKey,
          Body: encryptMedia(bytes, objectKey),
          ContentType: 'application/octet-stream',
        }),
      )
      try {
        // Check consent/resource again to cover revocation while uploading.
        await authorize(access, user, purpose, resourceId, true)
        const persist = async (db: PoolClient) => {
          const account = await db.query(
            'SELECT 1 FROM users WHERE id=$1 AND disabled_at IS NULL FOR SHARE',
            [user.id],
          )
          if (!account.rowCount)
            fail(401, 'UNAUTHENTICATED', 'Conta encerrada durante o envio.')
          if (purpose === 'performance') {
            const consent = await db.query(
              "SELECT 1 FROM consents WHERE user_id=$1 AND purpose='performance' AND granted=true FOR SHARE",
              [user.id],
            )
            if (!consent.rowCount)
              fail(
                403,
                'CONSENT_REQUIRED',
                'Consentimento revogado durante o envio.',
              )
          }
          const { rows } = await db.query<MediaRow>(
            'INSERT INTO media(id,owner_id,purpose,resource_id,name,mime_type,size,object_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
            [
              id,
              user.id,
              purpose,
              resourceId,
              name,
              type.mime,
              bytes.length,
              objectKey,
            ],
          )
          return rows[0]
        }
        const saved = connection
          ? await persist(connection)
          : await transaction(pool, persist)
        return { media: dto(saved) }
      } catch (error) {
        await client.send(
          new DeleteObjectCommand({ Bucket: mediaBucket(), Key: objectKey }),
        )
        throw error
      }
    } finally {
      client.destroy()
    }
  }
  await mediaUploadRoutes(app, pool, {
    authorize: (user, purpose, resourceId, connection) =>
      authorize(connection ?? pool, user, purpose, resourceId, true),
    save: saveMedia,
    storage: mediaStorage,
    bucket: mediaBucket,
    dto,
  })
  app.post('/media', { schema }, async (req, reply) => {
    const user = requireUser(req)
    const { purpose, resourceId } = z
      .object({
        purpose: z.enum([
          'verification',
          'instruction',
          'performance',
          'message',
        ]),
        resourceId: idSchema,
      })
      .strict()
      .parse(req.query)
    await authorize(pool, user, purpose, resourceId, true)
    const file = await req.file()
    if (!file || file.fieldname !== 'file')
      fail(400, 'FILE_REQUIRED', 'Envie um arquivo no campo file.')
    const result = await saveMedia(user, purpose, resourceId, {
      filename: file.filename,
      mimetype: file.mimetype,
      bytes: await file.toBuffer(),
    })
    return reply.code(201).send(result)
  })
  app.get('/media', { schema }, async (req) => {
    const user = requireUser(req),
      { resourceId } = z
        .object({ resourceId: idSchema })
        .strict()
        .parse(req.query)
    const { rows } = await pool.query<MediaRow>(
      'SELECT * FROM media WHERE resource_id=$1 AND deleted_at IS NULL ORDER BY created_at',
      [resourceId],
    )
    // An empty list must also verify ownership to avoid resource enumeration.
    if (!rows.length) {
      const workout = (
        await pool.query('SELECT 1 FROM workouts WHERE id=$1', [resourceId])
      ).rowCount
      const contract = (
        await pool.query('SELECT 1 FROM contracts WHERE id=$1', [resourceId])
      ).rowCount
      await authorize(
        pool,
        user,
        workout ? 'instruction' : contract ? 'message' : 'verification',
        resourceId,
      )
    }
    const result = []
    for (const row of rows) {
      await authorize(pool, user, row.purpose, row.resource_id)
      const feedback = (
        await pool.query(
          'SELECT f.id,f.author_id AS "authorId",u.name AS "authorName",f.encrypted_text,f.created_at AS "createdAt" FROM media_feedback f JOIN users u ON u.id=f.author_id WHERE media_id=$1 ORDER BY f.created_at',
          [row.id],
        )
      ).rows.map((r) => ({
        ...r,
        text: decryptPrivate(r.encrypted_text),
        encrypted_text: undefined,
      }))
      result.push({ ...dto(row), feedback })
    }
    return { media: result }
  })
  async function get(id: string, user: { id: string; role: string }) {
    const row = (
      await pool.query<MediaRow>(
        'SELECT * FROM media WHERE id=$1 AND deleted_at IS NULL',
        [idSchema.parse(id)],
      )
    ).rows[0]
    if (!row) fail(404, 'NOT_FOUND', 'Arquivo não encontrado.')
    await authorize(pool, user, row.purpose, row.resource_id)
    return row
  }
  app.get<{ Params: { id: string } }>(
    '/media/:id/content',
    { schema: { tags: ['Arquivos privados'], response: {} } },
    async (req, reply) => {
      const row = await get(req.params.id, requireUser(req))
      const range = req.headers.range
      const selected = range ? parseMediaRange(range, row.size) : { start: 0, end: row.size - 1 }
      if (!selected)
        return reply.code(416).header('Content-Range', `bytes */${row.size}`).send()
      const client = mediaStorage()
      try {
        const content = await readMedia(client, mediaBucket(), row.object_key, row.size, selected.start, selected.end)
        if (range) reply.code(206).header('Content-Range', `bytes ${selected.start}-${selected.end}/${row.size}`)
        return reply
          .type(row.mime_type)
          .header(
            'Content-Disposition',
            `${row.mime_type === 'application/pdf' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
          )
          .header('Content-Security-Policy', "sandbox; default-src 'none'")
          .header('Accept-Ranges', 'bytes')
          .header('Content-Length', content.length)
          .send(Readable.from([content]))
      } finally {
        client.destroy()
      }
    },
  )
  app.delete<{ Params: { id: string } }>(
    '/media/:id',
    { schema },
    async (req) => {
      const user = requireUser(req),
        row = await get(req.params.id, user)
      if (row.owner_id !== user.id)
        fail(403, 'FORBIDDEN', 'Somente o titular exclui este arquivo.')
      const client = mediaStorage()
      try {
        await client.send(
          new DeleteObjectCommand({
            Bucket: mediaBucket(),
            Key: row.object_key,
          }),
        )
        await pool.query('UPDATE media SET deleted_at=now() WHERE id=$1', [
          row.id,
        ])
        await pool.query('DELETE FROM media_feedback WHERE media_id=$1', [
          row.id,
        ])
      } finally {
        client.destroy()
      }
      return { ok: true }
    },
  )
  const feedback = z
    .object({ text: z.string().trim().min(2).max(4000) })
    .strict()
  app.post<{ Params: { id: string } }>(
    '/media/:id/feedback',
    { schema: { ...schema, body: bodySchema(feedback) } },
    async (req, reply) => {
      const user = requireUser(req, 'coach'),
        row = await get(req.params.id, user),
        input = feedback.parse(req.body)
      if (row.purpose !== 'performance')
        fail(
          400,
          'INVALID_PURPOSE',
          'Correção técnica exige arquivo de performance.',
        )
      await authorize(
        pool,
        user,
        'message',
        (
          await pool.query('SELECT contract_id FROM workouts WHERE id=$1', [
            row.resource_id,
          ])
        ).rows[0].contract_id,
        true,
      )
      const saved = await transaction(pool, async (client) => {
        const account = await client.query(
          'SELECT 1 FROM users WHERE id=$1 AND disabled_at IS NULL FOR SHARE',
          [user.id],
        )
        if (!account.rowCount)
          fail(401, 'UNAUTHENTICATED', 'Esta conta foi encerrada.')
        const current = await client.query(
          'SELECT 1 FROM media WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',
          [row.id],
        )
        if (!current.rowCount)
          fail(404, 'NOT_FOUND', 'Arquivo eliminado durante o registro.')
        const contract = (
          await client.query('SELECT contract_id FROM workouts WHERE id=$1', [
            row.resource_id,
          ])
        ).rows[0]
        await assertContractAccess(client, contract.contract_id, user.id)
        return (
          await client.query(
            'INSERT INTO media_feedback(media_id,author_id,encrypted_text) VALUES($1,$2,$3) RETURNING id,created_at AS "createdAt"',
            [row.id, user.id, encryptPrivate(input.text)],
          )
        ).rows[0]
      })
      await notifyUsers(
        pool,
        [row.owner_id],
        'feedback',
        'Seu treinador enviou uma correção técnica.',
        row.id,
      )
      return reply.code(201).send({
        feedback: {
          ...saved,
          authorId: user.id,
          authorName: user.name,
          text: input.text,
        },
      })
    },
  )
}
