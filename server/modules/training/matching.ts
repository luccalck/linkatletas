import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { z } from 'zod'
import type { CoachCard, Profile } from '../../../shared/contracts.js'
import { requireUser } from '../../shared/security.js'
import { profileFor, profileSelect } from '../accounts/profiles.js'

const normalized = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
export function calculateMatch(
  athlete: Profile,
  coach: Profile,
): { score: number; reasons: string[] } | null {
  if (
    coach.verificationStatus !== 'approved' ||
    !athlete.sports.some((s) => coach.sports.includes(s))
  )
    return null
  if (
    (athlete.mode === 'presencial' || coach.mode === 'presencial') &&
    (coach.mode === 'online' ||
      athlete.mode === 'online' ||
      !athlete.city.trim() ||
      normalized(athlete.city) !== normalized(coach.city))
  )
    return null
  if (athlete.mode === 'online' && coach.mode === 'presencial') return null
  let score = 0
  const reasons: string[] = [
    'Modalidade compatível; perfil aprovado por conferência manual.',
  ]
  if (athlete.goals.some((g) => coach.goals.includes(g))) {
    score += 30
    reasons.push('Objetivo compatível (+30).')
  }
  if (athlete.levels.some((l) => coach.levels.includes(l))) {
    score += 20
    reasons.push('Nível atendido (+20).')
  }
  if (athlete.budget > 0 && coach.price <= athlete.budget) {
    score += 25
    reasons.push('Dentro do orçamento (+25).')
  }
  if (athlete.availability.some((a) => coach.availability.includes(a))) {
    score += 25
    reasons.push('Horário em comum (+25).')
  }
  if (score < 100)
    reasons.push(
      'Critérios sem correspondência não somam pontos. Pontuação por regras, sem IA treinada.',
    )
  return { score, reasons }
}
const filterSchema = z
  .object({
    sport: z.string().max(80).optional(),
    query: z.string().max(100).optional(),
    maxPrice: z.coerce.number().min(0).max(100000).optional(),
    mode: z.enum(['online', 'presencial', 'hibrido']).optional(),
  })
  .strict()
export async function matchingRoutes(app: FastifyInstance, pool: Pool) {
  app.get(
    '/coaches',
    {
      schema: {
        tags: ['Recomendação'],
        summary: 'Buscar treinadores aprovados com score calculado',
        querystring: {
          type: 'object',
          properties: {
            sport: { type: 'string' },
            query: { type: 'string' },
            maxPrice: { type: 'string', pattern: '^[0-9]+([.][0-9]{1,2})?$' },
            mode: { type: 'string', enum: ['online', 'presencial', 'hibrido'] },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      const user = requireUser(req, 'athlete')
      const filters = filterSchema.parse(req.query)
      const athlete = await profileFor(pool, user.id)
      const { rows } = await pool.query<Profile>(
        `${profileSelect} WHERE u.role='coach' AND u.disabled_at IS NULL AND p.verification_status='approved' AND (p.verification_expires_at IS NULL OR p.verification_expires_at>now())
          AND p.sports && $1::text[]
          AND ($2::text IS NULL OR $2=ANY(p.sports))
          AND ($3::numeric IS NULL OR p.price<=$3)
          AND ($4::text IS NULL OR p.mode=$4 OR p.mode='hibrido')`,
        [athlete.sports, filters.sport ?? null, filters.maxPrice ?? null, filters.mode ?? null],
      )
      const coaches: CoachCard[] = []
      for (const coach of rows) {
        const match = calculateMatch(athlete, coach)
        if (
          !match ||
          (filters.sport && !coach.sports.includes(filters.sport)) ||
          (filters.maxPrice !== undefined && coach.price > filters.maxPrice) ||
          (filters.mode &&
            coach.mode !== filters.mode &&
            coach.mode !== 'hibrido') ||
          (filters.query &&
            !normalized(`${coach.name} ${coach.city} ${coach.bio}`).includes(
              normalized(filters.query),
            ))
        )
          continue
        const {
          email: _email,
          budget: _budget,
          role: _role,
          ...publicCoach
        } = coach
        coaches.push({
          ...publicCoach,
          verificationReason: 'Aprovação registrada por conferência manual.',
          ...match,
        })
      }
      coaches.sort(
        (a, b) =>
          b.score - a.score ||
          a.name.localeCompare(b.name, 'pt-BR') ||
          a.userId.localeCompare(b.userId),
      )
      return { coaches }
    },
  )
}
