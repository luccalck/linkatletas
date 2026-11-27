import pg from 'pg'
import { databaseUrl } from '../config.js'
export function createPool(url = databaseUrl) {
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
    query_timeout: 35000,
    lock_timeout: 5000,
    idle_in_transaction_session_timeout: 60000,
  })
  const reported = new WeakSet<Error>()
  const report = (error: Error) => {
    if (reported.has(error)) return
    reported.add(error)
    console.error('Conexao PostgreSQL interrompida.')
  }
  pool.on('error', report)
  pool.on('connect', (client) => client.on('error', report))
  return pool
}
export async function transaction<T>(
  pool: pg.Pool,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  let discard = false
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      discard = true
    }
    throw error
  } finally {
    client.release(discard)
  }
}

export async function userTransaction<T>(pool: pg.Pool, userId: string, work: (client: pg.PoolClient) => Promise<T>) {
  return transaction(pool, async (client) => {
    await client.query("SELECT set_config('linkatletas.user_id',$1,true)", [userId])
    return work(client)
  })
}
