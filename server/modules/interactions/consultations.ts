import { params } from './access.js'
import { type Database, contractMember, participants } from './access.js'
import type { AppUser } from '../../../shared/contracts.js'
import type { Consultation } from '../../../shared/interaction-contracts.js'
import { fail } from '../../shared/errors.js'
import { decryptPrivate, encryptPrivate } from '../../shared/crypto.js'
import type { PoolClient, Pool } from 'pg'
import { z } from 'zod'
import { idSchema, bodySchema } from '../../shared/validation.js'
import type { FastifyInstance } from 'fastify'
import { requireUser } from '../../shared/security.js'
import { transaction } from '../../db/pool.js'
import { insertNotification } from './notifications.js'
import { publish } from './events.js'
import { externalUrlSchema } from '../../shared/external-url.js'

const consultationSelect = `SELECT x.id,x.contract_id AS "contractId",c.athlete_id AS "athleteId",a.name AS "athleteName",c.coach_id AS "coachId",t.name AS "coachName",x.title,x.description_ciphertext AS description,x.starts_at AS "startsAt",x.duration_minutes AS "durationMinutes",x.status,x.meeting_url AS "meetingUrl",x.external_event_id AS "externalEventId",x.created_at AS "createdAt",x.updated_at AS "updatedAt" FROM consultations x JOIN contracts c ON c.id=x.contract_id JOIN users a ON a.id=c.athlete_id JOIN users t ON t.id=c.coach_id`

async function getConsultation(db: Database, id: string, user: AppUser) {
  const row = (
    await db.query<Consultation>(
      `${consultationSelect} WHERE x.id=$1 AND (c.athlete_id=$2 OR c.coach_id=$2)`,
      [id, user.id],
    )
  ).rows[0]
  if (!row) fail(404, 'NOT_FOUND', 'Consultoria não encontrada.')
  return { ...row, description: decryptPrivate(row.description) }
}

async function calendarLock(client: PoolClient, ids: string[]) {
  // Lock both participant calendars in sorted order, including across distinct contracts.
  for (const id of [...ids].sort())
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 12871))',
      [id],
    )
}

async function assertNoConflict(
  client: PoolClient,
  members: string[],
  startsAt: string,
  duration: number,
  excluding: string | null = null,
) {
  const overlap = await client.query(
    `SELECT 1 FROM consultations x JOIN contracts c ON c.id=x.contract_id WHERE x.status='scheduled' AND ($4::uuid IS NULL OR x.id<>$4) AND (c.athlete_id=ANY($1::uuid[]) OR c.coach_id=ANY($1::uuid[])) AND x.starts_at < $2::timestamptz + make_interval(mins=>$3::int) AND x.starts_at + make_interval(mins=>x.duration_minutes) > $2::timestamptz LIMIT 1`,
    [members, startsAt, duration, excluding],
  )
  if (overlap.rowCount)
    fail(
      409,
      'SCHEDULE_CONFLICT',
      'Um participante já possui consultoria nesse horário.',
    )
}

const meetingUrl = externalUrlSchema.max(1000).optional()

const consultationInput = z
  .object({
    contractId: idSchema,
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().max(3000).default(''),
    startsAt: z.string().datetime({ offset: true }),
    durationMinutes: z.number().int().min(15).max(180),
    meetingUrl,
  })
  .strict()

const consultationEdit = z
  .object({
    startsAt: z.string().datetime({ offset: true }).optional(),
    durationMinutes: z.number().int().min(15).max(180).optional(),
    status: z.enum(['scheduled', 'cancelled', 'completed']).optional(),
    reason: z.string().trim().min(5).max(1000),
    meetingUrl,
  })
  .strict()
  .refine(
    (v) =>
      v.startsAt !== undefined ||
      v.durationMinutes !== undefined ||
      v.status !== undefined ||
      v.meetingUrl !== undefined,
    'Informe uma alteração.',
  )

export function registerConsultationRoutes(app: FastifyInstance, pool: Pool) {

  app.get(
    '/consultations',
    {
      schema: {
        tags: ['Agenda'],
        summary: 'Minha agenda e histórico de consultorias',
      },
    },
    async (req) => {
      const user = requireUser(req)
      const rows = (
        await pool.query<Consultation>(
          `${consultationSelect} WHERE c.athlete_id=$1 OR c.coach_id=$1 ORDER BY x.starts_at DESC LIMIT 200`,
          [user.id],
        )
      ).rows
      return {
        consultations: rows.map((row) => ({
          ...row,
          description: decryptPrivate(row.description),
        })),
      }
    },
  )
  app.post(
    '/consultations',
    {
      schema: {
        tags: ['Agenda'],
        summary: 'Agendar consultoria sem conflito de participantes',
        body: bodySchema(consultationInput),
      },
    },
    async (req, reply) => {
      const user = requireUser(req),
        input = consultationInput.parse(req.body)
      if (new Date(input.startsAt).getTime() <= Date.now())
        fail(400, 'PAST_APPOINTMENT', 'Escolha um horário futuro.')
      const saved = await transaction(pool, async (client) => {
        const contract = await contractMember(
          client,
          input.contractId,
          user,
          true,
          true,
        )
        const ids = participants(contract)
        await calendarLock(client, ids)
        await assertNoConflict(
          client,
          ids,
          input.startsAt,
          input.durationMinutes,
        )
        const result = await client.query(
          'INSERT INTO consultations(contract_id,title,description_ciphertext,starts_at,duration_minutes,meeting_url) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
          [
            input.contractId,
            input.title,
            encryptPrivate(input.description),
            input.startsAt,
            input.durationMinutes,
            input.meetingUrl ?? null,
          ],
        )
        await client.query(
          "INSERT INTO consultation_history(consultation_id,actor_id,action,new_starts_at,reason) VALUES($1,$2,'created',$3,'Agendamento solicitado pelo participante.')",
          [result.rows[0].id, user.id, input.startsAt],
        )
        const recipient = ids.find((i) => i !== user.id)!
        return {
          consultation: await getConsultation(client, result.rows[0].id, user),
          ids,
          recipient,
          notification: await insertNotification(
            client,
            recipient,
            'consultation',
            'Uma consultoria foi agendada.',
            result.rows[0].id,
          ),
        }
      })
      await publish(pool, saved.ids, {
        type: 'consultation',
        consultation: saved.consultation,
      })
      await publish(pool, [saved.recipient], {
        type: 'notification',
        notification: saved.notification,
      })
      return reply.code(201).send({ consultation: saved.consultation })
    },
  )
  app.patch<{ Params: { id: string } }>(
    '/consultations/:id',
    {
      schema: {
        tags: ['Agenda'],
        summary: 'Reagendar/cancelar/completar consultoria com histórico',
        params,
        body: bodySchema(consultationEdit),
      },
    },
    async (req) => {
      const user = requireUser(req),
        id = idSchema.parse(req.params.id),
        input = consultationEdit.parse(req.body)
      const saved = await transaction(pool, async (client) => {
        // Acquire calendars before row lock, preserving lock order between create and edit.
        const current = await getConsultation(client, id, user)
        const contract = await contractMember(
          client,
          current.contractId,
          user,
          input.status !== 'cancelled',
          true,
        )
        const ids = participants(contract)
        await calendarLock(client, ids)
        const locked = (
          await client.query(
            'SELECT status,starts_at,duration_minutes,meeting_url FROM consultations WHERE id=$1 FOR UPDATE',
            [id],
          )
        ).rows[0]
        if (locked.status !== 'scheduled')
          fail(
            409,
            'APPOINTMENT_STATE',
            'Consultoria já encerrada. Crie outro agendamento.',
          )
        const nextStatus = input.status ?? locked.status,
          startsAt = input.startsAt ?? locked.starts_at.toISOString(),
          duration = input.durationMinutes ?? locked.duration_minutes
        if (nextStatus === 'scheduled') {
          if (new Date(startsAt).getTime() <= Date.now())
            fail(400, 'PAST_APPOINTMENT', 'Escolha um horário futuro.')
          await assertNoConflict(client, ids, startsAt, duration, id)
        }
        if (
          nextStatus === 'completed' &&
          locked.starts_at.getTime() > Date.now()
        )
          fail(400, 'EARLY_COMPLETION', 'A consultoria ainda não começou.')
        await client.query(
          'UPDATE consultations SET starts_at=$1,duration_minutes=$2,status=$3,meeting_url=$4,updated_at=now() WHERE id=$5',
          [
            startsAt,
            duration,
            nextStatus,
            input.meetingUrl ?? locked.meeting_url,
            id,
          ],
        )
        await client.query(
          'INSERT INTO consultation_history(consultation_id,actor_id,action,previous_starts_at,new_starts_at,reason) VALUES($1,$2,$3,$4,$5,$6)',
          [
            id,
            user.id,
            nextStatus === 'scheduled' ? 'rescheduled' : nextStatus,
            locked.starts_at,
            startsAt,
            input.reason,
          ],
        )
        const recipient = ids.find((i) => i !== user.id)!
        return {
          consultation: await getConsultation(client, id, user),
          ids,
          recipient,
          notification: await insertNotification(
            client,
            recipient,
            'consultation',
            'Uma consultoria foi atualizada.',
            id,
          ),
        }
      })
      await publish(pool, saved.ids, {
        type: 'consultation',
        consultation: saved.consultation,
      })
      await publish(pool, [saved.recipient], {
        type: 'notification',
        notification: saved.notification,
      })
      return { consultation: saved.consultation }
    },
  )
  app.get<{ Params: { id: string } }>(
    '/consultations/:id/history',
    {
      schema: {
        tags: ['Agenda'],
        summary: 'Histórico autorizado das alterações de agenda',
        params,
      },
    },
    async (req) => {
      const user = requireUser(req),
        id = idSchema.parse(req.params.id)
      await getConsultation(pool, id, user)
      return {
        history: (
          await pool.query(
            'SELECT id,actor_id AS "actorId",action,previous_starts_at AS "previousStartsAt",new_starts_at AS "newStartsAt",reason,created_at AS "createdAt" FROM consultation_history WHERE consultation_id=$1 ORDER BY created_at,id',
            [id],
          )
        ).rows,
      }
    },
  )
  const externalEvent = z
    .object({
      eventId: z
        .string()
        .min(5)
        .max(200)
        .regex(/^[a-zA-Z0-9_-]+$/),
      meetingUrl: externalUrlSchema
        .max(1000)
        .refine(
          (value) =>
            new URL(value).protocol === 'https:' &&
            new URL(value).hostname === 'meet.google.com',
          'Informe uma reunião HTTPS do Google Meet.',
        ),
    })
    .strict()
  app.post<{ Params: { id: string } }>(
    '/consultations/:id/google-event',
    {
      schema: {
        tags: ['Agenda'],
        summary: 'Vincular evento criado pelo usuário após OAuth no Google',
        params,
        body: bodySchema(externalEvent),
      },
    },
    async (req) => {
      const user = requireUser(req),
        id = idSchema.parse(req.params.id),
        input = externalEvent.parse(req.body)
      const saved = await transaction(pool, async (client) => {
        const current = await getConsultation(client, id, user)
        const contract = await contractMember(
          client,
          current.contractId,
          user,
          true,
          true,
        )
        const result = await client.query(
          "UPDATE consultations SET external_event_id=$1,meeting_url=$2,updated_at=now() WHERE id=$3 AND status='scheduled' AND external_event_id IS NULL RETURNING id",
          [input.eventId, input.meetingUrl, id],
        )
        if (!result.rowCount)
          fail(
            409,
            'EXTERNAL_EVENT_EXISTS',
            'Consultoria já possui evento externo ou foi encerrada.',
          )
        await client.query(
          "INSERT INTO consultation_history(consultation_id,actor_id,action,reason) VALUES($1,$2,'external-linked','Referência de evento informada pelo usuário após sua ação no Google. Não representa validação independente do provedor.')",
          [id, user.id],
        )
        return {
          consultation: await getConsultation(client, id, user),
          ids: participants(contract),
        }
      })
      await publish(pool, saved.ids, {
        type: 'consultation',
        consultation: saved.consultation,
      })
      return { consultation: saved.consultation }
    },
  )
}
