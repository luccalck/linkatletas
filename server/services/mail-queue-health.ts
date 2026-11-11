import type { Pool } from 'pg'

export async function readMailQueueHealth(pool: Pool) {
  const { rows } = await pool.query<{
    pending: number
    exhausted: number
    overdue: number
    failed_discarded: number
    oldest_pending_seconds: number | null
  }>(`SELECT count(*)::int AS pending,
      count(*) FILTER(WHERE attempts>=5)::int AS exhausted,
      count(*) FILTER(WHERE created_at<now()-interval '30 minutes')::int AS overdue,
      floor(extract(epoch FROM now()-min(created_at)))::int AS oldest_pending_seconds,
      (SELECT count(*)::int FROM mail_outbox WHERE discarded_at IS NOT NULL AND discard_reason='expired' AND attempts>0) AS failed_discarded
    FROM mail_outbox WHERE sent_at IS NULL AND discarded_at IS NULL`)
  const state = rows[0]
  return {
    healthy: state.exhausted === 0 && state.overdue === 0 && state.failed_discarded === 0,
    pending: state.pending,
    exhausted: state.exhausted,
    overdue: state.overdue,
    failedDiscarded: state.failed_discarded,
    oldestPendingSeconds: state.oldest_pending_seconds,
  }
}
