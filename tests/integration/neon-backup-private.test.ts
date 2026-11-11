import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import type { Pool, PoolClient } from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createPool } from '../../server/db/pool.js'
import { migrate } from '../../server/db/migrate.js'
import { encryptPrivate } from '../../server/shared/crypto.js'
import { verifyPrivateData } from '../../scripts/banco/neon-backup-recovery.js'

const url = process.env.TEST_DATABASE_URL || 'postgresql://linkatletas:linkatletas_dev@127.0.0.1:54329/linkatletas_test'
if (!decodeURIComponent(new URL(url).pathname).endsWith('_test')) throw new Error('Recuperacao privada exige banco isolado com sufixo _test.')
let pool: Pool
let client: PoolClient | undefined
let userId: string

function database() {
  if (!client) throw new Error('Conexao isolada indisponivel.')
  return client
}

async function mail(value: string, sentAt: string | null) {
  await database().query('INSERT INTO mail_outbox(user_id,recipient,subject,encrypted_body,sent_at) VALUES($1,$2,$3,$4,$5)', [userId, 'fixture@example.invalid', 'Teste de recuperacao', value, sentAt])
}

const verify = () => verifyPrivateData(database() as unknown as pg.Client)

beforeAll(async () => {
  pool = createPool(url)
  await migrate(pool)
})

afterAll(async () => { await pool?.end() })

beforeEach(async () => {
  client = await pool.connect()
  await client.query('BEGIN')
  for (const table of ['private_health', 'executions', 'messages', 'media_feedback', 'consultations', 'mail_outbox']) {
    await client.query('DELETE FROM public.' + table)
  }
  userId = randomUUID()
  await client.query("INSERT INTO users(id,name,email,password_hash,role) VALUES($1,'Teste de recuperacao',$2,'fixture','athlete')", [userId, userId + '@example.invalid'])
})

afterEach(async () => {
  if (!client) return
  try { await client.query('ROLLBACK') } finally { client.release(); client = undefined }
})

describe('selecao real PostgreSQL de envelopes privados restaurados', () => {
  it('ignora mail descartado com corpo eliminado intencionalmente', async () => {
    await database().query("INSERT INTO mail_outbox(user_id,recipient,subject,encrypted_body,discarded_at,discard_reason) VALUES($1,'fixture@example.invalid','Descartado','',now(),'legacy')", [userId])
    expect(await verify()).toBe(0)
  })
  it('ignora somente mail entregue com corpo eliminado intencionalmente', async () => {
    await mail('', '2026-10-30T00:00:00Z')
    expect(await verify()).toBe(0)
  })

  it('rejeita mail pendente com corpo vazio', async () => {
    await mail('', null)
    await expect(verify()).rejects.toThrow()
  })

  it('descriptografa corpo historico valido mesmo que o mail ja tenha sido enviado', async () => {
    await mail(encryptPrivate('email ficticio historico'), '2026-10-30T00:00:00Z')
    expect(await verify()).toBe(1)
  })

  it('rejeita corpo enviado corrompido em vez de ignorar todos os entregues', async () => {
    await mail('la1:invalido', '2026-10-30T00:00:00Z')
    await expect(verify()).rejects.toThrow()
  })

  it('descriptografa mail pendente valido', async () => {
    await mail(encryptPrivate('email ficticio pendente'), null)
    expect(await verify()).toBe(1)
  })

  it('preserva a verificacao dos pendentes e historicos ao excluir o enviado vazio', async () => {
    await mail('', '2026-10-30T00:00:00Z')
    await mail(encryptPrivate('email ficticio pendente'), null)
    await mail(encryptPrivate('email ficticio historico'), '2026-10-30T00:00:00Z')
    expect(await verify()).toBe(2)
  })

  it('continua rejeitando corpo vazio em outra coluna privada', async () => {
    await database().query("INSERT INTO private_health(user_id,encrypted_data) VALUES($1,'')", [userId])
    await expect(verify()).rejects.toThrow()
  })
})
