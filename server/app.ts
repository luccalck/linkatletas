import Fastify, { LogController } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import multipart from '@fastify/multipart'
import websocket from '@fastify/websocket'
import type { Pool } from 'pg'
import { appOrigin, production } from './config.js'
import { createPool } from './db/pool.js'
import { fail, installErrors } from './shared/errors.js'
import { tokenHash } from './shared/security.js'
import { authRoutes, COOKIE } from './modules/accounts/auth.js'
import { profilesRoutes } from './modules/accounts/profiles.js'
import { verificationRoutes } from './modules/accounts/verification.js'
import { matchingRoutes } from './modules/training/matching.js'
import { contractsRoutes } from './modules/training/contracts.js'
import { workoutsRoutes } from './modules/training/workouts.js'
import type { AppUser } from '../shared/contracts.js'
import { installResponseDocs } from './shared/openapi.js'
import { platformRoutes } from './modules/privacy/routes.js'
import { mediaRoutes } from './modules/media/routes.js'
import { interactionsRoutes } from './modules/interactions/routes.js'
import { billingRoutes } from './modules/billing/routes.js'
import { drainMailDeliveries } from './services/mail.js'
import { rejectNullBytes } from './shared/input-guard.js'

export async function buildApp(
  options: {
    pool?: Pool
    logger?: boolean
    origin?: string
    secureCookies?: boolean
    serveFrontend?: boolean
    factory?: typeof Fastify
  } = {},
) {
  const pool = options.pool || createPool()
  const origin = options.origin || appOrigin
  const factory = options.factory || Fastify
  const app = factory({
    logger: options.logger
      ? {
          redact: [
            'req.headers.cookie',
            'req.headers.authorization',
            'res.headers.set-cookie',
          ],
        }
      : false,
    bodyLimit: 262144,
    logController: new LogController({ disableRequestLogging: true }),
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  })
  installErrors(app, options.serveFrontend)
  app.addHook('preValidation', async (req) => { rejectNullBytes(req.body, req.query, req.params) })
  installResponseDocs(app)
  await app.register(cookie)
  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 0 },
  })
  await app.register(websocket, {
    options: { maxPayload: 4096, perMessageDeflate: false },
  })
  await app.register(rateLimit, { global: false })
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'LinkAtletas — API ampliada',
        version: '2.0.0',
        description:
          'Browser: sessão HttpOnly e Origin autorizado. Aplicativo nativo: Bearer opaco. Cobrança depende da configuração do provedor.',
      },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          cookieAuth: { type: 'apiKey', in: 'cookie', name: COOKIE },
          bearerAuth: { type: 'http', scheme: 'bearer' },
          webhookToken: {
            type: 'apiKey',
            in: 'header',
            name: 'asaas-access-token',
          },
        },
      },
      security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    },
  })
  await app.register(swaggerUi, {
    routePrefix: '/api/docs',
    uiConfig: { persistAuthorization: false },
  })
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'same-origin')
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store')
    const bearer = req.headers.authorization?.match(
      /^Bearer ([a-f0-9]{64})$/,
    )?.[1]
    const token = bearer || req.cookies[COOKIE]
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      const { rows } = await pool.query<AppUser>(
        `SELECT u.id,u.name,u.email,u.role FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.disabled_at IS NULL`,
        [tokenHash(token)],
      )
      req.user = rows[0] || null
    }
    const path = req.url.split('?')[0]
    const incoming = req.headers.origin
    const sameServer = `${req.protocol}://${req.headers.host}`
    const publicNative = [
      '/api/auth/native/register',
      '/api/auth/native/login',
      '/api/auth/native/forgot-password',
      '/api/auth/native/reset-password',
    ].includes(path)
    const nativeAuthenticated = !!bearer && !!req.user && !req.cookies[COOKIE]
    const webhook = path === '/api/billing/webhook'
    if (
      req.headers.upgrade === 'websocket' &&
      !nativeAuthenticated &&
      incoming !== origin &&
      incoming !== sameServer
    )
      fail(403, 'INVALID_ORIGIN', 'Origem da conexão não autorizada.')
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      !webhook &&
      !nativeAuthenticated &&
      !(publicNative && !incoming)
    ) {
      if (!incoming || (incoming !== origin && incoming !== sameServer))
        fail(403, 'INVALID_ORIGIN', 'Origem da requisição não autorizada.')
    }
  })
  await app.register(
    async (api) => {
      api.get(
        '/health',
        {
          schema: {
            tags: ['Operação'],
            summary: 'Verificar conexão com banco',
          },
        },
        async () => {
          await pool.query('SELECT 1')
          return { ok: true, database: 'postgresql' }
        },
      )
      await authRoutes(api, pool, options.secureCookies ?? production)
      await profilesRoutes(api, pool)
      await verificationRoutes(api, pool)
      await matchingRoutes(api, pool)
      await contractsRoutes(api, pool)
      await workoutsRoutes(api, pool)
      await platformRoutes(api, pool)
      await mediaRoutes(api, pool)
      await interactionsRoutes(api, pool)
      await billingRoutes(api, pool)
    },
    { prefix: '/api' },
  )
  app.get('/api/openapi.json', { schema: { hide: true } }, async () => {
    const document = app.swagger()
    // Fastify records prefixed paths. Keep server root so generated clients do not duplicate /api.
    return document
  })
  if (!options.pool) app.addHook('onClose', async () => {
    await drainMailDeliveries(pool)
    await pool.end()
  })
  return app
}
