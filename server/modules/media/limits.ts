import type { FastifyInstance, FastifyRequest } from 'fastify'
import { fail } from '../../shared/errors.js'
import { requireUser } from '../../shared/security.js'

export function installMediaLimits(app: FastifyInstance) {
  const active = new Set<FastifyRequest>()
  app.addHook('preHandler', async (request, reply) => {
    const route = request.routeOptions.url
    const intensive = request.method === 'POST' && (route === '/api/media' || route === '/api/media/uploads/:id/complete')
      || request.method === 'GET' && route === '/api/media/:id/content'
    if (!intensive) return
    requireUser(request)
    if (active.size >= 2) {
      reply.header('Retry-After', '1')
      fail(429, 'MEDIA_BUSY', 'Ha arquivos em processamento. Tente novamente em instantes.')
    }
    active.add(request)
  })
  app.addHook('onResponse', async (request) => { active.delete(request) })
  app.addHook('onError', async (request) => { active.delete(request) })
}
