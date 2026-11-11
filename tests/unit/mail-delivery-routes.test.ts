import Fastify, { type FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const smtp = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn() }))
const lifetime = vi.hoisted(() => ({ waitUntil: vi.fn() }))
const passwords = vi.hoisted(() => ({ hashPassword: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => smtp } }))
vi.mock('@vercel/functions', () => lifetime)
vi.mock('../../server/shared/security.js', async (original) => ({
  ...await original<typeof import('../../server/shared/security.js')>(),
  hashPassword: passwords.hashPassword,
}))

import { platformRoutes } from '../../server/modules/privacy/routes.js'
import { drainMailDeliveries } from '../../server/services/mail.js'
import { encryptPrivate } from '../../server/shared/crypto.js'

describe('entrega imediata de recuperacao e confirmacao de senha', () => {
  let app: FastifyInstance
  let existing: boolean
  let failInsert: boolean
  let pool: Pool
  let query: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetAllMocks()
    passwords.hashPassword.mockResolvedValue('password-hash')
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('DATA_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'))
    existing = true
    failInsert = false
    query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT id,email FROM users')) return { rows: existing ? [{ id: 'user-id', email: 'atleta@example.com' }] : [] }
      if (sql.startsWith('SELECT r.user_id')) return { rows: [{ user_id: 'user-id', email: 'atleta@example.com' }] }
      if (sql.startsWith('INSERT INTO password_resets') && failInsert) throw new Error('Banco indisponivel')
      if (sql.startsWith('INSERT INTO password_resets')) return { rows: [{ expires_at: new Date(Date.now() + 1800000) }] }
      if (sql.startsWith('INSERT INTO mail_outbox')) return { rows: [{ id: 'mail-id' }] }
      if (sql.startsWith('SELECT *')) return { rows: [{ id: 'mail-id', recipient: 'atleta@example.com', subject: 'Recuperacao', encrypted_body: encryptPrivate('token-secreto') }] }
      if (sql.startsWith('SELECT disabled_at')) return { rows: [{ disabled_at: null }] }
      return { rows: [], rowCount: 1 }
    })
    pool = { connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }) } as unknown as Pool
    app = Fastify()
    await platformRoutes(app, pool)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    vi.unstubAllEnvs()
  })

  it.each(['/auth', '/auth/native'])('responde sem esperar SMTP em %s e registra a tarefa apos commit', async (prefix) => {
    let finish!: () => void
    smtp.sendMail.mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
    try {
      const response = await app.inject({ method: 'POST', url: `${prefix}/forgot-password`, payload: { email: 'atleta@example.com' } })
      expect(response.statusCode).toBe(200)
      await vi.waitFor(() => expect(smtp.sendMail).toHaveBeenCalledOnce())
      expect(lifetime.waitUntil).toHaveBeenCalledExactlyOnceWith(expect.any(Promise))
      const statements = query.mock.calls.map(([sql]) => sql)
      expect(statements.indexOf('COMMIT')).toBeLessThan(statements.findIndex((sql) => sql.startsWith('SELECT * FROM mail_outbox')))
      existing = false
      const missing = await app.inject({ method: 'POST', url: `${prefix}/forgot-password`, payload: { email: 'ausente@example.com' } })
      expect(missing.json()).toEqual(response.json())
      expect(lifetime.waitUntil).toHaveBeenCalledOnce()
    } finally {
      finish()
      await drainMailDeliveries(pool)
    }
  })

  it('aguarda tarefas locais antes de encerrar o aplicativo', async () => {
    vi.stubEnv('VERCEL', '')
    let finish!: () => void
    smtp.sendMail.mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
    await app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: 'atleta@example.com' } })
    let closed = false
    const closing = app.close().then(() => { closed = true })
    try {
      await new Promise((resolve) => setImmediate(resolve))
      expect(closed).toBe(false)
      expect(lifetime.waitUntil).not.toHaveBeenCalled()
    } finally {
      finish()
      await closing
    }
    expect(closed).toBe(true)
  })

  it('mantem o envio bloqueado no preview mesmo apos enfileirar', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    const response = await app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: 'atleta@example.com' } })
    await drainMailDeliveries(pool)
    expect(response.statusCode).toBe(200)
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO mail_outbox'), expect.any(Array))
    expect(smtp.sendMail).not.toHaveBeenCalled()
    expect(query.mock.calls.some(([sql]) => sql.startsWith('SELECT * FROM mail_outbox'))).toBe(false)
  })

  it.each(['/auth', '/auth/native'])('confirma a troca em %s mesmo quando SMTP falha', async (prefix) => {
    smtp.sendMail.mockRejectedValue(new Error('Falha SMTP com credencial privada'))
    const response = await app.inject({ method: 'POST', url: `${prefix}/reset-password`, payload: { token: 'a'.repeat(64), password: 'SenhaNova123!' } })
    await drainMailDeliveries(pool)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true })
    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE users SET password_hash'), ['password-hash', 'user-id'])
    expect(query).toHaveBeenCalledWith('DELETE FROM sessions WHERE user_id=$1', ['user-id'])
    expect(query).toHaveBeenCalledWith(expect.stringContaining('next_attempt_at='), ['mail-id'])
    expect(lifetime.waitUntil).toHaveBeenCalledOnce()
  })

  it('nao tenta enviar antes de uma transacao revertida', async () => {
    failInsert = true
    const response = await app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: 'atleta@example.com' } })
    expect(response.statusCode).toBe(500)
    expect(query).toHaveBeenCalledWith('ROLLBACK')
    expect(smtp.sendMail).not.toHaveBeenCalled()
    expect(lifetime.waitUntil).not.toHaveBeenCalled()
  })

  it('registra somente uma mensagem generica quando a entrega nao consegue acessar o banco', async () => {
    const warning = vi.spyOn(app.log, 'warn')
    const connect = pool.connect as ReturnType<typeof vi.fn>
    connect.mockResolvedValueOnce({ query, release: vi.fn() }).mockRejectedValueOnce(new Error('postgres://user:password@private-host'))
    const response = await app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: 'atleta@example.com' } })
    await drainMailDeliveries(pool)
    expect(response.statusCode).toBe(200)
    expect(warning).toHaveBeenCalledWith('Entrega de email adiada para o cron.')
    expect(JSON.stringify(warning.mock.calls)).not.toContain('password')
  })
})
