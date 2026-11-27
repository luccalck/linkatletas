import { createHash, randomUUID } from 'node:crypto'
import { appendFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { backupKey, backupStorage, decodeBackup, encodeBackup, objectBackupPrefix, postgresCommand, required, sourceDatabase, type FullNeonArchive } from './neon-backup-shared.js'
import { applicationStorage, copyEncryptedObject, readObject } from './neon-backup-objects.js'

export async function createNeonBackup() {
  const url = sourceDatabase(required('NEON_BACKUP_DATABASE_URL'))
  const key = backupKey(required('NEON_BACKUP_ENCRYPTION_KEY'))
  const fingerprint = required('NEON_BACKUP_DATA_KEY_FINGERPRINT')
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Fingerprint da chave de dados invalido.')
  const runtimeRole = required('NEON_BACKUP_RUNTIME_ROLE')
  if (!/^linkatletas_[a-z0-9_]+$/.test(runtimeRole)) throw new Error('Role runtime invalida.')
  const database = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 15000 })
  database.on('error', () => {})
  const { client: storage, bucket, endpoint } = backupStorage()
  const sourceStorage = applicationStorage()
  if (sourceStorage.bucket === bucket) throw new Error('Origem e destino de objetos devem ser separados.')
  if (required('NEON_BACKUP_SOURCE_S3_ACCESS_KEY') === required('NEON_BACKUP_ACCESS_KEY')) throw new Error('Copia exige credencial readonly exclusiva para origem.')
  const createdAt = new Date().toISOString()
  const objectKey = `neon/${createdAt.slice(0, 10)}/${randomUUID().replaceAll('-', '')}.lan`
  let connected = false
  try {
    await database.connect()
    connected = true
    const rights = await database.query(`SELECT bool_or(rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AS elevated FROM pg_roles WHERE rolname=current_user`)
    const writes = await database.query(`SELECT count(*)::int AS total FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND (has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') OR pg_get_userbyid(c.relowner)=current_user)`)
    const ddl = await database.query("SELECT has_database_privilege(current_user,current_database(),'CREATE') OR has_schema_privilege(current_user,'public','CREATE') AS allowed")
    if (rights.rows[0].elevated || writes.rows[0].total || ddl.rows[0].allowed) throw new Error('Backup exige conta somente leitura.')
    await database.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await database.query("SET LOCAL statement_timeout='2min'")
    await database.query("SET LOCAL idle_in_transaction_session_timeout='5min'")
    const tables = (await database.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows
    if (!tables.length) throw new Error('Origem vazia; backup cancelado.')
    const counts: Record<string, number> = {}
    for (const table of tables) {
      counts[table.tablename] = Number((await database.query(`SELECT count(*) AS total FROM public.${pg.escapeIdentifier(table.tablename)}`)).rows[0].total)
    }
    const migrations = (await database.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map(row => row.version as string)
    const migrationChecksums = Object.fromEntries((await database.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows.map(row => [row.version, row.checksum]))
    const extensions = (await database.query("SELECT e.extname AS name,e.extversion AS version FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname<>'plpgsql' AND n.nspname='public' ORDER BY e.extname")).rows
    if (extensions.some(extension => !/^[a-z_][a-z0-9_]*$/.test(extension.name))) throw new Error('Extensao exige revisao antes do backup.')
    const role = (await database.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1', [runtimeRole])).rows[0]
    if (!role || Object.values(role).some(Boolean)) throw new Error('Runtime de origem ausente ou elevado.')
    const rowSecurity = await database.query("SELECT tablename, current_user AS reader FROM pg_tables WHERE schemaname='public' AND rowsecurity")
    if (rowSecurity.rows.some(row => row.tablename !== 'private_health' || row.reader !== 'linkatletas_backup_reader'))
      throw new Error('Politicas RLS exigem plano explicito de backup e restauracao.')
    if (rowSecurity.rowCount) {
      const verified = await database.query(`SELECT 1 FROM pg_policies
        WHERE schemaname='public' AND tablename='private_health' AND policyname='private_health_backup_read'
          AND cmd='SELECT' AND permissive='PERMISSIVE' AND roles=ARRAY['public']::name[] AND qual=$1
          AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='private_health' AND permissive='RESTRICTIVE')`,
      ["(CURRENT_USER = 'linkatletas_backup_reader'::name)"])
      if (!verified.rowCount) throw new Error('Politica de leitura integral do backup nao confirmada.')
    }
    const runtimePrivileges: FullNeonArchive['runtimePrivileges'] = {}
    for (const table of tables) runtimePrivileges[table.tablename] = []
    const privileges = await database.query("SELECT c.relname AS name,p.privilege,has_table_privilege($1,c.oid,p.privilege) AS allowed FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS p(privilege) WHERE n.nspname='public' AND c.relkind='r'", [runtimeRole])
    for (const row of privileges.rows) if (row.allowed) runtimePrivileges[row.name].push(row.privilege)
    const objects: FullNeonArchive['objects'] = []
    const liveObjects = (await database.query('SELECT object_key FROM media WHERE deleted_at IS NULL ORDER BY object_key')).rows
    const snapshot = (await database.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot as string
    if (!/^[0-9A-Fa-f-]+$/.test(snapshot)) throw new Error('Snapshot invalido.')
    const dump = await postgresCommand('pg_dump', url, ['--format=custom', '--schema=public', ...extensions.map(extension => '--extension=' + extension.name), '--no-owner', '--no-privileges', '--no-comments', '--enable-row-security', '--lock-wait-timeout=5s', '--snapshot=' + snapshot])
    await database.query('ROLLBACK')
    await database.end()
    connected = false
    for (const row of liveObjects) {
      const targetKey = objectBackupPrefix(objectKey) + createHash('sha256').update(row.object_key).digest('hex')
      const copied = await copyEncryptedObject(sourceStorage.client, sourceStorage.bucket, row.object_key, storage, bucket, targetKey)
      objects.push({ sourceKey: row.object_key, backupKey: targetKey, ...copied })
    }
    const bytes = encodeBackup({ version: 2, createdAt, tableCounts: counts, migrations, dataKeyFingerprint: fingerprint, dumpBase64: dump.toString('base64'), objects, extensions, migrationChecksums, runtimePrivileges }, key)
    await storage.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: bytes, ContentType: 'application/octet-stream', CacheControl: 'private, no-store', Metadata: { sha256: createHash('sha256').update(bytes).digest('hex') } }))
    const checked = decodeBackup(await readObject(storage, bucket, objectKey), key)
    if (checked.dumpBase64 !== dump.toString('base64')) throw new Error('Conferencia do upload falhou.')
    const anonymous = await fetch(new URL(`${bucket}/${objectKey}`, endpoint.toString().replace(/\/?$/, '/')), { method: 'HEAD', signal: AbortSignal.timeout(15000) })
    if (![401, 403, 404].includes(anonymous.status)) throw new Error('Privacidade do bucket nao comprovada.')
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `backup_key=${objectKey}\n`)
    console.log(JSON.stringify({ backupKey: objectKey, encrypted: true, private: true, tables: tables.length, objects: objects.length, bytes: bytes.length, validated: false }))
    return objectKey
  } finally {
    if (connected) await database.end()
    storage.destroy()
    sourceStorage.client.destroy()
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  createNeonBackup().catch(() => { console.error('Backup Neon falhou; conferir configuracao e execucao.'); process.exitCode = 1 })
}
