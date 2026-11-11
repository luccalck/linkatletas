import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { runJobs } from './jobs.js'

export async function runScheduledJobs(
  pool: Pool,
  work: () => Promise<unknown> = () => runJobs(pool),
) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SET LOCAL idle_in_transaction_session_timeout='5min'")
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_xact_lock(128712027) AS locked',
    )
    if (!rows[0]?.locked) return { skipped: true }
    return { skipped: false, result: await work() }
  } finally {
    try {
      await client.query('ROLLBACK')
      client.release()
    } catch (error) {
      client.release(true)
      throw error
    }
  }
}

export function scheduledRoutes(
  app: FastifyInstance,
  work: () => Promise<unknown>,
  secret: () => string | undefined = () => process.env.CRON_SECRET,
  health?: () => Promise<unknown>,
) {
  const authorized = (authorization: string | undefined) => {
    const key = secret()
    const expected = Buffer.from(`Bearer ${key || ''}`)
    const actual = Buffer.from(authorization || '')
    return Boolean(key && key.length >= 32 && actual.length === expected.length && timingSafeEqual(actual, expected))
  }
  for (const [path, task, monitor] of [
    ['/api/internal/jobs', work, false],
    ['/api/internal/queues', health ?? (async () => ({ healthy: false, code: 'MONITOR_UNAVAILABLE' })), true],
  ] as const) {
    app.get(path, { schema: { hide: true } }, async (req, reply) => {
      reply.header('Cache-Control', 'no-store')
      if (!authorized(req.headers.authorization))
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Acesso nao autorizado.' })
      const outcome = await task()
      if (monitor && outcome && typeof outcome === 'object' && 'healthy' in outcome && outcome.healthy === false) reply.code(503)
      return outcome
    })
  }
}
