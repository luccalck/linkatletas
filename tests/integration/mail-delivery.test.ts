import { randomBytes, randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import type { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const smtp = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => smtp } }))

import { createPool } from '../../server/db/pool.js'
import { migrate } from '../../server/db/migrate.js'
import { queueMail, deliverOutbox } from '../../server/services/mail.js'
import { readMailQueueHealth } from '../../server/services/mail-queue-health.js'
import { scheduledRoutes } from '../../server/scheduled.js'
import { platformRoutes } from '../../server/modules/privacy/routes.js'
import { tokenHash } from '../../server/shared/security.js'

const url = process.env.TEST_DATABASE_URL || 'postgresql://linkatletas:linkatletas_dev@127.0.0.1:54329/linkatletas_test'
if (!decodeURIComponent(new URL(url).pathname).endsWith('_test')) throw new Error('Entrega de email exige banco isolado com sufixo _test.')
let pool: Pool
let userId: string

beforeAll(async () => { pool = createPool(url); await migrate(pool) })
afterAll(async () => { await pool?.end() })
beforeEach(async () => {
  vi.resetAllMocks()
  vi.stubEnv('VERCEL_ENV', '')
  userId = randomUUID()
  await pool.query("INSERT INTO users(id,name,email,password_hash,role) VALUES($1,'Teste de email',$2,'fixture','athlete')", [userId, userId + '@example.invalid'])
})
afterEach(async () => {
  await pool.query('DELETE FROM users WHERE id=$1', [userId])
  vi.unstubAllEnvs()
})

async function resetMail(interval = '30 minutes', actor = userId) {
  const rawToken = randomBytes(32).toString('hex')
  const token = tokenHash(rawToken)
  const reset = (await pool.query('INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES($1,$2,now()+$3::interval) RETURNING expires_at', [token, actor, interval])).rows[0]
  const id = await queueMail(pool, userId, 'fixture@example.invalid', 'Recuperacao ficticia', 'conteudo-' + token, { tokenHash: token, expiresAt: reset.expires_at })
  return { id, token, rawToken }
}

async function row(id: string) {
  return (await pool.query('SELECT sent_at,discarded_at,discard_reason,encrypted_body,attempts,last_error FROM mail_outbox WHERE id=$1', [id])).rows[0]
}

describe('entrega temporal e estado da fila com PostgreSQL real', () => {
  it('envia uma recuperacao valida e elimina seu corpo cifrado', async () => {
    const mail = await resetMail()
    expect(await deliverOutbox(pool, mail.id)).toEqual({ sent: 1 })
    expect(smtp.sendMail).toHaveBeenCalledOnce()
    expect(await row(mail.id)).toMatchObject({ encrypted_body: '', attempts: 1, discarded_at: null })
    expect((await row(mail.id)).sent_at).not.toBeNull()
  })

  it.each([
    ['-1 minute', false, 'expired'],
    ['30 minutes', true, 'used'],
  ])('descarta recuperacao vencida ou utilizada sem chamar SMTP', async (interval, used, reason) => {
    const mail = await resetMail(interval as string)
    if (used) await pool.query('UPDATE password_resets SET used_at=now() WHERE token_hash=$1', [mail.token])
    expect(await deliverOutbox(pool, mail.id)).toEqual({ sent: 0 })
    expect(smtp.sendMail).not.toHaveBeenCalled()
    expect(await row(mail.id)).toMatchObject({ encrypted_body: '', sent_at: null, discard_reason: reason, attempts: 0 })
    expect((await row(mail.id)).discarded_at).not.toBeNull()
  })

  it('recusa o envio se o token expira durante as retentativas', async () => {
    const mail = await resetMail()
    smtp.sendMail.mockRejectedValueOnce(new Error('Falha externa ficticia'))
    expect(await deliverOutbox(pool, mail.id)).toEqual({ sent: 0 })
    expect(await row(mail.id)).toMatchObject({ attempts: 1, sent_at: null, discarded_at: null })
    await pool.query("UPDATE password_resets SET expires_at=now()-interval '1 minute' WHERE token_hash=$1", [mail.token])
    await pool.query("UPDATE mail_outbox SET next_attempt_at=now()-interval '1 second' WHERE id=$1", [mail.id])
    expect(await deliverOutbox(pool, mail.id)).toEqual({ sent: 0 })
    expect(smtp.sendMail).toHaveBeenCalledOnce()
    expect(await row(mail.id)).toMatchObject({ discard_reason: 'expired', encrypted_body: '', attempts: 1 })
    expect(await readMailQueueHealth(pool)).toMatchObject({ healthy: false, failedDiscarded: 1 })
    await pool.query('DELETE FROM password_resets WHERE user_id=$1', [userId])
    expect(await readMailQueueHealth(pool)).toMatchObject({ healthy: true, failedDiscarded: 0 })
  })

  it('remove a mensagem substituida ao invalidar o token anterior', async () => {
    const previous = await resetMail()
    await pool.query('DELETE FROM password_resets WHERE user_id=$1', [userId])
    expect(await row(previous.id)).toBeUndefined()
    const current = await resetMail()
    expect(await deliverOutbox(pool, previous.id)).toEqual({ sent: 0 })
    expect(await deliverOutbox(pool, current.id)).toEqual({ sent: 1 })
    expect(smtp.sendMail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ text: 'conteudo-' + current.token }))
  })

  it('mantem notificacao de seguranca independente da limpeza dos tokens', async () => {
    await resetMail()
    const id = await queueMail(pool, userId, 'fixture@example.invalid', 'Senha alterada', 'Confirmacao ficticia')
    await pool.query('DELETE FROM password_resets WHERE user_id=$1', [userId])
    expect(await deliverOutbox(pool, id)).toEqual({ sent: 1 })
  })

  it('descarta registro legado sem classificacao em vez de enviar instrucao desconhecida', async () => {
    const id = (await pool.query("INSERT INTO mail_outbox(user_id,recipient,subject,encrypted_body) VALUES($1,'fixture@example.invalid','Legado','conteudo legado') RETURNING id", [userId])).rows[0].id
    expect(await deliverOutbox(pool, id)).toEqual({ sent: 0 })
    expect(await row(id)).toMatchObject({ encrypted_body: '', discard_reason: 'legacy' })
    expect(smtp.sendMail).not.toHaveBeenCalled()
  })

  it('descarta envio quando a conta foi encerrada', async () => {
    const mail = await resetMail()
    await pool.query('UPDATE users SET disabled_at=now() WHERE id=$1', [userId])
    expect(await deliverOutbox(pool, mail.id)).toEqual({ sent: 0 })
    expect(await row(mail.id)).toMatchObject({ discard_reason: 'inactive_account', encrypted_body: '' })
    expect(smtp.sendMail).not.toHaveBeenCalled()
  })

  it('distingue falha transitoria de esgotamento e atraso sem expor conteudo', async () => {
    const mail = await resetMail()
    smtp.sendMail.mockRejectedValue(new Error('SMTP ficticio indisponivel'))
    await deliverOutbox(pool, mail.id)
    expect(await readMailQueueHealth(pool)).toMatchObject({ healthy: true, exhausted: 0, overdue: 0 })
    await pool.query('UPDATE mail_outbox SET attempts=5 WHERE id=$1', [mail.id])
    expect(await readMailQueueHealth(pool)).toMatchObject({ healthy: false, exhausted: 1 })
    await pool.query("UPDATE mail_outbox SET attempts=1,created_at=now()-interval '31 minutes' WHERE id=$1", [mail.id])
    const state = await readMailQueueHealth(pool)
    expect(state).toMatchObject({ healthy: false, overdue: 1 })
    expect(JSON.stringify(state)).not.toContain(mail.token)
    expect(JSON.stringify(state)).not.toContain('fixture@example.invalid')
  })

  it('sinaliza HTTP 503 para uma recuperacao descartada depois de falha e volta a 200 apos substituicao', async () => {
    const mail = await resetMail('-1 minute')
    await pool.query('UPDATE mail_outbox SET attempts=1 WHERE id=$1', [mail.id])
    await deliverOutbox(pool, mail.id)
    const app = Fastify()
    const secret = 'q'.repeat(32)
    scheduledRoutes(app, async () => ({ skipped: false, result: { mailHealth: await readMailQueueHealth(pool) } }), () => secret, () => readMailQueueHealth(pool))
    try {
      expect((await app.inject('/api/internal/queues')).statusCode).toBe(401)
      const failed = await app.inject({ url: '/api/internal/queues', headers: { authorization: 'Bearer ' + secret } })
      expect(failed.statusCode).toBe(503)
      expect(failed.json()).toMatchObject({ healthy: false, failedDiscarded: 1 })
      expect((await app.inject({ url: '/api/internal/jobs', headers: { authorization: 'Bearer ' + secret } })).statusCode).toBe(200)
      expect(failed.body).not.toContain(mail.token)
      expect(failed.body).not.toContain('fixture@example.invalid')
      await pool.query('DELETE FROM password_resets WHERE user_id=$1', [userId])
      const recovered = await app.inject({ url: '/api/internal/queues', headers: { authorization: 'Bearer ' + secret } })
      expect(recovered.statusCode).toBe(200)
      expect(recovered.json().healthy).toBe(true)
    } finally { await app.close() }
  })

  it('uma redefinicao bloqueada no usuario nao impede invalidar seu token', async () => {
    const mail = await resetMail()
    const app = Fastify()
    await platformRoutes(app, pool)
    const owner = await pool.connect()
    await owner.query('BEGIN')
    await owner.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])
    const response = app.inject({ method: 'POST', url: '/auth/native/reset-password', payload: { token: mail.rawToken, password: 'nova-senha-ficticia-123' } }).then((result) => result)
    try {
      await vi.waitFor(async () => {
        const waiting = await pool.query("SELECT count(*)::int AS total FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND query LIKE 'SELECT id FROM users WHERE id=(SELECT user_id FROM password_resets%' AND wait_event_type='Lock'")
        expect(waiting.rows[0].total).toBeGreaterThan(0)
      })
      await owner.query('DELETE FROM password_resets WHERE token_hash=$1', [mail.token])
      await owner.query('COMMIT')
      expect((await response).statusCode).toBe(400)
      expect(smtp.sendMail).not.toHaveBeenCalled()
    } finally {
      await owner.query('ROLLBACK')
      owner.release()
      await response
      await app.close()
    }
  })

  it('recusa token que vence enquanto a redefinicao aguarda o bloqueio do usuario', async () => {
    const mail = await resetMail()
    const app = Fastify()
    await platformRoutes(app, pool)
    const owner = await pool.connect()
    await owner.query('BEGIN')
    await owner.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])
    const response = app.inject({ method: 'POST', url: '/auth/native/reset-password', payload: { token: mail.rawToken, password: 'nova-senha-ficticia-123' } }).then((result) => result)
    try {
      await vi.waitFor(async () => {
        const waiting = await pool.query("SELECT count(*)::int AS total FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND query LIKE 'SELECT id FROM users WHERE id=(SELECT user_id FROM password_resets%' AND wait_event_type='Lock'")
        expect(waiting.rows[0].total).toBeGreaterThan(0)
      })
      await owner.query("UPDATE password_resets SET expires_at=clock_timestamp()+interval '100 milliseconds' WHERE token_hash=$1", [mail.token])
      await pool.query('SELECT pg_sleep(0.2)')
      await owner.query('COMMIT')
      expect((await response).statusCode).toBe(400)
      expect((await pool.query('SELECT password_hash FROM users WHERE id=$1', [userId])).rows[0].password_hash).toBe('fixture')
      expect(smtp.sendMail).not.toHaveBeenCalled()
    } finally {
      await owner.query('ROLLBACK')
      owner.release()
      await response
      await app.close()
    }
  })

  it('dois consumidores nao enviam a mesma mensagem simultaneamente', async () => {
    const mail = await resetMail()
    let finish!: () => void
    smtp.sendMail.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    const first = deliverOutbox(pool, mail.id)
    try {
      await vi.waitFor(() => expect(smtp.sendMail).toHaveBeenCalledOnce())
      expect(await deliverOutbox(pool, mail.id)).toEqual({ sent: 0 })
    } finally { finish?.() }
    expect(await first).toEqual({ sent: 1 })
    expect(smtp.sendMail).toHaveBeenCalledOnce()
  })

  it('um item bloqueado no inicio nao impede o envio do proximo item livre', async () => {
    const first = await queueMail(pool, userId, 'fixture@example.invalid', 'Primeiro', 'Primeira notificacao')
    const second = await queueMail(pool, userId, 'fixture@example.invalid', 'Segundo', 'Segunda notificacao')
    await pool.query("UPDATE mail_outbox SET created_at=now()-interval '1 minute' WHERE id=$1", [first])
    const owner = await pool.connect()
    try {
      await owner.query('BEGIN')
      await owner.query('SELECT id FROM mail_outbox WHERE id=$1 FOR UPDATE', [first])
      expect(await deliverOutbox(pool)).toEqual({ sent: 1 })
      expect(smtp.sendMail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ text: 'Segunda notificacao' }))
      expect((await row(second)).sent_at).not.toBeNull()
      expect((await row(first)).sent_at).toBeNull()
    } finally { await owner.query('ROLLBACK'); owner.release() }
  })

  it('invalida o token sem inverter bloqueios enquanto uma entrega esta em andamento', async () => {
    const mail = await resetMail()
    let finish!: () => void
    smtp.sendMail.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    const delivery = deliverOutbox(pool, mail.id)
    const revoker = await pool.connect()
    try {
      await vi.waitFor(() => expect(smtp.sendMail).toHaveBeenCalledOnce())
      await revoker.query('BEGIN')
      const pid = (await revoker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
      const removal = revoker.query('DELETE FROM password_resets WHERE token_hash=$1', [mail.token])
      await vi.waitFor(async () => {
        expect((await pool.query('SELECT cardinality(pg_blocking_pids($1)) AS total', [pid])).rows[0].total).toBeGreaterThan(0)
      })
      finish()
      expect(await delivery).toEqual({ sent: 1 })
      await removal
      await revoker.query('COMMIT')
      expect(await row(mail.id)).toBeUndefined()
    } finally { finish?.(); await revoker.query('ROLLBACK'); revoker.release(); await delivery }
  })

  it('o banco recusa referencia de recuperacao incompleta e descarte sem motivo', async () => {
    await expect(pool.query("INSERT INTO mail_outbox(user_id,recipient,subject,encrypted_body,purpose) VALUES($1,'fixture@example.invalid','Teste','cifra','password_reset')", [userId])).rejects.toMatchObject({ code: '23514' })
    await expect(pool.query("INSERT INTO mail_outbox(user_id,recipient,subject,encrypted_body,discarded_at) VALUES($1,'fixture@example.invalid','Teste','',now())", [userId])).rejects.toMatchObject({ code: '23514' })
  })
})
