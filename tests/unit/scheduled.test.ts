import Fastify from 'fastify'
import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { runScheduledJobs, scheduledRoutes } from '../../server/scheduled.js'

const secret = 'a'.repeat(32)

describe('tarefas agendadas', () => {
  it.each([undefined, 'curta', secret])('recusa acesso sem autorizacao: %s', async (key) => {
    const app = Fastify()
    const work = vi.fn()
    scheduledRoutes(app, work, () => key)
    try {
      const response = await app.inject('/api/internal/jobs')
      expect(response.statusCode).toBe(401)
      expect(response.headers['cache-control']).toBe('no-store')
      expect(work).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it.each(['Bearer errada', `Bearer ${'b'.repeat(32)}`])('recusa token incorreto: %s', async (authorization) => {
    const app = Fastify()
    const work = vi.fn()
    scheduledRoutes(app, work, () => secret)
    try {
      const response = await app.inject({ url: '/api/internal/jobs', headers: { authorization } })
      expect(response.statusCode).toBe(401)
      expect(work).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it('executa somente com o segredo correto', async () => {
    const app = Fastify()
    const work = vi.fn().mockResolvedValue({ completed: true })
    scheduledRoutes(app, work, () => secret)
    try {
      const response = await app.inject({
        url: '/api/internal/jobs',
        headers: { authorization: `Bearer ${secret}` },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ completed: true })
      expect(work).toHaveBeenCalledOnce()
    } finally {
      await app.close()
    }
  })

  function database(locked: boolean) {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ locked }] }),
      release: vi.fn(),
    }
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    return { client, pool }
  }

  it.each([
    [{ skipped: false, result: { mailHealth: { healthy: false, pending: 1, exhausted: 1 } } }, 200],
    [{ skipped: false, result: { mailHealth: { healthy: true, pending: 1, exhausted: 0 } } }, 200],
    [{ skipped: true }, 200],
  ])('preserva o executor mesmo quando a fila precisa de atencao', async (outcome, status) => {
    const app = Fastify()
    const work = vi.fn().mockResolvedValue(outcome)
    scheduledRoutes(app, work, () => secret)
    try {
      const response = await app.inject({ url: '/api/internal/jobs', headers: { authorization: `Bearer ${secret}` } })
      expect(response.statusCode).toBe(status)
      expect(response.json()).toEqual(outcome)
      expect(response.headers['cache-control']).toBe('no-store')
      expect(JSON.stringify(response.json())).not.toMatch(/recipient|encrypted_body|token_hash/)
    } finally { await app.close() }
  })

  it.each([true, false])('o monitor separado usa autorizacao e sinaliza a saude: %s', async (healthy) => {
    const app = Fastify()
    const work = vi.fn()
    const health = vi.fn().mockResolvedValue({ healthy, pending: 1, exhausted: healthy ? 0 : 1 })
    scheduledRoutes(app, work, () => secret, health)
    try {
      expect((await app.inject('/api/internal/queues')).statusCode).toBe(401)
      expect(health).not.toHaveBeenCalled()
      expect((await app.inject({ url: '/api/internal/queues', headers: { authorization: 'Bearer errada' } })).statusCode).toBe(401)
      const response = await app.inject({ url: '/api/internal/queues', headers: { authorization: 'Bearer ' + secret } })
      expect(response.statusCode).toBe(healthy ? 200 : 503)
      expect(response.json().healthy).toBe(healthy)
      expect(response.headers['cache-control']).toBe('no-store')
      expect(work).not.toHaveBeenCalled()
    } finally { await app.close() }
  })

  it('evita outra execucao enquanto a trava esta ocupada', async () => {
    const { pool, client } = database(false)
    const work = vi.fn()
    expect(await runScheduledJobs(pool, work)).toEqual({ skipped: true })
    expect(work).not.toHaveBeenCalled()
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('mantem a trava dentro de uma transacao ate concluir o trabalho', async () => {
    const { pool, client } = database(true)
    const work = vi.fn(async () => {
      expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN')
      expect(client.release).not.toHaveBeenCalled()
      return { completed: true }
    })
    expect(await runScheduledJobs(pool, work)).toEqual({ skipped: false, result: { completed: true } })
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('libera a trava mesmo quando o trabalho falha', async () => {
    const { pool, client } = database(true)
    await expect(runScheduledJobs(pool, async () => { throw new Error('falha') })).rejects.toThrow('falha')
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('descarta a conexao quando nao consegue encerrar a transacao', async () => {
    const { pool, client } = database(true)
    client.query.mockRejectedValueOnce(new Error('banco indisponivel'))
    client.query.mockRejectedValueOnce(new Error('rollback indisponivel'))
    await expect(runScheduledJobs(pool, vi.fn())).rejects.toThrow('rollback indisponivel')
    expect(client.release).toHaveBeenCalledWith(true)
  })
})
