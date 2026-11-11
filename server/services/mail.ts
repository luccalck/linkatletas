import nodemailer from 'nodemailer'
import { waitUntil } from '@vercel/functions'
import type { Pool, PoolClient } from 'pg'
import { encryptPrivate, decryptPrivate } from '../shared/crypto.js'
import { transaction } from '../db/pool.js'

const pendingDeliveries = new WeakMap<Pool, Set<Promise<void>>>()

export function scheduleMailDelivery(
  pool: Pool,
  mailId: string,
  onError: () => void,
) {
  const pending = pendingDeliveries.get(pool) ?? new Set<Promise<void>>()
  pendingDeliveries.set(pool, pending)
  const delivery = deliverOutbox(pool, mailId)
    .then(() => undefined)
    .catch(() => onError())
    .finally(() => pending.delete(delivery))
  pending.add(delivery)
  if (process.env.VERCEL === '1') waitUntil(delivery)
}

export async function drainMailDeliveries(pool: Pool) {
  const pending = pendingDeliveries.get(pool)
  while (pending?.size) await Promise.all(pending)
}

export async function queueMail(
  client: Pool | PoolClient,
  userId: string,
  recipient: string,
  subject: string,
  text: string,
  reset?: { tokenHash: string; expiresAt: Date | string },
) {
  const { rows } = await client.query<{ id: string }>(
    'INSERT INTO mail_outbox(user_id,recipient,subject,encrypted_body,purpose,reset_token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [userId, recipient, subject, encryptPrivate(text), reset ? 'password_reset' : 'notification', reset?.tokenHash ?? null, reset?.expiresAt ?? null],
  )
  return rows[0].id
}
export async function deliverOutbox(pool: Pool, mailId?: string) {
  if (process.env.VERCEL_ENV === 'preview') return { sent: 0, disabled: true }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || '127.0.0.1',
    port: Number(process.env.SMTP_PORT || 1025),
    secure: process.env.SMTP_SECURE === 'true',
    requireTLS:
      process.env.NODE_ENV === 'production' &&
      process.env.SMTP_SECURE !== 'true',
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    dnsTimeout: 5000,
    socketTimeout: 5000,
    ...(process.env.SMTP_USER
      ? {
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
          },
        }
      : {}),
  })
  try {
    let sent = 0
    const visited: string[] = []
    for (let i = 0; i < (mailId ? 1 : 25); i++) {
      const found = await transaction(pool, async (client) => {
        const candidates = await client.query(
          `SELECT * FROM mail_outbox WHERE sent_at IS NULL AND discarded_at IS NULL AND attempts<5 AND next_attempt_at<=now() AND id<>ALL($1::uuid[])${mailId ? ' AND id=$2' : ''} ORDER BY created_at LIMIT 1`,
          mailId ? [visited, mailId] : [visited],
        )
        const candidate = candidates.rows[0]
        if (!candidate) return false
        visited.push(candidate.id)
        const reset = candidate.purpose === 'password_reset'
          ? (await client.query('SELECT token_hash,user_id,used_at,expires_at>clock_timestamp() AS valid FROM password_resets WHERE token_hash=$1 FOR SHARE', [candidate.reset_token_hash])).rows[0]
          : undefined
        const { rows } = await client.query(
          'SELECT *,expires_at IS NULL OR expires_at>clock_timestamp() AS delivery_valid FROM mail_outbox WHERE sent_at IS NULL AND discarded_at IS NULL AND attempts<5 AND next_attempt_at<=now() AND id=$1 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1',
          [candidate.id],
        )
        if (!rows[0]) return true
        const item = rows[0]
        if (item.reset_token_hash !== candidate.reset_token_hash || item.purpose !== candidate.purpose) return true
        const account = (await client.query('SELECT disabled_at FROM users WHERE id=$1', [item.user_id])).rows[0]
        const discardReason = item.purpose === 'legacy' ? 'legacy'
          : !account || account.disabled_at ? 'inactive_account'
          : item.purpose === 'password_reset' && (!reset || reset.user_id !== item.user_id) ? 'invalid_reference'
          : item.purpose === 'password_reset' && reset?.used_at ? 'used'
          : item.delivery_valid === false || (item.purpose === 'password_reset' && !reset?.valid) ? 'expired'
          : undefined
        if (discardReason) {
          await client.query("UPDATE mail_outbox SET discarded_at=now(),discard_reason=$2,encrypted_body='',last_error=NULL WHERE id=$1", [item.id, discardReason])
          return true
        }
        try {
          await transporter.sendMail({
            from:
              process.env.SMTP_FROM || 'LinkAtletas <no-reply@linkatletas.local>',
            to: item.recipient,
            subject: item.subject,
            text: decryptPrivate(item.encrypted_body),
          })
          await client.query(
            "UPDATE mail_outbox SET sent_at=now(),encrypted_body='',attempts=attempts+1,last_error=NULL WHERE id=$1",
            [item.id],
          )
          sent++
        } catch {
          await client.query(
            "UPDATE mail_outbox SET attempts=attempts+1,next_attempt_at=now()+interval '1 minute'*power(2,attempts),last_error='SMTP indisponível' WHERE id=$1",
            [item.id],
          )
        }
        return true
      })
      if (!found) break
    }
    return { sent }
  } finally {
    transporter.close()
  }
}
