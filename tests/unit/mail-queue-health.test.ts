import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { readMailQueueHealth } from '../../server/services/mail-queue-health.js'

describe('saude agregada da fila de email', () => {
  it.each([
    [0, 0, 0, 0, null, true],
    [1, 0, 0, 0, 30, true],
    [1, 1, 0, 0, 120, false],
    [2, 0, 1, 0, 1801, false],
    [0, 0, 0, 1, null, false],
  ])('distingue pendencia transitora de esgotamento e atraso', async (pending, exhausted, overdue, failedDiscarded, oldest, healthy) => {
    const query = vi.fn().mockResolvedValue({ rows: [{ pending, exhausted, overdue, failed_discarded: failedDiscarded, oldest_pending_seconds: oldest }] })
    const result = await readMailQueueHealth({ query } as unknown as Pool)
    expect(result).toEqual({ healthy, pending, exhausted, overdue, failedDiscarded, oldestPendingSeconds: oldest })
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('discarded_at IS NULL'))
    expect(JSON.stringify(result)).not.toMatch(/recipient|token|body|password/)
  })
})
