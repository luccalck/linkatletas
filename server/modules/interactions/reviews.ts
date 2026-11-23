import { params } from './access.js'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { requireUser } from '../../shared/security.js'
import { idSchema, bodySchema } from '../../shared/validation.js'
import type { Review } from '../../../shared/interaction-contracts.js'
import { transaction } from '../../db/pool.js'
import { contractMember } from './access.js'
import { fail } from '../../shared/errors.js'
import { notifyUsers } from './notifications.js'

const reviewSelect = `SELECT r.id,r.contract_id AS "contractId",r.athlete_id AS "athleteId",a.name AS "athleteName",r.coach_id AS "coachId",c.name AS "coachName",r.rating,r.body AS text,r.reply,r.replied_at AS "repliedAt",r.hidden,r.created_at AS "createdAt",r.updated_at AS "updatedAt" FROM reviews r JOIN users a ON a.id=r.athlete_id JOIN users c ON c.id=r.coach_id`

const reviewBody = z
  .object({
    rating: z.number().int().min(1).max(5),
    text: z.string().trim().min(5).max(2000),
  })
  .strict()

const textBody = z.object({ text: z.string().trim().min(5).max(2000) }).strict()

const reasonBody = z
  .object({ reason: z.string().trim().min(5).max(1000) })
  .strict()

export function registerReviewRoutes(app: FastifyInstance, pool: Pool) {

  app.get(
    '/reviews',
    {
      schema: {
        tags: ['Avaliações'],
        summary: 'Avaliações publicadas e média sem conteúdo oculto',
      },
    },
    async (req) => {
      requireUser(req)
      const { coachId } = z
        .object({ coachId: idSchema.optional() })
        .strict()
        .parse(req.query)
      const reviews = (
        await pool.query<Review>(
          `${reviewSelect} WHERE r.hidden=false AND ($1::uuid IS NULL OR r.coach_id=$1) ORDER BY r.created_at DESC LIMIT 100`,
          [coachId ?? null],
        )
      ).rows
      const aggregate = (
        await pool.query(
          'SELECT count(*)::int AS count,COALESCE(avg(rating),0)::float8 AS average FROM reviews WHERE hidden=false AND ($1::uuid IS NULL OR coach_id=$1)',
          [coachId ?? null],
        )
      ).rows[0]
      return { reviews, average: aggregate.average, count: aggregate.count }
    },
  )
  const createReview = reviewBody.extend({ contractId: idSchema })
  app.post(
    '/reviews',
    {
      schema: {
        tags: ['Avaliações'],
        summary: 'Avaliar vínculo ativo após período mínimo',
        body: bodySchema(createReview),
      },
    },
    async (req, reply) => {
      const user = requireUser(req, 'athlete'),
        input = createReview.parse(req.body)
      const id = await transaction(pool, async (client) => {
        const contract = await contractMember(
          client,
          input.contractId,
          user,
          true,
          true,
        )
        const days = Number(process.env.REVIEW_MIN_DAYS ?? 7)
        if (!Number.isFinite(days) || days < 0)
          fail(503, 'CONFIGURATION', 'Configuração de avaliações indisponível.')
        if (
          !contract.decided_at ||
          contract.decided_at.getTime() > Date.now() - days * 86400_000
        )
          fail(
            403,
            'REVIEW_TOO_EARLY',
            `A avaliação exige pelo menos ${days} dias de acompanhamento.`,
          )
        const result = await client.query(
          'INSERT INTO reviews(contract_id,athlete_id,coach_id,rating,body) VALUES($1,$2,$3,$4,$5) ON CONFLICT(contract_id) DO NOTHING RETURNING id',
          [
            input.contractId,
            user.id,
            contract.coach_id,
            input.rating,
            input.text,
          ],
        )
        if (!result.rowCount)
          fail(
            409,
            'DUPLICATE_REVIEW',
            'Você já avaliou este vínculo. Edite a avaliação existente.',
          )
        return result.rows[0].id as string
      })
      const review = (
        await pool.query<Review>(`${reviewSelect} WHERE r.id=$1`, [id])
      ).rows[0]
      await notifyUsers(
        pool,
        [review.coachId],
        'review',
        'Você recebeu uma avaliação.',
        review.id,
      )
      return reply.code(201).send({ review })
    },
  )
  app.put<{ Params: { id: string } }>(
    '/reviews/:id',
    {
      schema: {
        tags: ['Avaliações'],
        summary: 'Editar minha avaliação publicada',
        params,
        body: bodySchema(reviewBody),
      },
    },
    async (req) => {
      const user = requireUser(req, 'athlete'),
        id = idSchema.parse(req.params.id),
        input = reviewBody.parse(req.body)
      const result = await pool.query(
        'UPDATE reviews SET rating=$1,body=$2,updated_at=now() WHERE id=$3 AND athlete_id=$4 AND hidden=false RETURNING id',
        [input.rating, input.text, id, user.id],
      )
      if (!result.rowCount)
        fail(404, 'NOT_FOUND', 'Avaliação não encontrada para edição.')
      return {
        review: (
          await pool.query<Review>(
            `${reviewSelect} WHERE r.id=$1 AND r.hidden=false`,
            [id],
          )
        ).rows[0],
      }
    },
  )
  app.post<{ Params: { id: string } }>(
    '/reviews/:id/reply',
    {
      schema: {
        tags: ['Avaliações'],
        summary: 'Responder avaliação recebida',
        params,
        body: bodySchema(textBody),
      },
    },
    async (req) => {
      const user = requireUser(req, 'coach'),
        id = idSchema.parse(req.params.id),
        { text } = textBody.parse(req.body)
      const result = await pool.query(
        'UPDATE reviews SET reply=$1,replied_at=now(),updated_at=now() WHERE id=$2 AND coach_id=$3 AND hidden=false RETURNING athlete_id',
        [text, id, user.id],
      )
      if (!result.rowCount)
        fail(404, 'NOT_FOUND', 'Avaliação não encontrada para resposta.')
      await notifyUsers(
        pool,
        [result.rows[0].athlete_id],
        'review_reply',
        'Seu treinador respondeu à avaliação.',
        id,
      )
      return {
        review: (
          await pool.query<Review>(
            `${reviewSelect} WHERE r.id=$1 AND r.hidden=false`,
            [id],
          )
        ).rows[0],
      }
    },
  )
  app.post<{ Params: { id: string } }>(
    '/reviews/:id/report',
    {
      schema: {
        tags: ['Avaliações'],
        summary: 'Denunciar avaliação publicada',
        params,
        body: bodySchema(reasonBody),
      },
    },
    async (req) => {
      const user = requireUser(req),
        id = idSchema.parse(req.params.id),
        { reason } = reasonBody.parse(req.body)
      const visible = await pool.query(
        'SELECT 1 FROM reviews WHERE id=$1 AND hidden=false',
        [id],
      )
      if (!visible.rowCount) fail(404, 'NOT_FOUND', 'Avaliação não encontrada.')
      await pool.query(
        'INSERT INTO review_reports(review_id,reporter_id,reason) VALUES($1,$2,$3) ON CONFLICT(review_id,reporter_id) DO NOTHING',
        [id, user.id, reason],
      )
      return { ok: true }
    },
  )
  app.get(
    '/admin/reviews',
    {
      schema: {
        tags: ['Administração'],
        summary: 'Avaliações e denúncias para moderação',
      },
    },
    async (req) => {
      requireUser(req, 'admin')
      const reviews = (
        await pool.query<Review>(
          `${reviewSelect} ORDER BY r.created_at DESC LIMIT 200`,
        )
      ).rows
      const reports = (
        await pool.query(
          'SELECT id,review_id AS "reviewId",reporter_id AS "reporterId",reason,created_at AS "createdAt" FROM review_reports ORDER BY created_at DESC LIMIT 200',
        )
      ).rows
      return { reviews, reports }
    },
  )
  const moderation = reasonBody.extend({ hidden: z.boolean() })
  app.patch<{ Params: { id: string } }>(
    '/admin/reviews/:id',
    {
      schema: {
        tags: ['Administração'],
        summary: 'Ocultar/restaurar avaliação com auditoria',
        params,
        body: bodySchema(moderation),
      },
    },
    async (req) => {
      const user = requireUser(req, 'admin'),
        id = idSchema.parse(req.params.id),
        input = moderation.parse(req.body)
      await transaction(pool, async (client) => {
        const result = await client.query(
          'UPDATE reviews SET hidden=$1,updated_at=now() WHERE id=$2 RETURNING id',
          [input.hidden, id],
        )
        if (!result.rowCount)
          fail(404, 'NOT_FOUND', 'Avaliação não encontrada.')
        await client.query(
          'INSERT INTO review_moderation(review_id,reviewer_id,hidden,reason) VALUES($1,$2,$3,$4)',
          [id, user.id, input.hidden, input.reason],
        )
      })
      return {
        review: (
          await pool.query<Review>(`${reviewSelect} WHERE r.id=$1`, [id])
        ).rows[0],
      }
    },
  )
}
