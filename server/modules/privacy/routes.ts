import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { z } from 'zod'
import { transaction } from '../../db/pool.js'
import { fail } from '../../shared/errors.js'
import {
  requireUser,
  newToken,
  tokenHash,
  hashPassword,
  verifyPassword,
} from '../../shared/security.js'
import { encryptPrivate, decryptPrivate } from '../../shared/crypto.js'
import {
  drainMailDeliveries,
  queueMail,
  scheduleMailDelivery,
} from '../../services/mail.js'
import { bodySchema } from '../../shared/validation.js'
import { deleteMediaObjects } from '../media/routes.js'

export const privacyPolicy = {
  version: '2026-10-14',
  text: 'LinkAtletas utiliza dados de conta e perfil para autenticação e acompanhamento esportivo. Vídeos de performance, saúde e comunicações opcionais exigem consentimento separado. Você pode exportar os dados e solicitar encerramento mediante senha. Documentos profissionais são acessíveis ao titular e ao administrador responsável; treinos, mensagens e arquivos são acessíveis às partes autorizadas do vínculo. As integrações externas só operam quando configuradas pelo responsável.',
  retention:
    'Demonstração acadêmica: encerramento remove saúde, conteúdo de mensagens/execuções e arquivos próprios, anonimiza a conta e conserva referências de ciclos, auditoria e registros financeiros minimizados. Financeiro em operação exige conciliação antes do encerramento. Não há prazo legal presumido: uma política de retenção revisada pelo responsável é necessária antes de operação pública. Backups são protegidos e devem ser expirados conforme essa política; uma restauração precisa reaplicar solicitações de exclusão.',
}
const consent = z
  .object({
    purpose: z.enum(['performance', 'health', 'communications']),
    granted: z.boolean(),
  })
  .strict()
const password = z.string().min(8).max(128)
async function accountLock(client: import('pg').PoolClient, userId: string) {
  const account = await client.query(
    'SELECT 1 FROM users WHERE id=$1 AND disabled_at IS NULL FOR SHARE',
    [userId],
  )
  if (!account.rowCount)
    fail(401, 'UNAUTHENTICATED', 'Esta conta foi encerrada.')
}
export async function platformRoutes(app: FastifyInstance, pool: Pool) {
  app.addHook('onClose', async () => drainMailDeliveries(pool))
  const schema = { tags: ['Conta e privacidade'] }
  const forgot = z.object({ email: z.email().max(254) }).strict()
  for (const prefix of ['/auth', '/auth/native']) {
    app.post(
      `${prefix}/forgot-password`,
      {
        config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
        schema: { ...schema, security: [], body: bodySchema(forgot) },
      },
      async (req) => {
        const input = forgot.parse(req.body)
        const token = newToken()
        const mailId = await transaction(pool, async (client) => {
          const { rows } = await client.query(
            'SELECT id,email FROM users WHERE email=$1 AND disabled_at IS NULL FOR UPDATE',
            [input.email.trim().toLowerCase()],
          )
          if (!rows[0]) return
          await client.query('DELETE FROM password_resets WHERE user_id=$1', [
            rows[0].id,
          ])
          const created = await client.query<{ expires_at: Date }>(
            "INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 minutes') RETURNING expires_at",
            [tokenHash(token), rows[0].id],
          )
          return queueMail(
            client,
            rows[0].id,
            rows[0].email,
            'Recuperação de acesso — LinkAtletas',
            `Abra ${process.env.APP_ORIGIN || 'http://localhost:5173'}/redefinir-senha#token=${token}\nO link expira em 30 minutos e só pode ser usado uma vez. Se não solicitou, ignore esta mensagem.`,
            { tokenHash: tokenHash(token), expiresAt: created.rows[0].expires_at },
          )
        })
        if (mailId)
          scheduleMailDelivery(pool, mailId, () =>
            req.log.warn('Entrega de email adiada para o cron.'),
          )
        return {
          ok: true,
          message:
            'Se a conta existir, enviaremos as instruções de recuperação.',
        }
      },
    )
    const reset = z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/), password })
      .strict()
    app.post(
      `${prefix}/reset-password`,
      {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
        schema: { ...schema, security: [], body: bodySchema(reset) },
      },
      async (req) => {
        const input = reset.parse(req.body),
          hash = await hashPassword(input.password)
        const mailId = await transaction(pool, async (client) => {
          await client.query('SELECT id FROM users WHERE id=(SELECT user_id FROM password_resets WHERE token_hash=$1) AND disabled_at IS NULL FOR UPDATE', [tokenHash(input.token)])
          const { rows } = await client.query(
            'SELECT r.user_id,u.email FROM password_resets r JOIN users u ON u.id=r.user_id WHERE token_hash=$1 AND used_at IS NULL AND expires_at>clock_timestamp() AND u.disabled_at IS NULL FOR UPDATE OF r',
            [tokenHash(input.token)],
          )
          if (!rows[0])
            fail(
              400,
              'INVALID_RESET',
              'Link inválido, expirado ou já utilizado.',
            )
          await client.query(
            'UPDATE password_resets SET used_at=now() WHERE token_hash=$1',
            [tokenHash(input.token)],
          )
          await client.query('UPDATE users SET password_hash=$1 WHERE id=$2', [
            hash,
            rows[0].user_id,
          ])
          await client.query('DELETE FROM sessions WHERE user_id=$1', [
            rows[0].user_id,
          ])
          return queueMail(
            client,
            rows[0].user_id,
            rows[0].email,
            'Senha alterada — LinkAtletas',
            'Sua senha foi alterada. Todas as sessões anteriores foram encerradas. Se não reconhece esta alteração, contate o responsável pelo projeto.',
          )
        })
        scheduleMailDelivery(pool, mailId, () =>
          req.log.warn('Entrega de email adiada para o cron.'),
        )
        return { ok: true }
      },
    )
  }
  app.get(
    '/privacy/policy',
    { schema: { ...schema, security: [] } },
    async () => ({ policy: privacyPolicy }),
  )
  app.get('/privacy/consents', { schema }, async (req) => {
    const user = requireUser(req)
    return {
      consents: (
        await pool.query(
          'SELECT purpose,granted,version,updated_at AS "updatedAt" FROM consents WHERE user_id=$1',
          [user.id],
        )
      ).rows,
    }
  })
  app.put(
    '/privacy/consents',
    { schema: { ...schema, body: bodySchema(consent) } },
    async (req) => {
      const user = requireUser(req),
        input = consent.parse(req.body)
      await transaction(pool, async (client) => {
        await accountLock(client, user.id)
        await client.query(
          'INSERT INTO consents(user_id,purpose,granted,version) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,purpose) DO UPDATE SET granted=EXCLUDED.granted,version=EXCLUDED.version,updated_at=now()',
          [user.id, input.purpose, input.granted, privacyPolicy.version],
        )
        await client.query(
          'INSERT INTO consent_history(user_id,purpose,granted,version) VALUES($1,$2,$3,$4)',
          [user.id, input.purpose, input.granted, privacyPolicy.version],
        )
        if (!input.granted && input.purpose === 'health')
          await client.query('DELETE FROM private_health WHERE user_id=$1', [
            user.id,
          ])
      })
      if (!input.granted && input.purpose === 'performance')
        await deleteMediaObjects(pool, user.id, 'performance')
      return {
        consents: (
          await pool.query(
            'SELECT purpose,granted,version,updated_at AS "updatedAt" FROM consents WHERE user_id=$1',
            [user.id],
          )
        ).rows,
      }
    },
  )
  const health = z
    .object({
      notes: z.string().max(4000),
      heightCm: z.number().min(30).max(300).optional(),
      weightKg: z.number().min(1).max(700).optional(),
    })
    .strict()
  app.get('/privacy/health', { schema }, async (req) => {
    const user = requireUser(req),
      { rows } = await pool.query(
        'SELECT encrypted_data FROM private_health WHERE user_id=$1',
        [user.id],
      )
    return {
      health: rows[0]
        ? JSON.parse(decryptPrivate(rows[0].encrypted_data))
        : null,
    }
  })
  app.put(
    '/privacy/health',
    { schema: { ...schema, body: bodySchema(health) } },
    async (req) => {
      const user = requireUser(req),
        input = health.parse(req.body)
      await transaction(pool, async (client) => {
        await accountLock(client, user.id)
        const { rows } = await client.query(
          "SELECT 1 FROM consents WHERE user_id=$1 AND purpose='health' AND granted=true FOR SHARE",
          [user.id],
        )
        if (!rows[0])
          fail(
            403,
            'CONSENT_REQUIRED',
            'Conceda consentimento de saúde antes de registrar os dados.',
          )
        await client.query(
          'INSERT INTO private_health(user_id,encrypted_data) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET encrypted_data=EXCLUDED.encrypted_data,updated_at=now()',
          [user.id, encryptPrivate(JSON.stringify(input))],
        )
      })
      return { health: input }
    },
  )
  app.get('/privacy/export', { schema }, async (req) => {
    const user = requireUser(req)
    const profile = (
      await pool.query('SELECT * FROM profiles WHERE user_id=$1', [user.id])
    ).rows[0]
    const contracts = (
      await pool.query(
        'SELECT * FROM contracts WHERE athlete_id=$1 OR coach_id=$1',
        [user.id],
      )
    ).rows
    const workouts = (
      await pool.query(
        `SELECT w.* FROM workouts w JOIN contracts c ON c.id=w.contract_id WHERE c.coach_id=$1 OR (c.athlete_id=$1 AND w.status='published')`,
        [user.id],
      )
    ).rows
    const executions = (
      await pool.query(
        'SELECT e.* FROM executions e JOIN workouts w ON w.id=e.workout_id JOIN contracts c ON c.id=w.contract_id WHERE c.athlete_id=$1',
        [user.id],
      )
    ).rows.map((row) => ({
      ...row,
      ...(row.private_payload
        ? JSON.parse(decryptPrivate(row.private_payload))
        : {}),
      private_payload: undefined,
    }))
    const health = (
      await pool.query(
        'SELECT encrypted_data FROM private_health WHERE user_id=$1',
        [user.id],
      )
    ).rows[0]
    const consents = (
      await pool.query(
        'SELECT purpose,granted,version,updated_at FROM consents WHERE user_id=$1',
        [user.id],
      )
    ).rows
    const media = (
      await pool.query(
        'SELECT id,purpose,resource_id,name,mime_type,size,created_at FROM media WHERE owner_id=$1 AND deleted_at IS NULL',
        [user.id],
      )
    ).rows
    const messages = (
      await pool.query(
        'SELECT id,contract_id,sender_id,body_ciphertext,created_at FROM messages WHERE sender_id=$1',
        [user.id],
      )
    ).rows.map((row) => ({
      ...row,
      text: decryptPrivate(row.body_ciphertext),
      body_ciphertext: undefined,
    }))
    const reviews = (
      await pool.query('SELECT * FROM reviews WHERE athlete_id=$1', [user.id])
    ).rows
    const consultations = (
      await pool.query(
        'SELECT a.* FROM consultations a JOIN contracts c ON c.id=a.contract_id WHERE c.athlete_id=$1 OR c.coach_id=$1',
        [user.id],
      )
    ).rows.map((row) => ({
      ...row,
      description: decryptPrivate(row.description_ciphertext),
      description_ciphertext: undefined,
    }))
    const notifications = (
      await pool.query('SELECT * FROM notifications WHERE user_id=$1', [
        user.id,
      ])
    ).rows
    const subscriptions = (
      await pool.query(
        'SELECT s.id,s.contract_id,s.plan_name,s.amount_cents,s.environment,s.state,s.paid_until,s.created_at FROM billing_subscriptions s JOIN contracts c ON c.id=s.contract_id WHERE c.athlete_id=$1 OR c.coach_id=$1',
        [user.id],
      )
    ).rows
    const payments = (
      await pool.query(
        'SELECT p.id,p.subscription_id,p.amount_cents,p.net_cents,p.status,p.paid_at,p.due_date,p.coach_share_cents,p.platform_share_cents FROM billing_payments p JOIN billing_subscriptions s ON s.id=p.subscription_id JOIN contracts c ON c.id=s.contract_id WHERE c.athlete_id=$1 OR c.coach_id=$1',
        [user.id],
      )
    ).rows
    const wallet =
      (
        await pool.query(
          'SELECT wallet_id,updated_at FROM billing_wallets WHERE coach_id=$1',
          [user.id],
        )
      ).rows[0] || null
    const plan =
      (
        await pool.query(
          'SELECT name,amount_cents,active FROM billing_plans WHERE coach_id=$1',
          [user.id],
        )
      ).rows[0] || null
    const reviewReplies = (
      await pool.query(
        'SELECT id,reply,replied_at FROM reviews WHERE coach_id=$1 AND reply IS NOT NULL',
        [user.id],
      )
    ).rows
    const consentHistory = (
      await pool.query(
        'SELECT purpose,granted,version,created_at FROM consent_history WHERE user_id=$1',
        [user.id],
      )
    ).rows
    return {
      exportedAt: new Date().toISOString(),
      user,
      profile,
      contracts,
      workouts,
      executions,
      health: health ? JSON.parse(decryptPrivate(health.encrypted_data)) : null,
      consents,
      consentHistory,
      media,
      messages,
      reviews,
      reviewReplies,
      consultations,
      notifications,
      financial: { subscriptions, payments, wallet, plan },
    }
  })
  app.post(
    '/privacy/delete',
    {
      schema: { ...schema, body: bodySchema(z.object({ password }).strict()) },
    },
    async (req) => {
      const user = requireUser(req),
        input = z.object({ password }).strict().parse(req.body)
      await transaction(pool, async (client) => {
        // Lock the account before the final financial check. Checkout/media/session creation share this lock.
        const account = (
          await client.query(
            'SELECT password_hash FROM users WHERE id=$1 AND disabled_at IS NULL FOR UPDATE',
            [user.id],
          )
        ).rows[0]
        if (
          !account ||
          !(await verifyPassword(input.password, account.password_hash))
        )
          fail(401, 'INVALID_CREDENTIALS', 'Confirme sua senha atual.')
        const financial = (
          await client.query(
            "SELECT 1 FROM billing_subscriptions s JOIN contracts c ON c.id=s.contract_id WHERE (c.athlete_id=$1 OR c.coach_id=$1) AND s.state<>'ended' LIMIT 1",
            [user.id],
          )
        ).rowCount
        if (financial)
          fail(
            409,
            'FINANCIAL_RETENTION',
            'Encerre e concilie suas assinaturas antes de excluir a conta.',
          )
        // Objects are removed before completion. An S3 failure rolls back the account and is retryable.
        await deleteMediaObjects(pool, user.id)
        await client.query('INSERT INTO privacy_requests(user_id) VALUES($1)', [
          user.id,
        ])
        await client.query('DELETE FROM sessions WHERE user_id=$1', [user.id])
        await client.query('DELETE FROM password_resets WHERE user_id=$1', [
          user.id,
        ])
        await client.query('DELETE FROM mail_outbox WHERE user_id=$1', [
          user.id,
        ])
        await client.query('DELETE FROM private_health WHERE user_id=$1', [
          user.id,
        ])
        await client.query('DELETE FROM consents WHERE user_id=$1', [user.id])
        await client.query(
          "UPDATE users SET name='Conta encerrada',email=$1,password_hash='',disabled_at=now() WHERE id=$2",
          [`closed-${user.id}@deleted.local`, user.id],
        )
        await client.query(
          "UPDATE profiles SET city='',bio='',sports='{}',goals='{}',levels='{}',availability='{}',cref='',verification_status='unsubmitted',verification_reason='' WHERE user_id=$1",
          [user.id],
        )
        await client.query(
          "UPDATE contracts SET status='cancelled' WHERE (athlete_id=$1 OR coach_id=$1) AND status IN ('pending','active','suspended')",
          [user.id],
        )
        await client.query(
          'UPDATE messages SET body_ciphertext=$1 WHERE sender_id=$2',
          [encryptPrivate('Conteúdo eliminado pelo titular.'), user.id],
        )
        await client.query(
          "UPDATE executions SET notes='',metrics='{}',private_payload=NULL WHERE workout_id IN (SELECT w.id FROM workouts w JOIN contracts c ON c.id=w.contract_id WHERE c.athlete_id=$1)",
          [user.id],
        )
        await client.query(
          "UPDATE verifications SET evidence='Eliminado pelo titular',cref='',reason='' WHERE coach_id=$1",
          [user.id],
        )
        await client.query('DELETE FROM notifications WHERE user_id=$1', [
          user.id,
        ])
        await client.query(
          "UPDATE reviews SET body='Conteúdo eliminado pelo titular.',reply=NULL,hidden=true WHERE athlete_id=$1",
          [user.id],
        )
        await client.query('UPDATE reviews SET reply=NULL WHERE coach_id=$1', [
          user.id,
        ])
        await client.query(
          "UPDATE consultations SET description_ciphertext=$1,title='Consultoria encerrada',meeting_url=NULL,status='cancelled' WHERE contract_id IN (SELECT id FROM contracts WHERE athlete_id=$2 OR coach_id=$2)",
          [encryptPrivate('Conteúdo eliminado pelo titular.'), user.id],
        )
        await client.query(
          "UPDATE privacy_requests SET status='completed',completed_at=now() WHERE user_id=$1 AND status='pending'",
          [user.id],
        )
      })
      return { ok: true }
    },
  )
  app.get(
    '/admin/privacy/requests',
    { schema: { tags: ['Administração'] } },
    async (req) => {
      requireUser(req, 'admin')
      return {
        requests: (
          await pool.query(
            'SELECT * FROM privacy_requests ORDER BY requested_at DESC',
          )
        ).rows,
      }
    },
  )
}
