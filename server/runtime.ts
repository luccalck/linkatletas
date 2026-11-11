import { fileURLToPath } from 'node:url'
import { basename, dirname } from 'node:path'
import type { FastifyInstance } from 'fastify'
import staticPlugin from '@fastify/static'
import { apiPort, production } from './config.js'
import { createPool } from './db/pool.js'
import { runScheduledJobs, scheduledRoutes } from './scheduled.js'
import { readMailQueueHealth } from './services/mail-queue-health.js'

export async function startServer(app: FastifyInstance, options: { listen?: boolean } = {}) {
  const jobsPool = createPool()
  scheduledRoutes(app, () => runScheduledJobs(jobsPool), undefined, () => readMailQueueHealth(jobsPool))
  let jobsRunning = false
  const jobsTimer = process.env.VERCEL === '1' ? undefined : setInterval(
    async () => {
      if (jobsRunning) return
      jobsRunning = true
      try {
        await runScheduledJobs(jobsPool)
      } catch {
        app.log.error(
          { code: 'JOBS_FAILED' },
          'Falha na tarefa periodica; dados pendentes preservados.',
        )
      } finally {
        jobsRunning = false
      }
    },
    Number(process.env.JOBS_INTERVAL_MS || 10000),
  )
  jobsTimer?.unref()
  app.addHook('onClose', async () => {
    if (jobsTimer) clearInterval(jobsTimer)
    await jobsPool.end()
  })
  if (production) {
    await app.register(staticPlugin, {
      root: fileURLToPath(new URL('../dist/', import.meta.url)),
      prefix: '/',
      etag: false,
      lastModified: false,
      setHeaders(response, filePath) {
        if (filePath.endsWith('.html')) {
          response.header('Cache-Control', 'no-store')
        } else if (basename(dirname(filePath)) === 'assets' && /-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(basename(filePath))) {
          response.header('Cache-Control', 'public, max-age=31536000, immutable')
        }
      },
    })
  }
  if (options.listen === false) {
    await app.ready()
    return
  }
  const shutdown = async () => {
    await app.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  try {
    await app.listen({ port: apiPort, host: process.env.API_HOST || '127.0.0.1' })
  } catch (error) {
    app.log.error(error)
    await app.close()
    process.exitCode = 1
  }
}
