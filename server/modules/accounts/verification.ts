import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { z } from 'zod'
import type { Verification } from '../../../shared/contracts.js'
import { transaction } from '../../db/pool.js'
import { fail } from '../../shared/errors.js'
import { requireUser } from '../../shared/security.js'
import { bodySchema, idSchema } from '../../shared/validation.js'
import { notifyUsers } from '../interactions/notifications.js'

const select = `SELECT v.id,v.coach_id AS "coachId",u.name AS "coachName",v.cref,v.qualification,v.evidence,v.status,v.reason,
 v.submitted_at AS "submittedAt",v.reviewed_at AS "reviewedAt",v.reviewer_id AS "reviewerId",v.document_id AS "documentId",v.expires_at AS "expiresAt",v.source,p.verification_status AS "currentStatus",p.verification_reason AS "currentReason" FROM verifications v JOIN users u ON u.id=v.coach_id JOIN profiles p ON p.user_id=v.coach_id`
const submission = z
  .object({
    cref: z.string().trim().min(4).max(50),
    evidence: z.string().trim().min(10).max(2000),
    documentId: idSchema.optional(),
  })
  .strict()
const decision = z
  .object({
    status: z.enum(['approved', 'rejected']),
    reason: z.string().trim().min(5).max(1000),
    expiresAt: z.iso
      .datetime()
      .refine(
        (v) => new Date(v).getTime() > Date.now(),
        'Validade precisa estar no futuro.',
      )
      .optional(),
  })
  .strict()
export async function verificationRoutes(app: FastifyInstance, pool: Pool) {
  app.get(
    '/verifications',
    {
      schema: {
        tags: ['Validação profissional'],
        summary: 'Histórico privado do treinador',
      },
    },
    async (req) => {
      const user = requireUser(req, 'coach')
      return {
        verifications: (
          await pool.query<Verification>(
            `${select} WHERE v.coach_id=$1 ORDER BY v.submitted_at DESC`,
            [user.id],
          )
        ).rows,
      }
    },
  )
  app.post(
    '/verifications',
    {
      schema: {
        tags: ['Validação profissional'],
        summary: 'Submeter registro à conferência manual',
        body: bodySchema(submission),
      },
    },
    async (req, reply) => {
      const user = requireUser(req, 'coach')
      const input = submission.parse(req.body)
      const id = await transaction(pool, async (client) => {
        if (input.documentId) {
          const document = await client.query(
            "SELECT 1 FROM media WHERE id=$1 AND owner_id=$2 AND purpose='verification' AND deleted_at IS NULL",
            [input.documentId, user.id],
          )
          if (!document.rowCount)
            fail(
              400,
              'INVALID_DOCUMENT',
              'Documento privado não encontrado para este profissional.',
            )
        }
        const { rows: profiles } = await client.query(
          'SELECT sports,levels,goals,availability,verification_status FROM profiles WHERE user_id=$1 FOR UPDATE',
          [user.id],
        )
        const profile = profiles[0]
        if (
          !profile.sports.length ||
          !profile.levels.length ||
          !profile.goals.length ||
          !profile.availability.length
        )
          fail(
            400,
            'INCOMPLETE_PROFILE',
            'Complete modalidade, objetivos, nível e disponibilidade antes de enviar o registro.',
          )
        if (profile.verification_status === 'approved')
          fail(409, 'ALREADY_APPROVED', 'Seu perfil já foi aprovado.')
        const { rows } = await client.query(
          'INSERT INTO verifications(coach_id,cref,evidence,document_id) VALUES($1,$2,$3,$4) RETURNING id',
          [user.id, input.cref, input.evidence, input.documentId || null],
        )
        await client.query(
          `UPDATE profiles SET cref=$1,verification_status='pending',verification_reason='' WHERE user_id=$2`,
          [input.cref, user.id],
        )
        return rows[0].id as string
      })
      return reply.code(201).send({
        verification: (
          await pool.query<Verification>(`${select} WHERE v.id=$1`, [id])
        ).rows[0],
      })
    },
  )
  app.get(
    '/admin/verifications',
    {
      schema: {
        tags: ['Administração'],
        summary: 'Listar submissões para conferência manual',
      },
    },
    async (req) => {
      requireUser(req, 'admin')
      return {
        verifications: (
          await pool.query<Verification>(
            `${select} ORDER BY (v.status='pending') DESC,v.submitted_at DESC`,
          )
        ).rows,
      }
    },
  )
  app.patch<{ Params: { id: string } }>(
    '/admin/verifications/:id',
    {
      schema: {
        tags: ['Administração'],
        summary: 'Registrar decisão e auditoria',
        body: bodySchema(decision),
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
      },
    },
    async (req) => {
      const user = requireUser(req, 'admin')
      const id = idSchema.parse(req.params.id)
      const input = decision.parse(req.body)
      await transaction(pool, async (client) => {
        const { rows } = await client.query(
          "SELECT coach_id FROM verifications WHERE id=$1 AND status='pending' FOR UPDATE",
          [id],
        )
        if (!rows.length)
          fail(
            409,
            'DECISION_CONFLICT',
            'Solicitação inexistente ou já analisada.',
          )
        const expiresAt =
          input.status === 'approved'
            ? input.expiresAt ||
              new Date(Date.now() + 365 * 86400000).toISOString()
            : null
        await client.query(
          'UPDATE verifications SET status=$1,reason=$2,reviewed_at=now(),reviewer_id=$3,expires_at=$5 WHERE id=$4',
          [input.status, input.reason, user.id, id, expiresAt],
        )
        await client.query(
          'INSERT INTO verification_audit(verification_id,reviewer_id,decision,reason) VALUES($1,$2,$3,$4)',
          [id, user.id, input.status, input.reason],
        )
        await client.query(
          'UPDATE profiles SET verification_status=$1,verification_reason=$2,verification_expires_at=$4 WHERE user_id=$3',
          [input.status, input.reason, rows[0].coach_id, expiresAt],
        )
      })
      return {
        verification: (
          await pool.query<Verification>(`${select} WHERE v.id=$1`, [id])
        ).rows[0],
      }
    },
  )
  const suspend = z
    .object({
      status: z.enum(['suspended', 'rejected']),
      reason: z.string().trim().min(5).max(1000),
    })
    .strict()
  app.patch<{ Params: { id: string } }>(
    '/admin/coaches/:id/verification',
    { schema: { tags: ['Administração'], body: bodySchema(suspend) } },
    async (req) => {
      const admin = requireUser(req, 'admin'),
        id = idSchema.parse(req.params.id),
        input = suspend.parse(req.body)
      await transaction(pool, async (client) => {
        const { rows } = await client.query(
          "UPDATE profiles SET verification_status=$1,verification_reason=$2 WHERE user_id=$3 AND EXISTS(SELECT 1 FROM users WHERE id=$3 AND role='coach') RETURNING user_id",
          [input.status, input.reason, id],
        )
        if (!rows[0]) fail(404, 'NOT_FOUND', 'Treinador não encontrado.')
        await client.query(
          'INSERT INTO administrative_audit(actor_id,subject_id,action,reason) VALUES($1,$2,$3,$4)',
          [admin.id, id, `verification:${input.status}`, input.reason],
        )
      })
      await notifyUsers(
        pool,
        [id],
        'verification',
        'Seu registro profissional foi atualizado.',
        id,
      )
      return { ok: true }
    },
  )
}

export async function expireVerifications(pool: Pool) {
  const ids = await transaction(pool, async (client) => {
    const { rows } = await client.query(
      "UPDATE profiles SET verification_status='expired',verification_reason='Validade da aprovação encerrada. Envie nova comprovação.' WHERE verification_status='approved' AND verification_expires_at<=now() RETURNING user_id",
    )
    for (const row of rows)
      await client.query(
        "INSERT INTO administrative_audit(subject_id,action,reason) VALUES($1,'verification:expired','Prazo de conferência expirado')",
        [row.user_id],
      )
    return rows.map((row) => row.user_id as string)
  })
  if (ids.length)
    await notifyUsers(
      pool,
      ids,
      'verification',
      'Sua aprovação profissional expirou. Envie nova comprovação.',
    )
  return { expired: ids.length }
}
