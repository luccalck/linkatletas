import { pathToFileURL } from 'node:url'
import type { Pool } from 'pg'
import { createPool } from './db/pool.js'
import { cleanupMediaUploads } from './modules/media/uploads.js'
import { mediaStorage, mediaBucket } from './modules/media/routes.js'
import { deliverOutbox } from './services/mail.js'
import { readMailQueueHealth } from './services/mail-queue-health.js'
import { expireVerifications } from './modules/accounts/verification.js'
import { processBillingEvents } from './modules/billing/events.js'
import { expireBillingAccess, reconcileBilling } from './modules/billing/lifecycle.js'

export async function runJobs(pool: Pool) {
  const verifications = await expireVerifications(pool)
  await processBillingEvents(pool)
  await reconcileBilling(pool)
  await expireBillingAccess(pool)
  const mail = await deliverOutbox(pool)
  const uploads = await cleanupMediaUploads(pool, mediaStorage, mediaBucket())
  await pool.query('DELETE FROM sessions WHERE expires_at<=now()')
  await pool.query(
    "DELETE FROM password_resets WHERE expires_at<now()-interval '1 day'",
  )
  const mailHealth = await readMailQueueHealth(pool)
  return { verifications, mail, mailHealth, uploads, completedAt: new Date().toISOString() }
}
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const pool = createPool()
  try {
    console.log(JSON.stringify(await runJobs(pool)))
  } finally {
    await pool.end()
  }
}
