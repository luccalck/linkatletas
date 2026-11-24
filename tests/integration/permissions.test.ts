import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance, InjectOptions } from 'fastify'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildApp } from '../../server/app.js'
import { createPool } from '../../server/db/pool.js'
import { migrate } from '../../server/db/migrate.js'
import { deleteMediaObjects } from '../../server/modules/media/routes.js'
import { GOALS, LEVELS, SLOTS, SPORTS } from '../../shared/contracts.js'

type Role = 'athlete' | 'coach' | 'admin'
type Actor = { id: string; token: string; role: Role; email: string }
type Operation = {
  method: InjectOptions['method']
  path: string
  roles?: Role[]
  payload?: unknown
}
const testUrl = process.env.TEST_DATABASE_URL ??
  'postgresql://linkatletas:linkatletas_dev@127.0.0.1:54329/linkatletas_test'
if (!decodeURIComponent(new URL(testUrl).pathname).endsWith('_test'))
  throw new Error('A auditoria exige banco com sufixo _test.')
const pool = createPool(testUrl)
const origin = 'http://localhost:5173'
const password = 'SenhaAuditoria123!'
const missing = '00000000-0000-4000-8000-000000000001'
const future = () => new Date(Date.now() + 86400000 * 3).toISOString()
const profile = {
  name: 'Perfil Auditoria', city: 'Taubate', bio: 'Dados ficticios de auditoria',
  sports: ['Corrida'], goals: [GOALS[0]], levels: [LEVELS[0]],
  availability: [SLOTS[0]], mode: 'online', budget: 250, price: 150,
}
const workoutInput = (contractId: string, status = 'published') => ({
  contractId, title: 'Treino ficticio de auditoria', sport: 'Corrida',
  scheduledDate: '2026-10-27', instructions: 'Fixture sem treino real', status,
  blocks: [{ name: 'Bloco ficticio', instructions: 'Dados de teste', durationMinutes: 10 }],
})
const operations: Operation[] = [
  { method: 'GET', path: '/profiles/me' },
  { method: 'PUT', path: '/profiles/me', roles: ['athlete', 'coach'], payload: profile },
  { method: 'GET', path: '/verifications', roles: ['coach'] },
  { method: 'POST', path: '/verifications', roles: ['coach'], payload: { cref: '000123-G/SP', evidence: 'Evidencia ficticia de auditoria' } },
  { method: 'GET', path: '/admin/verifications', roles: ['admin'] },
  { method: 'PATCH', path: '/admin/verifications/{id}', roles: ['admin'], payload: { status: 'approved', reason: 'Analise ficticia' } },
  { method: 'PATCH', path: '/admin/coaches/{id}/verification', roles: ['admin'], payload: { status: 'suspended', reason: 'Suspensao ficticia' } },
  { method: 'GET', path: '/coaches', roles: ['athlete'] },
  { method: 'GET', path: '/contracts' },
  { method: 'POST', path: '/contracts', roles: ['athlete'], payload: { coachId: missing } },
  { method: 'PATCH', path: '/contracts/{id}', roles: ['coach'], payload: { status: 'active' } },
  { method: 'POST', path: '/contracts/{id}/cancel', payload: { reason: 'Cancelamento ficticio' } },
  { method: 'GET', path: '/workouts' },
  { method: 'POST', path: '/workouts', roles: ['coach'], payload: workoutInput(missing) },
  { method: 'GET', path: '/workouts/{id}' },
  { method: 'PUT', path: '/workouts/{id}', roles: ['coach'], payload: workoutInput(missing) },
  { method: 'PUT', path: '/workouts/{id}/execution', roles: ['athlete'], payload: { completedBlocks: [0], effort: 5, notes: 'Execucao ficticia', metrics: {} } },
  { method: 'GET', path: '/metrics' },
  { method: 'GET', path: '/dashboard' },
  { method: 'GET', path: '/privacy/consents' },
  { method: 'PUT', path: '/privacy/consents', payload: { purpose: 'health', granted: true } },
  { method: 'GET', path: '/privacy/health' },
  { method: 'PUT', path: '/privacy/health', payload: { notes: 'Saude ficticia', heightCm: 180 } },
  { method: 'GET', path: '/privacy/export' },
  { method: 'POST', path: '/privacy/delete', payload: { password } },
  { method: 'GET', path: '/admin/privacy/requests', roles: ['admin'] },
  { method: 'POST', path: '/media/uploads', payload: { purpose: 'instruction', resourceId: missing, name: 'fixture.png', mimeType: 'image/png', size: 8 } },
  { method: 'PUT', path: '/media/uploads/{id}/parts/{part}', payload: Buffer.from('fixture1') },
  { method: 'DELETE', path: '/media/uploads/{id}' },
  { method: 'POST', path: '/media/uploads/{id}/complete' },
  { method: 'POST', path: '/media' },
  { method: 'GET', path: '/media' },
  { method: 'GET', path: '/media/{id}/content' },
  { method: 'DELETE', path: '/media/{id}' },
  { method: 'POST', path: '/media/{id}/feedback', roles: ['coach'], payload: { text: 'Correcao ficticia' } },
  { method: 'GET', path: '/contracts/{id}/messages' },
  { method: 'POST', path: '/contracts/{id}/messages', payload: { text: 'Mensagem ficticia' } },
  { method: 'PUT', path: '/contracts/{id}/messages/read', payload: {} },
  { method: 'GET', path: '/notifications' },
  { method: 'PUT', path: '/notifications', payload: { all: true } },
  { method: 'GET', path: '/reviews' },
  { method: 'POST', path: '/reviews', roles: ['athlete'], payload: { contractId: missing, rating: 5, text: 'Avaliacao ficticia' } },
  { method: 'PUT', path: '/reviews/{id}', roles: ['athlete'], payload: { rating: 4, text: 'Edicao ficticia' } },
  { method: 'POST', path: '/reviews/{id}/reply', roles: ['coach'], payload: { text: 'Resposta ficticia' } },
  { method: 'POST', path: '/reviews/{id}/report', payload: { reason: 'Denuncia ficticia' } },
  { method: 'GET', path: '/admin/reviews', roles: ['admin'] },
  { method: 'PATCH', path: '/admin/reviews/{id}', roles: ['admin'], payload: { hidden: true, reason: 'Moderacao ficticia' } },
  { method: 'GET', path: '/consultations' },
  { method: 'POST', path: '/consultations', payload: { contractId: missing, title: 'Consultoria ficticia', description: 'Fixture', startsAt: future(), durationMinutes: 30 } },
  { method: 'PATCH', path: '/consultations/{id}', payload: { status: 'cancelled', reason: 'Cancelamento ficticio' } },
  { method: 'GET', path: '/consultations/{id}/history' },
  { method: 'POST', path: '/consultations/{id}/google-event', payload: { eventId: 'fixture_event', meetingUrl: 'https://meet.google.com/abc-defg-hij' } },
  { method: 'GET', path: '/admin/billing/jobs', roles: ['admin'] },
  { method: 'POST', path: '/admin/billing/reconcile', roles: ['admin'] },
  { method: 'GET', path: '/billing/config' },
  { method: 'GET', path: '/billing/wallet', roles: ['coach'] },
  { method: 'PUT', path: '/billing/wallet', roles: ['coach'], payload: { walletId: missing } },
  { method: 'GET', path: '/billing/plan', roles: ['coach'] },
  { method: 'PUT', path: '/billing/plan', roles: ['coach'], payload: { name: 'Plano ficticio', amountCents: 15000, active: true } },
  { method: 'GET', path: '/billing/plans' },
  { method: 'PATCH', path: '/admin/billing/settings', roles: ['admin'], payload: { commissionBps: 1000, graceDays: 3 } },
  { method: 'POST', path: '/billing/checkout', roles: ['athlete'], payload: { contractId: missing } },
  { method: 'GET', path: '/billing/summary' },
  { method: 'POST', path: '/billing/subscriptions/{id}/cancel', payload: { reason: 'Cancelamento ficticio' } },
]
let app: FastifyInstance
let athlete: Actor, otherAthlete: Actor, coach: Actor, otherCoach: Actor, admin: Actor
let contractId: string, pendingId: string, workoutId: string, draftId: string
let reviewId: string, consultationId: string, notificationId: string
const previousMode = process.env.BILLING_MODE
const recordedRequests: Array<{ method: string; path: string; role: string; status: number }> = []
async function request(actor: Actor | null, method: InjectOptions['method'], path: string, payload?: unknown, headers: Record<string, string> = {}) {
  const response = await app.inject({
    method, url: '/api' + path,
    headers: {
      origin,
      ...(actor ? { authorization: 'Bearer ' + actor.token } : {}),
      ...(Buffer.isBuffer(payload) ? { 'content-type': 'application/octet-stream' } : {}),
      ...headers,
    },
    ...(payload === undefined ? {} : { payload: payload as InjectOptions['payload'] }),
  })
  recordedRequests.push({ method: String(method), path, role: actor?.role ?? 'visitor', status: response.statusCode })
  return response
}
async function signup(role: Role, label: string): Promise<Actor> {
  const email = `${role}-${randomUUID()}@permissions-test.local`
  const response = await request(null, 'POST', '/auth/native/register', {
    name: label, email, password, role: role === 'admin' ? 'athlete' : role,
  })
  expect(response.statusCode, response.body).toBe(201)
  const result = response.json()
  if (role === 'admin')
    await pool.query("UPDATE users SET role='admin' WHERE id=$1", [result.user.id])
  await pool.query(
    'UPDATE profiles SET sports=$1,goals=$2,levels=$3,availability=$4,mode=$5,budget=250,price=150 WHERE user_id=$6',
    [profile.sports, profile.goals, profile.levels, profile.availability, profile.mode, result.user.id],
  )
  return { id: result.user.id, token: result.token, role, email }
}
async function activeContract(a: Actor, c: Actor) {
  return (await pool.query(
    "INSERT INTO contracts(athlete_id,coach_id,status,decided_at) VALUES($1,$2,'active',now()-interval '10 days') RETURNING id",
    [a.id, c.id],
  )).rows[0].id as string
}
function denied(response: { statusCode: number; body: string }, status: number | number[]) {
  expect(Array.isArray(status) ? status : [status], response.body).toContain(response.statusCode)
}

describe.sequential('Matriz de papeis e isolamento entre contas', () => {
  beforeAll(async () => {
    process.env.BILLING_MODE = 'academic'
    await migrate(pool)
    await pool.query('TRUNCATE users CASCADE')
    app = await buildApp({ pool, origin })
    await app.ready()
    athlete = await signup('athlete', 'Atleta Auditoria A')
    otherAthlete = await signup('athlete', 'Atleta Auditoria B')
    coach = await signup('coach', 'Treinador Auditoria A')
    otherCoach = await signup('coach', 'Treinador Auditoria B')
    admin = await signup('admin', 'Administrador Auditoria')
    await pool.query("UPDATE profiles SET verification_status='approved' WHERE user_id=ANY($1::uuid[])", [[coach.id, otherCoach.id]])
    contractId = await activeContract(athlete, coach)
    pendingId = (await pool.query(
      "INSERT INTO contracts(athlete_id,coach_id,status) VALUES($1,$2,'pending') RETURNING id",
      [otherAthlete.id, coach.id],
    )).rows[0].id
    for (const status of ['published', 'draft']) {
      const result = await request(coach, 'POST', '/workouts', workoutInput(contractId, status))
      expect(result.statusCode, result.body).toBe(201)
      if (status === 'published') workoutId = result.json().workout.id
      else draftId = result.json().workout.id
    }
    const review = await request(athlete, 'POST', '/reviews', { contractId, rating: 5, text: 'Avaliacao ficticia de auditoria' })
    expect(review.statusCode, review.body).toBe(201)
    reviewId = review.json().review.id
    const consultation = await request(coach, 'POST', '/consultations', {
      contractId, title: 'Consultoria ficticia', description: 'Dados privados da fixture', startsAt: future(), durationMinutes: 30,
    })
    expect(consultation.statusCode, consultation.body).toBe(201)
    consultationId = consultation.json().consultation.id
    notificationId = (await pool.query(
      "INSERT INTO notifications(user_id,kind,title) VALUES($1,'test','Notificacao privada da fixture') RETURNING id", [athlete.id],
    )).rows[0].id
  })
  afterAll(async () => {
    if (process.env.PERMISSIONS_EVIDENCE_FILE && app) {
      const file = path.resolve(process.env.PERMISSIONS_EVIDENCE_FILE)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, JSON.stringify({
        executedAt: new Date().toISOString(),
        environment: 'isolated PostgreSQL _test and local S3',
        actors: ['visitor', 'athlete A', 'athlete B', 'coach A', 'coach B', 'admin'],
        protectedOperations: operations.map(({ method, path, roles }) => ({ method, path, allowedRoles: roles ?? ['athlete', 'coach', 'admin'], ownershipMayApply: !roles })),
        recordedRequestCount: recordedRequests.length,
        requests: recordedRequests,
      }, null, 2) + '\n')
    }
    for (const actor of [athlete, otherAthlete, coach, otherCoach, admin])
      if (actor) await deleteMediaObjects(pool, actor.id)
    await app?.close()
    await pool.end()
    if (previousMode === undefined) delete process.env.BILLING_MODE
    else process.env.BILLING_MODE = previousMode
  })
  it.each(operations)('$method $path exige autenticacao e respeita os papeis', async (operation) => {
    const path = operation.path.replaceAll('{id}', missing).replace('{part}', '0')
    denied(await request(null, operation.method, path, operation.payload), 401)
    if (!operation.roles) return
    for (const actor of [athlete, otherAthlete, coach, otherCoach, admin]) {
      if (operation.roles.includes(actor.role)) continue
      denied(await request(actor, operation.method, path, operation.payload), 403)
    }
  })
  it('inventaria todas as operacoes REST documentadas sem deixar rotas novas fora da matriz', () => {
    const publicOperations = [
      'GET /api/health', 'GET /api/auth/session', 'POST /api/auth/logout',
      'POST /api/auth/register', 'POST /api/auth/login',
      'POST /api/auth/native/register', 'POST /api/auth/native/login',
      'POST /api/auth/forgot-password', 'POST /api/auth/reset-password',
      'POST /api/auth/native/forgot-password', 'POST /api/auth/native/reset-password',
      'GET /api/privacy/policy', 'POST /api/billing/webhook',
    ]
    const covered = new Set([...publicOperations, ...operations.map((o) => `${o.method} /api${o.path}`)])
    const paths = app.swagger().paths ?? {}
    const actual = Object.entries(paths).flatMap(([path, methods]) =>
      Object.keys(methods ?? {}).filter((method) => ['get', 'post', 'put', 'patch', 'delete'].includes(method))
        .map((method) => `${method.toUpperCase()} ${path}`),
    )
    expect(actual.filter((operation) => !covered.has(operation))).toEqual([])
    expect(actual.length).toBeGreaterThan(70)
  })
  it('todos os papeis autenticados consultam apenas suas listas e dados proprios', async () => {
    for (const actor of [athlete, otherAthlete, coach, otherCoach, admin]) {
      for (const path of ['/profiles/me', '/contracts', '/workouts', '/dashboard', '/metrics', '/privacy/consents', '/privacy/export', '/notifications', '/reviews', '/consultations', '/billing/config', '/billing/plans', '/billing/summary']) {
        const response = await request(actor, 'GET', path)
        expect(response.statusCode, `${actor.role} ${path}: ${response.body}`).toBe(200)
        if (actor === otherAthlete || actor === otherCoach || actor === admin) {
          if (['/contracts', '/workouts', '/dashboard', '/privacy/export', '/consultations', '/billing/summary'].includes(path)) {
            expect(response.body).not.toContain(workoutId)
            expect(response.body).not.toContain(consultationId)
          }
        }
      }
    }
  })
  it('titulares dos dois papeis atualizam o proprio perfil sem promover privilegios', async () => {
    for (const actor of [athlete, otherAthlete, coach, otherCoach]) {
      const response = await request(actor, 'PUT', '/profiles/me', { ...profile, name: actor.email })
      expect(response.statusCode, response.body).toBe(200)
      expect(response.json().profile.userId).toBe(actor.id)
      denied(await request(actor, 'PUT', '/profiles/me', { ...profile, role: 'admin', userId: admin.id }), 400)
      expect((await request(actor, 'GET', '/auth/session')).json().user.role).toBe(actor.role)
    }
  })
  it('admin nao recebe acesso implicito a treinos, mensagens ou agenda privados', async () => {
    const cases: Array<[InjectOptions['method'], string, unknown?]> = [
      ['GET', '/workouts/' + workoutId],
      ['GET', `/contracts/${contractId}/messages`],
      ['POST', `/contracts/${contractId}/messages`, { text: 'Tentativa indevida' }],
      ['PUT', `/contracts/${contractId}/messages/read`, {}],
      ['POST', '/consultations', { contractId, title: 'Acesso indevido', startsAt: future(), durationMinutes: 30 }],
      ['PATCH', '/consultations/' + consultationId, { status: 'cancelled', reason: 'Tentativa indevida' }],
      ['GET', `/consultations/${consultationId}/history`],
      ['POST', `/consultations/${consultationId}/google-event`, { eventId: 'fixture_event', meetingUrl: 'https://meet.google.com/abc-defg-hij' }],
    ]
    for (const actor of [otherAthlete, otherCoach, admin])
      for (const [method, path, payload] of cases)
        denied(await request(actor, method, path, payload), 404)
  })
  it('somente o treinador do pedido aceita ou recusa o vinculo', async () => {
    denied(await request(otherCoach, 'PATCH', '/contracts/' + pendingId, { status: 'active' }), 404)
    const accepted = await request(coach, 'PATCH', '/contracts/' + pendingId, { status: 'active' })
    expect(accepted.statusCode, accepted.body).toBe(200)
    denied(await request(coach, 'PATCH', '/contracts/' + pendingId, { status: 'rejected' }), 409)
  })
  it('rascunho fica exclusivo do treinador e execucao exclusiva do atleta correto', async () => {
    expect((await request(coach, 'GET', '/workouts/' + draftId)).statusCode).toBe(200)
    for (const actor of [athlete, otherAthlete, otherCoach, admin])
      denied(await request(actor, 'GET', '/workouts/' + draftId), 404)
    denied(await request(otherCoach, 'PUT', '/workouts/' + workoutId, workoutInput(contractId)), 404)
    denied(await request(otherAthlete, 'PUT', `/workouts/${workoutId}/execution`, { completedBlocks: [0], effort: 5, notes: '', metrics: {} }), 404)
    await request(athlete, 'PUT', '/privacy/consents', { purpose: 'performance', granted: true })
    const result = await request(athlete, 'PUT', `/workouts/${workoutId}/execution`, { completedBlocks: [0], effort: 5, notes: 'Execucao privada', metrics: { distanceKm: 1 } })
    expect(result.statusCode, result.body).toBe(200)
    expect((await request(coach, 'GET', '/workouts/' + workoutId)).json().workout.execution.notes).toBe('Execucao privada')
  })
  it('atleta e treinador enviam mensagens mas terceiros nao marcam notificacoes alheias', async () => {
    for (const actor of [athlete, coach]) {
      const response = await request(actor, 'POST', `/contracts/${contractId}/messages`, { text: 'Mensagem da conta ' + actor.role })
      expect(response.statusCode, response.body).toBe(201)
      expect(response.json().message.senderId).toBe(actor.id)
    }
    for (const actor of [otherAthlete, otherCoach, admin]) {
      expect((await request(actor, 'PUT', '/notifications', { ids: [notificationId] })).statusCode).toBe(200)
      expect((await pool.query('SELECT read_at FROM notifications WHERE id=$1', [notificationId])).rows[0].read_at).toBeNull()
    }
    expect((await request(athlete, 'PUT', '/notifications', { ids: [notificationId] })).statusCode).toBe(200)
    expect((await pool.query('SELECT read_at FROM notifications WHERE id=$1', [notificationId])).rows[0].read_at).not.toBeNull()
  })
  it('saude e consentimentos sao proprios inclusive para treinador e administrador', async () => {
    for (const actor of [athlete, coach, admin]) {
      denied(await request(actor, 'PUT', '/privacy/health', { notes: 'Saude sem consentimento' }), 403)
      expect((await request(actor, 'PUT', '/privacy/consents', { purpose: 'health', granted: true })).statusCode).toBe(200)
      const marker = 'Saude ficticia exclusiva ' + actor.id
      expect((await request(actor, 'PUT', '/privacy/health', { notes: marker, heightCm: 180 })).statusCode).toBe(200)
      expect((await request(actor, 'GET', '/privacy/export')).body).toContain(marker)
      for (const other of [otherAthlete, otherCoach])
        expect((await request(other, 'GET', '/privacy/export')).body).not.toContain(marker)
      expect((await request(actor, 'PUT', '/privacy/consents', { purpose: 'health', granted: false })).statusCode).toBe(200)
      expect((await pool.query('SELECT 1 FROM private_health WHERE user_id=$1', [actor.id])).rowCount).toBe(0)
    }
  })
  it('somente autor edita avaliacao, treinador correto responde e admin modera', async () => {
    denied(await request(otherAthlete, 'PUT', '/reviews/' + reviewId, { rating: 1, text: 'Edicao indevida' }), 404)
    denied(await request(otherCoach, 'POST', `/reviews/${reviewId}/reply`, { text: 'Resposta indevida' }), 404)
    expect((await request(athlete, 'PUT', '/reviews/' + reviewId, { rating: 4, text: 'Edicao do autor da fixture' })).statusCode).toBe(200)
    expect((await request(coach, 'POST', `/reviews/${reviewId}/reply`, { text: 'Resposta do treinador correto' })).statusCode).toBe(200)
    expect((await request(otherAthlete, 'POST', `/reviews/${reviewId}/report`, { reason: 'Denuncia ficticia de teste' })).statusCode).toBe(200)
    expect((await request(admin, 'PATCH', '/admin/reviews/' + reviewId, { hidden: true, reason: 'Ocultacao ficticia' })).statusCode).toBe(200)
    for (const actor of [athlete, coach, otherAthlete, otherCoach, admin])
      expect((await request(actor, 'GET', '/reviews')).body).not.toContain(reviewId)
    expect((await request(admin, 'PATCH', '/admin/reviews/' + reviewId, { hidden: false, reason: 'Restauracao ficticia' })).statusCode).toBe(200)
  })
  it('ambos participantes gerenciam consultoria sem duplicar evento externo', async () => {
    const moved = new Date(Date.now() + 86400000 * 4).toISOString()
    expect((await request(athlete, 'PATCH', '/consultations/' + consultationId, { startsAt: moved, reason: 'Reagendamento pelo atleta' })).statusCode).toBe(200)
    for (const actor of [athlete, coach])
      expect((await request(actor, 'GET', `/consultations/${consultationId}/history`)).statusCode).toBe(200)
    expect((await request(coach, 'POST', `/consultations/${consultationId}/google-event`, { eventId: 'fixture_manual', meetingUrl: 'https://meet.google.com/abc-defg-hij' })).statusCode).toBe(200)
    denied(await request(athlete, 'POST', `/consultations/${consultationId}/google-event`, { eventId: 'fixture_outro', meetingUrl: 'https://meet.google.com/abc-defg-hij' }), 409)
    denied(await request(coach, 'PATCH', '/consultations/' + consultationId, { status: 'completed', reason: 'Conclusao antes do horario' }), 400)
    expect((await request(athlete, 'PATCH', '/consultations/' + consultationId, { status: 'cancelled', reason: 'Cancelamento pelo atleta' })).statusCode).toBe(200)
  })
  it('planos e carteiras pertencem ao treinador e configuracao financeira ao admin', async () => {
    for (const actor of [coach, otherCoach]) {
      const walletId = randomUUID()
      expect((await request(actor, 'PUT', '/billing/wallet', { walletId })).statusCode).toBe(200)
      expect((await request(actor, 'PUT', '/billing/plan', { name: 'Plano ' + actor.id, amountCents: 15000, active: true })).statusCode).toBe(200)
      expect((await request(actor, 'GET', '/billing/wallet')).json().wallet.walletId).toBe(walletId)
      expect((await request(actor, 'GET', '/billing/plan')).json().plan.coachId).toBe(actor.id)
    }
    expect((await request(admin, 'PATCH', '/admin/billing/settings', { commissionBps: 1000, graceDays: 3 })).statusCode).toBe(200)
    expect((await request(admin, 'GET', '/admin/billing/jobs')).statusCode).toBe(200)
    expect((await request(admin, 'POST', '/admin/billing/reconcile')).statusCode).toBe(200)
    const response = await request(athlete, 'POST', '/billing/checkout', { contractId })
    expect(response.statusCode).toBe(503)
    expect(response.json().code).toBe('BILLING_DISABLED')
  })
  it('arquivos de performance e orientacao respeitam papeis, vinculo e titularidade', async () => {
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
    const body = { purpose: 'performance', resourceId: workoutId, name: 'fixture.png', mimeType: 'image/png', size: bytes.length }
    denied(await request(coach, 'POST', '/media/uploads', body), 403)
    denied(await request(athlete, 'POST', '/media/uploads', { ...body, purpose: 'instruction' }), 403)
    for (const actor of [otherAthlete, otherCoach, admin])
      denied(await request(actor, 'POST', '/media/uploads', body), 404)
    for (const [owner, purpose] of [[athlete, 'performance'], [coach, 'instruction']] as const) {
      const started = await request(owner, 'POST', '/media/uploads', { ...body, purpose })
      expect(started.statusCode, started.body).toBe(201)
      const uploadId = started.json().upload.id
      for (const actor of [athlete, coach, otherAthlete, otherCoach, admin]) {
        if (actor === owner) continue
        denied(await request(actor, 'PUT', `/media/uploads/${uploadId}/parts/0`, bytes), 404)
        denied(await request(actor, 'POST', `/media/uploads/${uploadId}/complete`, {}), 404)
        denied(await request(actor, 'DELETE', `/media/uploads/${uploadId}`), 404)
      }
      expect((await request(owner, 'PUT', `/media/uploads/${uploadId}/parts/0`, bytes)).statusCode).toBe(200)
      const completed = await request(owner, 'POST', `/media/uploads/${uploadId}/complete`, {})
      expect(completed.statusCode, completed.body).toBe(201)
      const mediaId = completed.json().media.id
      for (const actor of [athlete, coach]) {
        const content = await request(actor, 'GET', `/media/${mediaId}/content`)
        expect(content.statusCode, content.body).toBe(200)
        expect(content.rawPayload).toEqual(bytes)
      }
      for (const actor of [otherAthlete, otherCoach, admin]) {
        denied(await request(actor, 'GET', `/media/${mediaId}/content`), 404)
        denied(await request(actor, 'GET', '/media?resourceId=' + workoutId), 404)
      }
      denied(await request(owner === athlete ? coach : athlete, 'DELETE', '/media/' + mediaId), 403)
      if (purpose === 'performance') {
        denied(await request(otherCoach, 'POST', `/media/${mediaId}/feedback`, { text: 'Correcao indevida' }), 404)
        expect((await request(coach, 'POST', `/media/${mediaId}/feedback`, { text: 'Correcao ficticia autorizada' })).statusCode).toBe(201)
      }
      expect((await request(owner, 'DELETE', '/media/' + mediaId)).statusCode).toBe(200)
      denied(await request(owner, 'GET', `/media/${mediaId}/content`), 404)
    }
  })
  it('comprovacao profissional e privada entre treinador titular e administrador', async () => {
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
    const body = { purpose: 'verification', resourceId: coach.id, name: 'documento-ficticio.png', mimeType: 'image/png', size: bytes.length }
    for (const actor of [athlete, otherAthlete, otherCoach, admin])
      denied(await request(actor, 'POST', '/media/uploads', body), 404)
    const started = await request(coach, 'POST', '/media/uploads', body)
    expect(started.statusCode, started.body).toBe(201)
    const uploadId = started.json().upload.id
    expect((await request(coach, 'PUT', `/media/uploads/${uploadId}/parts/0`, bytes)).statusCode).toBe(200)
    const completed = await request(coach, 'POST', `/media/uploads/${uploadId}/complete`, {})
    expect(completed.statusCode, completed.body).toBe(201)
    const mediaId = completed.json().media.id
    for (const actor of [coach, admin])
      expect((await request(actor, 'GET', `/media/${mediaId}/content`)).statusCode).toBe(200)
    for (const actor of [athlete, otherAthlete, otherCoach])
      denied(await request(actor, 'GET', `/media/${mediaId}/content`), 404)
    denied(await request(admin, 'DELETE', '/media/' + mediaId), 403)
    expect((await request(coach, 'DELETE', '/media/' + mediaId)).statusCode).toBe(200)
  })
  it.each(['expired', 'disabled'] as const)('nao publica planos nem aceita solicitacao para treinador %s', async (state) => {
    try {
      if (state === 'expired')
        await pool.query("UPDATE profiles SET verification_expires_at=now()-interval '1 second' WHERE user_id=$1", [otherCoach.id])
      else
        await pool.query('UPDATE users SET disabled_at=now() WHERE id=$1', [otherCoach.id])
      const plans = await request(athlete, 'GET', '/billing/plans?coachId=' + otherCoach.id)
      expect(plans.statusCode).toBe(200)
      expect(plans.json().plans).toEqual([])
      denied(await request(otherAthlete, 'POST', '/contracts', { coachId: otherCoach.id }), 400)
    } finally {
      await pool.query('UPDATE profiles SET verification_expires_at=NULL WHERE user_id=$1', [otherCoach.id])
      await pool.query('UPDATE users SET disabled_at=NULL WHERE id=$1', [otherCoach.id])
    }
  })
  it('upload multipart atende atleta e treinador e apenas o dono aborta envio parcial', async () => {
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
    for (const [owner, purpose] of [[athlete, 'performance'], [coach, 'instruction']] as const) {
      const boundary = 'audit-' + randomUUID()
      const payload = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="fixture.png"\r\nContent-Type: image/png\r\n\r\n`),
        bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
      ])
      const result = await request(owner, 'POST', `/media?purpose=${purpose}&resourceId=${workoutId}`, payload, { 'content-type': 'multipart/form-data; boundary=' + boundary })
      expect(result.statusCode, result.body).toBe(201)
      expect((await request(owner, 'DELETE', '/media/' + result.json().media.id)).statusCode).toBe(200)
      const started = await request(owner, 'POST', '/media/uploads', { purpose, resourceId: workoutId, name: 'fixture.png', mimeType: 'image/png', size: bytes.length })
      expect(started.statusCode, started.body).toBe(201)
      const uploadId = started.json().upload.id
      expect((await request(owner, 'PUT', `/media/uploads/${uploadId}/parts/0`, bytes)).statusCode).toBe(200)
      expect((await request(owner, 'DELETE', '/media/uploads/' + uploadId)).statusCode).toBe(200)
      denied(await request(owner, 'POST', `/media/uploads/${uploadId}/complete`, {}), 404)
    }
  })
  it.each(['expired', 'disabled'] as const)('recusa solicitacao direta para treinador %s', async (state) => {
    try {
      if (state === 'expired')
        await pool.query("UPDATE profiles SET verification_expires_at=now()-interval '1 second' WHERE user_id=$1", [otherCoach.id])
      else
        await pool.query('UPDATE users SET disabled_at=now() WHERE id=$1', [otherCoach.id])
      denied(await request(otherAthlete, 'POST', '/contracts', { coachId: otherCoach.id }), 400)
    } finally {
      await pool.query('DELETE FROM contracts WHERE coach_id=$1', [otherCoach.id])
      await pool.query('UPDATE profiles SET verification_expires_at=NULL WHERE user_id=$1', [otherCoach.id])
      await pool.query('UPDATE users SET disabled_at=NULL WHERE id=$1', [otherCoach.id])
    }
  })
  it('treinador com aprovacao vencida nao aceita um pedido antigo', async () => {
    const id = (await pool.query(
      "INSERT INTO contracts(athlete_id,coach_id,status) VALUES($1,$2,'pending') RETURNING id", [athlete.id, otherCoach.id],
    )).rows[0].id
    try {
      await pool.query("UPDATE profiles SET verification_expires_at=now()-interval '1 second' WHERE user_id=$1", [otherCoach.id])
      denied(await request(otherCoach, 'PATCH', '/contracts/' + id, { status: 'active' }), 403)
    } finally {
      await pool.query('DELETE FROM contracts WHERE id=$1', [id])
      await pool.query('UPDATE profiles SET verification_expires_at=NULL WHERE user_id=$1', [otherCoach.id])
    }
  })
  it('vinculo encerrado bloqueia escritas novas para atleta e treinador', async () => {
    expect((await request(athlete, 'POST', `/contracts/${contractId}/cancel`, { reason: 'Encerramento ficticio' })).statusCode).toBe(200)
    for (const actor of [athlete, coach]) {
      denied(await request(actor, 'POST', `/contracts/${contractId}/messages`, { text: 'Nova mensagem indevida' }), 403)
      denied(await request(actor, 'POST', '/consultations', { contractId, title: 'Nova consultoria', startsAt: future(), durationMinutes: 30 }), 403)
      expect((await request(actor, 'GET', `/contracts/${contractId}/messages`)).statusCode).toBe(200)
    }
    denied(await request(coach, 'POST', '/workouts', workoutInput(contractId)), 403)
  })
  it.each(['athlete', 'coach', 'admin'] as const)('sessao de %s expira, logout revoga e encerramento bloqueia toda a API privada', async (role) => {
    const actor = await signup(role, 'Conta temporaria ' + role)
    const session = await request(actor, 'GET', '/auth/session')
    expect(session.json().user.id).toBe(actor.id)
    expect(session.json().user.role).toBe(role)
    await pool.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1", [actor.id])
    denied(await request(actor, 'GET', '/privacy/export'), 401)
    const login = await request(null, 'POST', '/auth/native/login', { email: actor.email, password })
    expect(login.statusCode, login.body).toBe(200)
    actor.token = login.json().token
    expect((await request(actor, 'POST', '/auth/logout')).statusCode).toBe(200)
    denied(await request(actor, 'GET', '/privacy/export'), 401)
    const again = await request(null, 'POST', '/auth/native/login', { email: actor.email, password })
    actor.token = again.json().token
    denied(await request(actor, 'POST', '/privacy/delete', { password: 'SenhaIncorreta123!' }), 401)
    expect((await request(actor, 'POST', '/privacy/delete', { password })).statusCode).toBe(200)
    for (const operation of operations) {
      const path = operation.path.replaceAll('{id}', missing).replace('{part}', '0')
      denied(await request(actor, operation.method, path, operation.payload), 401)
    }
    denied(await request(null, 'POST', '/auth/native/login', { email: actor.email, password }), 401)
  })
  it.each(SPORTS)('jornada completa de atleta e treinador na modalidade %s', async (sport) => {
    const a = await signup('athlete', 'Atleta da modalidade')
    const c = await signup('coach', 'Treinador da modalidade')
    for (const actor of [a, c])
      expect((await request(actor, 'PUT', '/profiles/me', { ...profile, sports: [sport] })).statusCode).toBe(200)
    const submission = await request(c, 'POST', '/verifications', { cref: '000123-G/SP', evidence: 'Comprovacao inteiramente ficticia de teste' })
    expect(submission.statusCode, submission.body).toBe(201)
    const id = submission.json().verification.id
    denied(await request(athlete, 'PATCH', '/admin/verifications/' + id, { status: 'approved', reason: 'Tentativa indevida' }), 403)
    expect((await request(admin, 'PATCH', '/admin/verifications/' + id, { status: 'approved', reason: 'Aprovacao ficticia da fixture' })).statusCode).toBe(200)
    const matches = await request(a, 'GET', '/coaches?sport=' + encodeURIComponent(sport))
    expect(matches.json().coaches.some((item: { userId: string }) => item.userId === c.id)).toBe(true)
    const connection = await request(a, 'POST', '/contracts', { coachId: c.id })
    expect(connection.statusCode, connection.body).toBe(201)
    const contract = connection.json().contract.id
    expect((await request(c, 'PATCH', '/contracts/' + contract, { status: 'active' })).statusCode).toBe(200)
    const workout = await request(c, 'POST', '/workouts', { ...workoutInput(contract), sport })
    expect(workout.statusCode, workout.body).toBe(201)
    const idWorkout = workout.json().workout.id
    const catalog = await request(a, 'GET', '/metrics?sport=' + encodeURIComponent(sport))
    expect(catalog.statusCode, catalog.body).toBe(200)
    const metrics = Object.fromEntries(catalog.json().metrics.map((metric: { key: string; min: number }) => [metric.key, Math.max(metric.min, 1)]))
    expect(Object.keys(metrics).length).toBeGreaterThan(0)
    expect((await request(a, 'PUT', '/privacy/consents', { purpose: 'performance', granted: true })).statusCode).toBe(200)
    const execution = await request(a, 'PUT', `/workouts/${idWorkout}/execution`, { completedBlocks: [0], effort: 5, notes: 'Dados ficticios da modalidade', metrics })
    expect(execution.statusCode, execution.body).toBe(200)
    expect((await request(c, 'GET', '/workouts/' + idWorkout)).json().workout.execution.metrics).toEqual(metrics)
    for (const outsider of [otherAthlete, otherCoach, admin])
      denied(await request(outsider, 'GET', '/workouts/' + idWorkout), 404)
  })
})
