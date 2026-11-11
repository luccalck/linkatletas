import { randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
import { S3Client } from '@aws-sdk/client-s3'
import { decryptPrivate, encryptPrivate } from '../../server/shared/crypto.js'
import { type FullNeonArchive } from './neon-backup-shared.js'
import { readObject } from './neon-backup-objects.js'
import { GOALS, LEVELS, SLOTS, SPORTS } from '../../shared/contracts.js'

const encryptedColumns = [
  ['private_health', 'encrypted_data'], ['executions', 'private_payload'],
  ['messages', 'body_ciphertext'], ['media_feedback', 'encrypted_text'],
  ['consultations', 'description_ciphertext'], ['mail_outbox', 'encrypted_body'],
] as const

export async function verifyPrivateData(database: pg.Client) {
  let checked = 0
  const fixture = 'recuperacao-privada-ficticia-' + randomUUID()
  if (decryptPrivate(encryptPrivate(fixture)) !== fixture) throw new Error('Chave de dados nao passou no ensaio privado.')
  for (const [table, column] of encryptedColumns) {
    const predicate = column + ' IS NOT NULL' + (table === 'mail_outbox' ? " AND NOT ((sent_at IS NOT NULL OR (to_jsonb(mail_outbox)->>'discarded_at') IS NOT NULL) AND encrypted_body='')" : '')
    let offset = 0
    while (true) {
      const rows = (await database.query(`SELECT ${column} AS value FROM public.${table} WHERE ${predicate} ORDER BY ${table === 'private_health' ? 'user_id' : 'id'} LIMIT 100 OFFSET $1`, [offset])).rows
      for (const row of rows) {
        decryptPrivate(row.value)
        checked++
      }
      if (rows.length < 100) break
      offset += rows.length
    }
  }
  return checked
}

export async function verifyPrivateObjects(database: pg.Client, storage: S3Client, bucket: string, archive: FullNeonArchive) {
  const media = (await database.query('SELECT object_key,size FROM media WHERE deleted_at IS NULL ORDER BY object_key')).rows
  if (media.length !== archive.objects.length || new Set(archive.objects.map(object => object.sourceKey)).size !== media.length) throw new Error('Manifesto de arquivos nao cobre os registros ativos.')
  const manifest = new Map(archive.objects.map(object => [object.sourceKey, object]))
  for (const row of media) {
    const object = manifest.get(row.object_key)
    if (!object) throw new Error('Arquivo ativo ausente do manifesto.')
    const encrypted = await readObject(storage, bucket, object.sourceKey)
    const plain = decryptPrivate(encrypted.toString('utf8'))
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(plain) || Buffer.from(plain, 'base64').length !== row.size) throw new Error('Arquivo privado nao corresponde ao tamanho original.')
  }
  return media.length
}

export async function verifyRestoredApplication(database: pg.Client, url: URL, archive: FullNeonArchive) {
  if (!decodeURIComponent(url.pathname).endsWith('_test')) throw new Error('Ensaio da aplicacao exige banco isolado com sufixo _test.')
  const role = 'linkatletas_restore_runtime_' + randomBytes(8).toString('hex')
  const password = randomBytes(32).toString('base64url')
  const runtimeUrl = new URL(url)
  runtimeUrl.username = role
  runtimeUrl.password = password
  const prefix = 'restore-' + randomUUID()
  const emails: string[] = []
  const fixturePassword = randomBytes(24).toString('base64url')
  const originalEnvironment = { ...process.env }
  let app: import('fastify').FastifyInstance | undefined
  let pool: pg.Pool | undefined
  let roleCreated = false
  try {
    await database.query(`CREATE ROLE ${pg.escapeIdentifier(role)} LOGIN PASSWORD ${pg.escapeLiteral(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`)
    roleCreated = true
    await database.query(`GRANT ${pg.escapeIdentifier(role)} TO CURRENT_USER`)
    await database.query(`GRANT CONNECT ON DATABASE ${pg.escapeIdentifier(decodeURIComponent(url.pathname.slice(1)))} TO ${pg.escapeIdentifier(role)}`)
    await database.query(`GRANT USAGE ON SCHEMA public TO ${pg.escapeIdentifier(role)}`)
    for (const [table, privileges] of Object.entries(archive.runtimePrivileges)) {
      if (!Object.hasOwn(archive.tableCounts, table)) throw new Error('Permissao referencia tabela fora do manifesto.')
      if (privileges.length) await database.query(`GRANT ${privileges.join(',')} ON TABLE public.${pg.escapeIdentifier(table)} TO ${pg.escapeIdentifier(role)}`)
    }
    Object.assign(process.env, {
      NODE_ENV: 'test', VERCEL_ENV: 'preview', VERCEL_BRANCH_URL: '',
      DATABASE_URL: runtimeUrl.toString(), APP_ORIGIN: 'http://localhost:4173',
      BILLING_MODE: 'academic', ASAAS_API_KEY: '', ASAAS_WEBHOOK_TOKEN: '',
      S3_ENDPOINT: process.env.NEON_BACKUP_RESTORE_S3_ENDPOINT,
      S3_BUCKET: process.env.NEON_BACKUP_RESTORE_S3_BUCKET,
      S3_ACCESS_KEY: process.env.NEON_BACKUP_RESTORE_S3_ACCESS_KEY,
      S3_SECRET_KEY: process.env.NEON_BACKUP_RESTORE_S3_SECRET_KEY,
      S3_REGION: 'us-east-1', SMTP_HOST: '127.0.0.1', SMTP_PORT: '9',
      SMTP_USER: '', SMTP_PASSWORD: '', SMTP_FROM: 'backup@example.invalid',
      GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_ANDROID_CLIENT_ID: '', GOOGLE_IOS_CLIENT_ID: '',
    })
    pool = new pg.Pool({ connectionString: runtimeUrl.toString(), max: 2, connectionTimeoutMillis: 15000 })
    const { buildApp } = await import('../../server/app.js')
    app = await buildApp({ pool, logger: false, origin: 'http://localhost:4173', secureCookies: false, serveFrontend: false })
    const health = await app.inject({ method: 'GET', url: '/api/health' })
    if (health.statusCode !== 200 || health.json().ok !== true) throw new Error('Aplicacao restaurada nao passou no health.')
    const actor = async (kind: 'athlete' | 'coach' | 'admin') => {
      const email = `${prefix}-${kind}@example.invalid`
      emails.push(email)
      const signup = await app!.inject({ method: 'POST', url: '/api/auth/native/register', payload: { name: `Teste de recuperacao ${kind}`, email, password: fixturePassword, role: kind === 'admin' ? 'athlete' : kind } })
      if (signup.statusCode !== 201 || !signup.json().user?.id) throw new Error('Cadastro isolado nao persistiu apos restauracao.')
      const id = signup.json().user.id as string
      if (kind === 'admin') await database.query("UPDATE users SET role='admin' WHERE id=$1 AND email=$2", [id, email])
      const login = await app!.inject({ method: 'POST', url: '/api/auth/native/login', payload: { email, password: fixturePassword } })
      if (login.statusCode !== 200 || !login.json().token || login.json().user?.role !== kind) throw new Error('Login do perfil restaurado falhou.')
      return { id, kind, token: login.json().token as string }
    }
    const athlete = await actor('athlete')
    const coach = await actor('coach')
    const admin = await actor('admin')
    const request = async (who: typeof athlete, method: 'GET' | 'POST' | 'PUT' | 'PATCH', route: string, expected: number, payload?: Record<string, unknown>) => {
      const response = await app!.inject({ method, url: '/api' + route, headers: { authorization: 'Bearer ' + who.token, origin: 'http://localhost:4173' }, ...(payload === undefined ? {} : { payload }) })
      if (response.statusCode !== expected) throw new Error(`Ensaio restaurado falhou: ${who.kind} ${method} ${route.replace(/[a-f0-9-]{36}/g, ':id')} status ${response.statusCode}.`)
      return response.json()
    }
    for (const who of [athlete, coach, admin]) {
      const current = await request(who, 'GET', '/profiles/me', 200)
      if (current.profile?.userId !== who.id) throw new Error('Perfil autenticado restaurado diverge do titular.')
    }
    for (const who of [athlete, coach]) await request(who, 'PUT', '/profiles/me', 200, { name: `Teste de recuperacao ${who.kind}`, city: 'Cidade ficticia', bio: 'Ensaio isolado de recuperacao.', sports: [SPORTS[0]], goals: [GOALS[0]], levels: [LEVELS[0]], availability: [SLOTS[0]], mode: 'online', budget: 250, price: 150 })
    await request(athlete, 'GET', '/admin/verifications', 403)
    await request(coach, 'GET', '/admin/verifications', 403)
    const verification = await request(coach, 'POST', '/verifications', 201, { cref: 'TESTE-123456-G/SP', evidence: 'Conferencia ficticia restrita ao ensaio local de recuperacao.' })
    await request(athlete, 'PATCH', `/admin/verifications/${verification.verification.id}`, 403, { status: 'approved', reason: 'Nao autorizado.' })
    await request(admin, 'PATCH', `/admin/verifications/${verification.verification.id}`, 200, { status: 'approved', reason: 'Conferencia manual ficticia em recuperacao isolada.' })
    const contract = await request(athlete, 'POST', '/contracts', 201, { coachId: coach.id })
    await request(coach, 'PATCH', `/contracts/${contract.contract.id}`, 200, { status: 'active' })
    const workoutInput = { contractId: contract.contract.id, title: 'Treino ficticio de recuperacao', sport: SPORTS[0], scheduledDate: new Date().toISOString().slice(0, 10), instructions: 'Ensaio com dados ficticios.', status: 'published', blocks: [{ name: 'Aquecimento', instructions: 'Caminhada de teste.', durationMinutes: 10 }] }
    await request(athlete, 'POST', '/workouts', 403, workoutInput)
    await request(admin, 'POST', '/workouts', 403, workoutInput)
    const workout = await request(coach, 'POST', '/workouts', 201, workoutInput)
    const executionInput = { completedBlocks: [0], effort: 5, notes: 'Execucao ficticia em restauracao.', metrics: {} }
    await request(coach, 'PUT', `/workouts/${workout.workout.id}/execution`, 403, executionInput)
    await request(athlete, 'PUT', `/workouts/${workout.workout.id}/execution`, 200, executionInput)
    const checkedWorkout = await request(coach, 'GET', `/workouts/${workout.workout.id}`, 200)
    if (!checkedWorkout.workout?.execution || checkedWorkout.workout.execution.notes !== executionInput.notes) throw new Error('Execucao restaurada nao ficou visivel ao treinador.')
    const persisted = await database.query('SELECT count(*)::int AS total FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.email=ANY($1::text[])', [emails])
    const flowPersisted = await database.query('SELECT count(*)::int AS total FROM contracts c JOIN workouts w ON w.contract_id=c.id JOIN executions e ON e.workout_id=w.id WHERE c.athlete_id=$1 AND c.coach_id=$2 AND w.id=$3', [athlete.id, coach.id, workout.workout.id])
    if (persisted.rows[0].total !== 3 || flowPersisted.rows[0].total !== 1) throw new Error('Persistencia do fluxo restaurado nao comprovada.')
    const blocked = await app.inject({ method: 'POST', url: '/api/auth/native/register', payload: { name: 'Conta invalida', email: 'invalid', password: 'x', role: 'admin' } })
    if (blocked.statusCode !== 400) throw new Error('Validacao de entrada restaurada falhou.')
    for (const who of [athlete, coach, admin]) await request(who, 'POST', '/auth/logout', 200)
    return { health: true, signup: true, login: true, profile: true, persisted: true, invalidInputRejected: true, logout: true, limitedRuntimeRole: true, roles: { athlete: true, coach: true, admin: true }, mainFlow: { manualVerification: true, request: true, acceptance: true, prescription: true, execution: true, feedbackRead: true }, forbiddenOperationsRejected: true }
  } finally {
    try {
      try { await app?.close() } finally { await pool?.end() }
      if (emails.length) {
        await database.query('DELETE FROM verifications WHERE coach_id IN (SELECT id FROM users WHERE email=ANY($1::text[]))', [emails])
        await database.query('DELETE FROM users WHERE email=ANY($1::text[])', [emails])
      }
    } finally {
      try {
        if (roleCreated) {
          await database.query(`DROP OWNED BY ${pg.escapeIdentifier(role)}`)
          await database.query(`DROP ROLE ${pg.escapeIdentifier(role)}`)
        }
      } finally {
        for (const name of Object.keys(process.env)) if (!Object.hasOwn(originalEnvironment, name)) delete process.env[name]
        Object.assign(process.env, originalEnvironment)
      }
    }
  }
}
