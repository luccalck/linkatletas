import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPool } from '../../server/db/pool.js'
import { migrate } from '../../server/db/migrate.js'
import { runtimePrivileges } from '../../server/db/runtime-privileges.js'
import { verifyRestoredApplication } from '../../scripts/banco/neon-backup-recovery.js'
import type { FullNeonArchive } from '../../scripts/banco/neon-backup-shared.js'

const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgresql://linkatletas:linkatletas_dev@127.0.0.1:54329/linkatletas_test')
if (!decodeURIComponent(url.pathname).endsWith('_test')) throw new Error('Fluxo restaurado exige banco isolado com sufixo _test.')
const database = new pg.Client({ connectionString: url.toString() })
const originalEnvironment = { ...process.env }

beforeAll(async () => {
  const pool = createPool(url.toString())
  try { await migrate(pool) } finally { await pool.end() }
  await database.connect()
})

afterAll(async () => {
  await database.end()
  for (const name of Object.keys(process.env)) if (!Object.hasOwn(originalEnvironment, name)) delete process.env[name]
  Object.assign(process.env, originalEnvironment)
})

describe('aplicacao recuperada com privilegios limitados e tres perfis', () => {
  it('executa fluxo completo e remove somente as fixtures do proprio ensaio', async () => {
    const usersBefore = (await database.query('SELECT id,email FROM users ORDER BY id')).rows
    const rowsBefore = (await database.query('SELECT (SELECT count(*)::int FROM contracts) AS contracts,(SELECT count(*)::int FROM workouts) AS workouts,(SELECT count(*)::int FROM executions) AS executions')).rows
    process.env.DATA_ENCRYPTION_KEY ??= randomBytes(32).toString('base64')
    Object.assign(process.env, { NEON_BACKUP_RESTORE_S3_ENDPOINT: 'http://127.0.0.1:8333', NEON_BACKUP_RESTORE_S3_BUCKET: 'linkatletas-restore-flow-test', NEON_BACKUP_RESTORE_S3_ACCESS_KEY: 'linkatletas-local', NEON_BACKUP_RESTORE_S3_SECRET_KEY: 'local-only-change-in-production' })
    const archive = { tableCounts: Object.fromEntries(Object.keys(runtimePrivileges).map((table) => [table, 0])), runtimePrivileges } as unknown as FullNeonArchive
    const outcome = await verifyRestoredApplication(database, url, archive)
    expect(outcome.roles).toEqual({ athlete: true, coach: true, admin: true })
    expect(outcome.mainFlow).toEqual({ manualVerification: true, request: true, acceptance: true, prescription: true, execution: true, feedbackRead: true })
    expect(outcome.forbiddenOperationsRejected).toBe(true)
    expect(outcome.limitedRuntimeRole).toBe(true)
    expect((await database.query('SELECT id,email FROM users ORDER BY id')).rows).toEqual(usersBefore)
    expect((await database.query('SELECT (SELECT count(*)::int FROM contracts) AS contracts,(SELECT count(*)::int FROM workouts) AS workouts,(SELECT count(*)::int FROM executions) AS executions')).rows).toEqual(rowsBefore)
    expect((await database.query("SELECT count(*)::int AS total FROM pg_roles WHERE rolname LIKE 'linkatletas_restore_runtime_%'")).rows[0].total).toBe(0)
  })

  it('limpa fixtures e role tambem quando uma permissao necessaria esta ausente', async () => {
    const before = (await database.query('SELECT id,email FROM users ORDER BY id')).rows
    Object.assign(process.env, { NEON_BACKUP_RESTORE_S3_ENDPOINT: 'http://127.0.0.1:8333', NEON_BACKUP_RESTORE_S3_BUCKET: 'linkatletas-restore-flow-test', NEON_BACKUP_RESTORE_S3_ACCESS_KEY: 'linkatletas-local', NEON_BACKUP_RESTORE_S3_SECRET_KEY: 'local-only-change-in-production' })
    const archive = { tableCounts: Object.fromEntries(Object.keys(runtimePrivileges).map((table) => [table, 0])), runtimePrivileges: { ...runtimePrivileges, executions: ['SELECT'] } } as unknown as FullNeonArchive
    await expect(verifyRestoredApplication(database, url, archive)).rejects.toThrow('Ensaio restaurado falhou: athlete PUT /workouts/:id/execution status 500.')
    expect((await database.query('SELECT id,email FROM users ORDER BY id')).rows).toEqual(before)
    expect((await database.query("SELECT count(*)::int AS total FROM pg_roles WHERE rolname LIKE 'linkatletas_restore_runtime_%'")).rows[0].total).toBe(0)
  })

  it('recusa base sem sufixo de teste antes de criar qualquer role', async () => {
    const unsafe = new URL(url)
    unsafe.pathname = '/neondb'
    await expect(verifyRestoredApplication(database, unsafe, {} as FullNeonArchive)).rejects.toThrow('sufixo _test')
  })
})
