import Fastify, { type FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { verificationRoutes } from '../../server/modules/accounts/verification.js'
import { installErrors } from '../../server/shared/errors.js'

const coach = { id: '11111111-1111-4111-8111-111111111111', name: 'João da Silva', email: 'coach@example.com', role: 'coach' as const }
const documentId = '22222222-2222-4222-8222-222222222222'
const verificationId = '33333333-3333-4333-8333-333333333333'
const payload = { cref: '123-G/SP', qualification: 'Bacharelado', documentId }
let pending = false, validDocument = true
let savedQualification = ''
const query = vi.fn(async (sql: string, _values?: unknown[]) => {
  if (sql.includes('FROM media')) return { rows: [], rowCount: validDocument ? 1 : 0 }
  if (sql.includes('FROM profiles') && sql.includes('FOR UPDATE')) return { rows: [{ sports: ['Corrida'], levels: ['Iniciante'], goals: ['Performance'], availability: ['Segunda manhã'], verification_status: 'unsubmitted', qualification: savedQualification }], rowCount: 1 }
  if (sql.startsWith('SELECT 1 FROM verifications')) return { rows: [], rowCount: pending ? 1 : 0 }
  if (sql.startsWith('INSERT INTO verifications')) return { rows: [{ id: verificationId }], rowCount: 1 }
  return { rows: [], rowCount: 0 }
})
const pool = { query, connect: async () => ({ query, release: vi.fn() }) } as unknown as Pool
let app: FastifyInstance
beforeAll(async () => {
  app = Fastify({ ajv: { customOptions: { removeAdditional: false } } })
  installErrors(app)
  app.decorateRequest('user', null)
  app.addHook('preHandler', async req => { req.user = coach })
  await verificationRoutes(app, pool)
  await app.ready()
})
beforeEach(() => { vi.clearAllMocks(); pending = false; validDocument = true; savedQualification = '' })
afterAll(async () => { await app.close() })
const submit = (data: object) => app.inject({ method: 'POST', url: '/verifications', payload: data })

it('aceita comprovante sem texto e grava CREF canônico e formação no histórico e perfil', async () => {
  const response = await submit(payload)
  expect(response.statusCode, response.body).toBe(201)
  expect(query).toHaveBeenCalledWith('INSERT INTO verifications(coach_id,cref,evidence,document_id,qualification) VALUES($1,$2,$3,$4,$5) RETURNING id', [coach.id, '000123-G/SP', '', documentId, 'Bacharelado'])
  expect(query).toHaveBeenCalledWith(expect.stringContaining('qualification=COALESCE'), ['000123-G/SP', coach.id, 'Bacharelado'])
})
it('recusa comprovante que não pertence ao profissional', async () => {
  validDocument = false
  const response = await submit(payload)
  expect(response.statusCode).toBe(400)
  expect(response.json().code).toBe('INVALID_DOCUMENT')
  expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO verifications'))).toBe(false)
})
it('impede novo envio enquanto o administrador analisa o anterior', async () => {
  pending = true
  const response = await submit(payload)
  expect(response.statusCode).toBe(409)
  expect(response.json().code).toBe('VERIFICATION_PENDING')
  expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO verifications'))).toBe(false)
})
it('exige comprovante ou evidência suficiente e valida CREF e formação', async () => {
  for (const data of [{ cref: payload.cref }, { ...payload, cref: '123-G' }, { ...payload, qualification: 'Inválida' }]) {
    const response = await submit(data)
    expect(response.statusCode).toBe(400)
    expect(query).not.toHaveBeenCalled()
  }
})
it('preserva compatibilidade com evidência textual e não apaga formação existente', async () => {
  const response = await submit({ cref: payload.cref, evidence: 'Consulta profissional disponível para conferência.' })
  expect(response.statusCode, response.body).toBe(201)
  expect(query).toHaveBeenCalledWith(expect.stringContaining('qualification=COALESCE'), ['000123-G/SP', coach.id, null])
})

it('preserva no historico a formacao salva quando o cliente omite o campo', async () => {
  savedQualification = 'Licenciatura'
  const response = await submit({ cref: payload.cref, evidence: 'Consulta profissional para conferencia.' })
  expect(response.statusCode, response.body).toBe(201)
  expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO verifications'), [coach.id, '000123-G/SP', 'Consulta profissional para conferencia.', null, 'Licenciatura'])
})
