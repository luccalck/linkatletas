import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import pg from 'pg'

const objects = vi.hoisted(() => new Map<string, string>())
vi.mock('@aws-sdk/client-s3', async (original) => {
  const sdk = await original<typeof import('@aws-sdk/client-s3')>()
  return {
    ...sdk,
    S3Client: class {
      async send(command: any) {
        const key = command.input.Key
        if (command instanceof sdk.PutObjectCommand) { objects.set(key, String(command.input.Body)); return {} }
        if (command instanceof sdk.GetObjectCommand) return { Body: { transformToString: async () => objects.get(key) } }
        if (command instanceof sdk.DeleteObjectCommand) { objects.delete(key); return {} }
        return {}
      }
      destroy() {}
    },
  }
})

import { createPool } from '../../server/db/pool.js'
import { migrate } from '../../server/db/migrate.js'
import { buildApp } from '../../server/app.js'
import { tokenHash } from '../../server/shared/security.js'
import { GOALS, LEVELS, SLOTS, SPORTS } from '../../shared/contracts.js'
import { configureRuntimePrivileges } from '../../server/db/runtime-privileges.js'

const url = process.env.TEST_DATABASE_URL ?? 'postgresql://linkatletas:linkatletas_dev@127.0.0.1:54329/linkatletas_test'
if (!decodeURIComponent(new URL(url).pathname).endsWith('_test')) throw new Error('Seguranca exige base isolada _test.')
let db: Pool
let app: FastifyInstance
let runtime: Pool
const runtimeRole = 'security_audit_' + randomBytes(8).toString('hex')
let roleCreated = false
const ids = [randomUUID(), randomUUID(), randomUUID()]
const tokens = ids.map(() => randomBytes(32).toString('hex'))
let contract: string
const origin = 'http://localhost:5173'
const call = (actor: number, method: any, route: string, payload?: any) => app.inject({ method, url: '/api' + route, headers: { origin, authorization: 'Bearer ' + tokens[actor] }, ...(payload === undefined ? {} : { payload }) })

beforeAll(async () => {
  vi.stubEnv('VERCEL_ENV', 'preview')
  db = createPool(url)
  await migrate(db)
  for (const [i, id] of ids.entries()) {
    await db.query('INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)', [id, 'Fixture ' + i, id + '@security.invalid', 'fixture-not-login', i === 1 ? 'coach' : 'athlete'])
    await db.query("INSERT INTO profiles(user_id,sports,goals,levels,availability,price,budget,verification_status) VALUES($1,$2,$3,$4,$5,100,200,$6)", [id, [SPORTS[0]], [GOALS[0]], [LEVELS[0]], [SLOTS[0]], i === 1 ? 'approved' : 'unsubmitted'])
    await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [tokenHash(tokens[i]), id])
  }
  contract = (await db.query("INSERT INTO contracts(athlete_id,coach_id,status) VALUES($1,$2,'active') RETURNING id", [ids[0], ids[1]])).rows[0].id
  const password = randomBytes(32).toString('hex')
  await db.query(`CREATE ROLE ${pg.escapeIdentifier(runtimeRole)} LOGIN PASSWORD ${pg.escapeLiteral(password)}`)
  roleCreated = true
  await db.query(`GRANT ${pg.escapeIdentifier(runtimeRole)} TO CURRENT_USER`)
  await db.query(`GRANT CONNECT ON DATABASE ${pg.escapeIdentifier(decodeURIComponent(new URL(url).pathname.slice(1)))} TO ${pg.escapeIdentifier(runtimeRole)}`)
  await db.query(`GRANT USAGE ON SCHEMA public TO ${pg.escapeIdentifier(runtimeRole)}`)
  const owner = await db.connect()
  try { await configureRuntimePrivileges(owner, runtimeRole) } finally { owner.release() }
  const runtimeUrl = new URL(url)
  runtimeUrl.username = runtimeRole
  runtimeUrl.password = password
  runtime = createPool(runtimeUrl.toString())
  runtime.options.max = 1
  app = await buildApp({ pool: runtime, origin })
})
afterAll(async () => {
  await app?.close()
  await runtime?.end()
  if (db) {
    try {
      await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids])
      if (roleCreated) { await db.query(`DROP OWNED BY ${pg.escapeIdentifier(runtimeRole)}`); await db.query(`DROP ROLE ${pg.escapeIdentifier(runtimeRole)}`) }
    } finally { await db.end() }
  }
  vi.unstubAllEnvs()
})

describe('fronteiras de entrada e autorizacao com PostgreSQL', () => {
  it('mantem filtros e campos publicos na busca otimizada', async () => {
    const response = await call(0, 'GET', '/coaches?sport=' + encodeURIComponent(SPORTS[0]) + '&maxPrice=150')
    expect(response.statusCode).toBe(200)
    expect(response.json().coaches.some((coach: any) => coach.userId === ids[1])).toBe(true)
    expect(response.json().coaches.every((coach: any) => coach.price <= 150 && coach.email === undefined && coach.budget === undefined && coach.password_hash === undefined)).toBe(true)
    expect((await call(0, 'GET', '/coaches?maxPrice=1')).json().coaches).toEqual([])
    expect((await call(0, 'GET', '/coaches?query=' + encodeURIComponent("' OR 1=1 --"))).json().coaches).toEqual([])
    expect((await call(0, 'GET', '/coaches?maxPrice=' + encodeURIComponent('0 OR 1=1'))).statusCode).toBe(400)
  })
  it('conclui upload em partes sem exigir outra conexao enquanto a transacao ocupa o pool', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9uoAAAAASUVORK5CYII=', 'base64')
    const created = await call(1, 'POST', '/media/uploads', { purpose: 'message', resourceId: contract, name: 'fixture.png', mimeType: 'image/png', size: png.length })
    expect(created.statusCode, created.body).toBe(201)
    const id = created.json().upload.id
    const part = await app.inject({ method: 'PUT', url: '/api/media/uploads/' + id + '/parts/0', headers: { authorization: 'Bearer ' + tokens[1], 'content-type': 'application/octet-stream' }, payload: png })
    expect(part.statusCode, part.body).toBe(200)
    const completed = await call(1, 'POST', '/media/uploads/' + id + '/complete')
    expect(completed.statusCode, completed.body).toBe(201)
    const repeat = await call(1, 'POST', '/media/uploads/' + id + '/complete')
    expect(repeat.json().media.id).toBe(completed.json().media.id)
    expect((await call(1, 'DELETE', '/media/' + completed.json().media.id)).statusCode).toBe(200)
  })
  it('recusa byte nulo em texto antes de atingir o PostgreSQL', async () => {
    const payload = { name: 'Nome\u0000invalido', city: '', bio: '', sports: [SPORTS[0]], goals: [], levels: [], availability: [], mode: 'online', budget: 0, price: 0 }
    expect((await call(0, 'PUT', '/profiles/me', payload)).statusCode).toBe(400)
    expect((await db.query('SELECT name FROM users WHERE id=$1', [ids[0]])).rows[0].name).toBe('Fixture 0')
  })
  it('registra denuncia repetida com a role limitada sem permitir editar o historico', async () => {
    const review = (await db.query('INSERT INTO reviews(contract_id,athlete_id,coach_id,rating,body) VALUES($1,$2,$3,4,$4) RETURNING id', [contract, ids[0], ids[1], 'Avaliacao ficticia de seguranca.'])).rows[0].id
    const first = await call(2, 'POST', '/reviews/' + review + '/report', { reason: 'Motivo original da denuncia.' })
    expect(first.statusCode, first.body).toBe(200)
    expect((await call(2, 'POST', '/reviews/' + review + '/report', { reason: 'Segunda tentativa ficticia.' })).statusCode).toBe(200)
    const reports = (await db.query('SELECT reason FROM review_reports WHERE review_id=$1 AND reporter_id=$2', [review, ids[2]])).rows
    expect(reports).toEqual([{ reason: 'Motivo original da denuncia.' }])
  })
  it.each(["' OR true--", '1;DROP TABLE users', '../users', '%00', 'not-a-uuid'])('barra identificador adversarial: %s', async (id) => {
    const r = await call(0, 'GET', '/workouts/' + encodeURIComponent(id))
    expect([400, 404]).toContain(r.statusCode)
    expect(r.body).not.toMatch(/SELECT |postgres|password_hash|stack|token_hash/)
    expect((await db.query('SELECT id FROM users WHERE id=ANY($1::uuid[])', [ids])).rowCount).toBe(3)
  })

  it('mantem payload SQL como texto parametrizado e nao eleva o papel', async () => {
    const profile = { name: "Teste'; DROP TABLE users;--", city: 'Cidade ficticia', bio: '<script>alert(1)</script>', sports: [SPORTS[0]], goals: [GOALS[0]], levels: [LEVELS[0]], availability: [SLOTS[0]], mode: 'online', budget: 200, price: 0 }
    expect((await call(0, 'PUT', '/profiles/me', { ...profile, role: 'admin' })).statusCode).toBe(400)
    expect((await call(0, 'PUT', '/profiles/me', profile)).statusCode).toBe(200)
    const row = (await db.query('SELECT name,role FROM users WHERE id=$1', [ids[0]])).rows[0]
    expect(row).toEqual({ name: profile.name, role: 'athlete' })
  })

  it.each(['javascript:alert(1)', 'https://user:password@example.com', 'https://127.0.0.1/', 'https://example.com/\nlink'])('recusa referencia perigosa antes de persistir agenda: %s', async (meetingUrl) => {
    const r = await call(0, 'POST', '/consultations', { contractId: contract, title: 'Consulta ficticia', description: '', startsAt: new Date(Date.now() + 86400000).toISOString(), durationMinutes: 30, meetingUrl })
    expect(r.statusCode).toBe(400)
    expect((await db.query('SELECT id FROM consultations WHERE contract_id=$1', [contract])).rowCount).toBe(0)
  })

  const upload = (actor: number, bytes: Buffer, filename: string, mime: string) => {
    const boundary = 'security-boundary'
    return app.inject({ method: 'POST', url: '/api/media?purpose=verification&resourceId=' + ids[1], headers: { origin, authorization: 'Bearer ' + tokens[actor], 'content-type': 'multipart/form-data; boundary=' + boundary }, payload: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]) })
  }

  it.each([
    ['attack.svg', 'image/svg+xml', '<svg onload="alert(1)"></svg>'],
    ['attack.html', 'text/html', '<script>alert(1)</script>'],
    ['fake.png', 'image/png', '<script>alert(1)</script>'],
    ['fake.exe', 'image/png', 'not-an-image'],
  ])('barra arquivo ativo ou assinatura divergente: %s', async (name, mime, content) => {
    const before = objects.size
    expect((await upload(1, Buffer.from(content), name, mime)).statusCode).toBe(400)
    expect(objects.size).toBe(before)
  })

  it('protege bytes, headers e titularidade de arquivo aceito', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9uoAAAAASUVORK5CYII=', 'base64')
    const uploaded = await upload(1, png, 'fixture.png', 'image/png')
    expect(uploaded.statusCode, uploaded.body).toBe(201)
    const id = uploaded.json().media.id
    expect([...objects.values()].some((x) => x.includes(png.toString('base64')))).toBe(false)
    expect((await call(2, 'GET', '/media/' + id + '/content')).statusCode).toBe(404)
    expect((await app.inject('/api/media/' + id + '/content')).statusCode).toBe(401)
    const content = await call(1, 'GET', '/media/' + id + '/content')
    expect(content.statusCode).toBe(200)
    expect(content.rawPayload).toEqual(png)
    expect(content.headers['x-content-type-options']).toBe('nosniff')
    expect(content.headers['content-security-policy']).toContain('sandbox')
    expect(content.headers['cache-control']).toBe('no-store')
    expect((await call(1, 'DELETE', '/media/' + id)).statusCode).toBe(200)
    expect((await call(1, 'GET', '/media/' + id + '/content')).statusCode).toBe(404)
  })

  it('preserva autorizacao, CSRF e limite de corpo antes de gravar', async () => {
    expect((await call(0, 'GET', '/admin/verifications')).statusCode).toBe(403)
    const wrongOrigin = await app.inject({ method: 'PUT', url: '/api/profiles/me', headers: { origin: 'https://attacker.invalid', cookie: 'la_session=' + tokens[0] }, payload: {} })
    expect(wrongOrigin.statusCode).toBe(403)
    const oversized = await call(0, 'PUT', '/profiles/me', { bio: 'x'.repeat(270000) })
    expect(oversized.statusCode).toBe(413)
    expect((await call(2, 'GET', '/contracts/' + contract + '/messages')).statusCode).toBe(404)
  })
})
