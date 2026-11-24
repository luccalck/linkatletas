import type { FastifyInstance } from 'fastify'

const string = { type: 'string' } as const
const uuid = { type: 'string', format: 'uuid' } as const
const stringArray = { type: 'array', items: string } as const
const object = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: 'object', properties, required, additionalProperties: true })
const array = (items: unknown) => ({ type: 'array', items })
const nullable = (schema: Record<string, unknown>) => ({
  anyOf: [schema, { type: 'null' }],
})
const number = { type: 'number' } as const
const user = object({
  id: uuid,
  name: string,
  email: { type: 'string', format: 'email' },
  role: { type: 'string', enum: ['athlete', 'coach', 'admin'] },
})
const profile = object({
  userId: uuid,
  role: string,
  name: string,
  email: string,
  city: string,
  bio: string,
  sports: stringArray,
  goals: stringArray,
  levels: stringArray,
  availability: stringArray,
  mode: string,
  budget: number,
  price: number,
  cref: string,
  qualification: string,
  verificationStatus: string,
  verificationReason: string,
})
const coach = object(
  { ...profile.properties, score: number, reasons: stringArray },
  ['userId', 'name', 'sports', 'score', 'reasons'],
)
// Public trainer cards deliberately exclude private e-mail and athlete budget.
delete (coach.properties as Record<string, unknown>).email
delete (coach.properties as Record<string, unknown>).budget
delete (coach.properties as Record<string, unknown>).role
const verification = object({
  id: uuid,
  coachId: uuid,
  coachName: string,
  cref: string,
  qualification: string,
  evidence: string,
  status: string,
  reason: string,
  submittedAt: string,
  reviewedAt: nullable(string),
  reviewerId: nullable(uuid),
})
const contract = object({
  id: uuid,
  athleteId: uuid,
  coachId: uuid,
  athleteName: string,
  coachName: string,
  status: string,
  createdAt: string,
  decidedAt: nullable(string),
})
const block = object(
  {
    name: string,
    instructions: string,
    sets: number,
    repetitions: number,
    loadKg: number,
    durationMinutes: number,
    distanceKm: number,
    videoUrl: string,
  },
  ['name', 'instructions'],
)
const execution = object({
  id: uuid,
  completedBlocks: array({ type: 'integer' }),
  effort: { type: 'integer', minimum: 1, maximum: 10 },
  notes: string,
  metrics: { type: 'object', additionalProperties: number },
  updatedAt: string,
})
const workout = object({
  id: uuid,
  contractId: uuid,
  coachId: uuid,
  athleteId: uuid,
  coachName: string,
  athleteName: string,
  title: string,
  sport: string,
  scheduledDate: { type: 'string', format: 'date' },
  instructions: string,
  status: string,
  blocks: array(block),
  createdAt: string,
  execution: nullable(execution),
})
const metric = object({
  sport: string,
  key: string,
  label: string,
  unit: string,
  min: number,
  max: number,
})
const error = object(
  {
    code: string,
    message: string,
    fields: { type: 'object', additionalProperties: stringArray },
  },
  ['code', 'message'],
)

export function installResponseDocs(app: FastifyInstance) {
  app.addHook('onRoute', (route) => {
    const url = route.url
    if (
      !url.startsWith('/api/') ||
      url.startsWith('/api/docs') ||
      url === '/api/openapi.json'
    )
      return
    // New modules declare their own schemas; do not serialize them as an old prefix response.
    if (route.schema?.response) return
    const legacy =
      /^\/api\/(auth\/(register|login|logout|session)|profiles\/me|coaches|verifications|admin\/verifications(?:\/[^/]+)?|contracts(?:\/[^/]+)?|workouts(?:\/[^/]+(?:\/execution)?)?|metrics|dashboard|health)$/
    if (!legacy.test(url)) {
      route.schema = {
        ...route.schema,
        response: {
          '2xx': { type: 'object', additionalProperties: true },
          400: error,
          401: error,
          403: error,
          404: error,
          409: error,
          429: error,
          500: error,
        },
      }
      if (/^\/api\/auth\/native\/(login|register)$/.test(url))
        route.schema.security = []
      return
    }
    const method = Array.isArray(route.method) ? route.method[0] : route.method
    let result: Record<string, unknown> = object({ ok: { type: 'boolean' } })
    if (url.endsWith('/auth/session')) result = object({ user: nullable(user) })
    else if (url.includes('/auth/') && !url.endsWith('/logout'))
      result = object({ user })
    else if (url.endsWith('/profiles/me')) result = object({ profile })
    else if (url.endsWith('/coaches'))
      result = object({ coaches: array(coach) })
    else if (url.includes('/verifications'))
      result =
        method === 'GET'
          ? object({ verifications: array(verification) })
          : object({ verification })
    else if (url.includes('/contracts'))
      result =
        method === 'GET'
          ? object({ contracts: array(contract) })
          : object({ contract })
    else if (url.includes('/workouts'))
      result =
        url.endsWith('/workouts') && method === 'GET'
          ? object({ workouts: array(workout) })
          : object({ workout })
    else if (url.endsWith('/metrics'))
      result = object({ metrics: array(metric) })
    else if (url.endsWith('/dashboard'))
      result = object({ contracts: array(contract), workouts: array(workout) })
    else if (url.endsWith('/health'))
      result = object({ ok: { type: 'boolean' }, database: string })
    const created =
      method === 'POST' &&
      ['/auth/register', '/verifications', '/contracts', '/workouts'].some(
        (s) => url.endsWith(s),
      )
    route.schema = {
      ...route.schema,
      response: {
        [created ? 201 : 200]: {
          ...result,
          description: created ? 'Recurso criado.' : 'Operação concluída.',
        },
        400: error,
        401: error,
        403: error,
        404: error,
        409: error,
        429: error,
        500: error,
      },
    }
    if (
      ['/auth/register', '/auth/login', '/auth/session', '/health'].some((s) =>
        url.endsWith(s),
      )
    )
      route.schema.security = []
  })
}
