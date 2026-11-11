import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'

const transport = vi.hoisted(() => ({ close: vi.fn(), sendMail: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => transport } }))

import {
  deliverOutbox,
  drainMailDeliveries,
  queueMail,
  scheduleMailDelivery,
} from '../../server/services/mail.js'
import { decryptPrivate, encryptPrivate } from '../../server/shared/crypto.js'

describe('liberacao do transporte SMTP', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('DATA_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('nao abre SMTP nem consulta a fila em deployments de preview', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    const pool = { connect: vi.fn() } as unknown as Pool
    await expect(deliverOutbox(pool)).resolves.toEqual({ sent: 0, disabled: true })
    expect(pool.connect).not.toHaveBeenCalled()
    expect(transport.sendMail).not.toHaveBeenCalled()
    expect(transport.close).not.toHaveBeenCalled()
  })

  it('fecha transporte quando nao existem mensagens pendentes', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    await expect(deliverOutbox(pool)).resolves.toEqual({ sent: 0 })
    expect(transport.close).toHaveBeenCalledOnce()
    expect(transport.sendMail).not.toHaveBeenCalled()
  })

  it('fecha transporte e preserva a falha quando o banco esta indisponivel', async () => {
    const error = new Error('Banco indisponivel')
    const pool = { connect: vi.fn().mockRejectedValue(error) } as unknown as Pool
    await expect(deliverOutbox(pool)).rejects.toBe(error)
    expect(transport.close).toHaveBeenCalledOnce()
    expect(transport.sendMail).not.toHaveBeenCalled()
  })

  it('retorna somente o identificador da mensagem e cifra o corpo na fila', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'mail-id' }] })
    const pool = { query } as unknown as Pool
    await expect(queueMail(pool, 'user-id', 'atleta@example.com', 'Recuperacao', 'token-secreto')).resolves.toBe('mail-id')
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain('RETURNING id')
    expect(params.slice(0, 3)).toEqual(['user-id', 'atleta@example.com', 'Recuperacao'])
    expect(params[3]).not.toContain('token-secreto')
    expect(decryptPrivate(params[3])).toBe('token-secreto')
  })

  it('envia apenas a mensagem indicada com bloqueio concorrente e limpa o corpo', async () => {
    const item = {
      id: 'mail-id',
      recipient: 'atleta@example.com',
      subject: 'Recuperacao',
      encrypted_body: encryptPrivate('token-secreto'),
    }
    const query = vi.fn().mockImplementation(async (sql: string) => ({ rows: sql.startsWith('SELECT') ? [item] : [] }))
    const client = { query, release: vi.fn() }
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    await expect(deliverOutbox(pool, item.id)).resolves.toEqual({ sent: 1 })
    const selections = query.mock.calls.filter(([sql]) => sql.startsWith('SELECT'))
    expect(selections).toHaveLength(3)
    expect(selections[1]).toEqual([
      expect.stringContaining('AND id=$1 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1'),
      [item.id],
    ])
    expect(transport.sendMail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      to: item.recipient,
      subject: item.subject,
      text: 'token-secreto',
    }))
    expect(query).toHaveBeenCalledWith(expect.stringContaining("sent_at=now(),encrypted_body=''"), [item.id])
    expect(query).toHaveBeenLastCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false)
    expect(transport.close).toHaveBeenCalledOnce()
  })

  it('mantem uma falha SMTP na fila para o cron tentar novamente', async () => {
    transport.sendMail.mockRejectedValue(new Error('SMTP indisponivel'))
    const item = { id: 'mail-id', recipient: 'atleta@example.com', subject: 'Recuperacao', encrypted_body: encryptPrivate('token-secreto') }
    const query = vi.fn().mockImplementation(async (sql: string) => ({ rows: sql.startsWith('SELECT') ? [item] : [] }))
    const client = { query, release: vi.fn() }
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    await expect(deliverOutbox(pool, item.id)).resolves.toEqual({ sent: 0 })
    expect(query).toHaveBeenCalledWith(expect.stringContaining("next_attempt_at=now()+interval '1 minute'*power(2,attempts)"), [item.id])
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("encrypted_body=''"), expect.anything())
    expect(query).toHaveBeenLastCalledWith('COMMIT')
    expect(transport.close).toHaveBeenCalledOnce()
  })

  it('nao envia nem atualiza uma mensagem ja bloqueada por outro consumidor', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const client = { query, release: vi.fn() }
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    await expect(deliverOutbox(pool, 'mail-id')).resolves.toEqual({ sent: 0 })
    expect(transport.sendMail).not.toHaveBeenCalled()
    expect(query.mock.calls.filter(([sql]) => String(sql).startsWith('UPDATE'))).toHaveLength(0)
  })

  it('registra a promessa no contexto real do SDK Vercel e aguarda sua conclusao', async () => {
    vi.stubEnv('VERCEL', '1')
    const waitUntil = vi.fn()
    vi.stubGlobal(Symbol.for('@vercel/request-context'), { get: () => ({ waitUntil }) })
    let finish!: () => void
    transport.sendMail.mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
    const item = { id: 'mail-id', recipient: 'atleta@example.com', subject: 'Recuperacao', encrypted_body: encryptPrivate('token-secreto') }
    const query = vi.fn().mockImplementation(async (sql: string) => ({ rows: sql.startsWith('SELECT') ? [item] : [] }))
    const client = { query, release: vi.fn() }
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    const error = vi.fn()
    scheduleMailDelivery(pool, item.id, error)
    try {
      expect(waitUntil).toHaveBeenCalledExactlyOnceWith(expect.any(Promise))
      await vi.waitFor(() => expect(transport.sendMail).toHaveBeenCalledOnce())
    } finally {
      finish()
      await waitUntil.mock.calls[0][0]
      await drainMailDeliveries(pool)
    }
    expect(error).not.toHaveBeenCalled()
    expect(transport.close).toHaveBeenCalledOnce()
  })
})
