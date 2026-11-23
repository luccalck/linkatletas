import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { installMediaLimits } from '../../server/modules/media/limits.js'
import { installErrors } from '../../server/shared/errors.js'

describe('limite de processamento simultaneo de arquivos', () => {
  it('recusa excesso sem enfileirar corpos e libera slots apos erro e resposta', async () => {
    const app = Fastify()
    app.decorateRequest('user', null)
    app.addHook('onRequest', async (req) => { req.user = { id: 'fixture', name: 'Fixture', email: 'fixture@example.invalid', role: 'coach' } })
    installErrors(app)
    installMediaLimits(app)
    const release: (() => void)[] = []
    app.post('/api/media', async () => { await new Promise<void>((resolve) => release.push(resolve)); return { ok: true } })
    app.post('/api/media/uploads/:id/complete', async () => { throw new Error('private-error') })
    app.get('/api/health', async () => ({ ok: true }))
    const first = app.inject({ method: 'POST', url: '/api/media' }).then((r) => r)
    const second = app.inject({ method: 'POST', url: '/api/media' }).then((r) => r)
    try {
      await expect.poll(() => release.length).toBe(2)
      const excess = await app.inject({ method: 'POST', url: '/api/media' })
      expect(excess.statusCode).toBe(429)
      expect(excess.headers['retry-after']).toBe('1')
      expect((await app.inject('/api/health')).statusCode).toBe(200)
      release.shift()!()
      await first
      expect((await app.inject({ method: 'POST', url: '/api/media/uploads/fixture/complete' })).statusCode).toBe(500)
      expect((await app.inject({ method: 'POST', url: '/api/media/uploads/fixture/complete' })).statusCode).toBe(500)
    } finally {
      for (const finish of release) finish()
      await Promise.all([first, second])
      await app.close()
    }
  })
})
