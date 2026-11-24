import type { FastifyInstance } from 'fastify'
import type { Pool, PoolClient } from 'pg'
import type { Profile } from '../../../shared/contracts.js'
import { transaction } from '../../db/pool.js'
import { fail } from '../../shared/errors.js'
import { requireUser } from '../../shared/security.js'
import { bodySchema, profileSchema } from '../../shared/validation.js'

export const profileSelect = `SELECT u.id AS "userId",u.role,u.name,u.email,p.city,p.bio,p.sports,p.goals,p.levels,
 p.availability,p.mode,p.budget::float8,p.price::float8,p.cref,p.qualification,p.verification_status AS "verificationStatus",
 p.verification_reason AS "verificationReason",p.verification_expires_at AS "verificationExpiresAt" FROM users u JOIN profiles p ON p.user_id=u.id`
export async function profileFor(
  pool: Pool | PoolClient,
  id: string,
): Promise<Profile> {
  const { rows } = await pool.query<Profile>(`${profileSelect} WHERE u.id=$1`, [
    id,
  ])
  if (!rows[0]) fail(404, 'NOT_FOUND', 'Perfil não encontrado.')
  return rows[0]
}
export async function profilesRoutes(app: FastifyInstance, pool: Pool) {
  app.get(
    '/profiles/me',
    { schema: { tags: ['Perfis'], summary: 'Consultar meu perfil' } },
    async (req) => ({ profile: await profileFor(pool, requireUser(req).id) }),
  )
  app.put(
    '/profiles/me',
    {
      schema: {
        tags: ['Perfis'],
        summary: 'Atualizar preferências e dados de perfil',
        body: bodySchema(profileSchema),
      },
    },
    async (req) => {
      const user = requireUser(req)
      if (user.role === 'admin')
        fail(403, 'FORBIDDEN', 'Administrador não possui perfil esportivo.')
      const p = profileSchema.parse(req.body)
      for (const values of [p.sports, p.goals, p.levels, p.availability]) {
        if (new Set(values).size !== values.length)
          fail(
            400,
            'VALIDATION',
            'As opções do perfil não podem estar repetidas.',
          )
      }
      await transaction(pool, async (client) => {
        const account = await client.query(
          'UPDATE users SET name=$1 WHERE id=$2 AND disabled_at IS NULL RETURNING id',
          [p.name, user.id],
        )
        if (!account.rowCount)
          fail(401, 'UNAUTHENTICATED', 'Esta conta foi encerrada.')
        await client.query(
          `UPDATE profiles SET city=$1,bio=$2,sports=$3,goals=$4,levels=$5,availability=$6,
        mode=$7,budget=$8,price=$9 WHERE user_id=$10`,
          [
            p.city,
            p.bio,
            p.sports,
            p.goals,
            p.levels,
            p.availability,
            p.mode,
            p.budget,
            p.price,
            user.id,
          ],
        )
      })
      return { profile: await profileFor(pool, user.id) }
    },
  )
}
