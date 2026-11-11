import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { CreateBucketCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { backupKey, backupPattern, backupStorage, decodeBackup, objectBackupPrefix, postgresCommand, required, restoreDatabase } from './neon-backup-shared.js'
import { copyEncryptedObject, isolatedStorage, readObject } from './neon-backup-objects.js'
import { verifyPrivateData, verifyPrivateObjects, verifyRestoredApplication } from './neon-backup-recovery.js'
import { publishBackupValidation } from './neon-backup-validation.js'

export async function verifyNeonBackup(objectKey: string) {
  if (!backupPattern.test(objectKey)) throw new Error('Objeto de backup invalido.')
  const started = performance.now()
  const url = restoreDatabase(required('NEON_BACKUP_RESTORE_URL'))
  const key = backupKey(required('NEON_BACKUP_ENCRYPTION_KEY'))
  const originalKey = backupKey(required('NEON_BACKUP_DATA_ENCRYPTION_KEY'))
  if (originalKey.equals(key)) throw new Error('Chaves original e de backup devem ser independentes.')
  const validationSecret = backupKey(required('NEON_BACKUP_VALIDATION_KEY'))
  if (validationSecret.equals(key) || validationSecret.equals(originalKey)) throw new Error('Chave de validacao deve ser independente das chaves de dados e backup.')
  const fingerprint = createHash('sha256').update(originalKey).digest('hex')
  if (fingerprint !== required('NEON_BACKUP_DATA_KEY_FINGERPRINT')) throw new Error('Chave original nao corresponde ao fingerprint.')
  process.env.DATA_ENCRYPTION_KEY = originalKey.toString('base64')
  const { client: storage, bucket } = backupStorage()
  const localStorage = isolatedStorage()
  const database = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 15000 })
  database.on('error', () => {})
  let connected = false
  let stage = 'manifest'
  try {
    const bytes = await readObject(storage, bucket, objectKey)
    const archive = decodeBackup(bytes, key)
    if (archive.version !== 2) throw new Error('Backup historico v1 nao comprova recuperacao completa de objetos e aplicacao.')
    if (archive.dataKeyFingerprint !== fingerprint) throw new Error('Chave original nao corresponde ao manifesto.')
    if (archive.objects.some(object => !object.backupKey.startsWith(objectBackupPrefix(objectKey)))) throw new Error('Objeto fora do snapshot correspondente.')
    stage = 'target'
    await database.connect()
    connected = true
    const existing = await database.query("SELECT count(*)::int AS total FROM (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' UNION ALL SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' UNION ALL SELECT t.oid FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema') objects")
    if (existing.rows[0].total) throw new Error('Restauracao exige destino vazio; nenhum dado foi removido.')
    try {
      await localStorage.client.send(new CreateBucketCommand({ Bucket: localStorage.bucket }))
    } catch (error) {
      if (!(error instanceof Error) || !['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(error.name)) throw error
    }
    const present = await localStorage.client.send(new ListObjectsV2Command({ Bucket: localStorage.bucket, MaxKeys: 1 }))
    if (present.Contents?.length) throw new Error('Restauracao exige bucket local vazio.')
    for (const extension of archive.extensions) {
      const available = await database.query('SELECT 1 FROM pg_available_extension_versions WHERE name=$1 AND version=$2', [extension.name, extension.version])
      if (!available.rowCount) throw new Error('Extensao original nao esta disponivel no ambiente de recuperacao.')
    }
    await database.query('DROP SCHEMA IF EXISTS public')
    stage = 'pg-restore'
    await postgresCommand('pg_restore', url, ['--dbname', decodeURIComponent(url.pathname.slice(1)), '--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction'], Buffer.from(archive.dumpBase64, 'base64'))
    stage = 'integrity'
    const tables = (await database.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row => row.tablename as string)
    if (JSON.stringify(tables) !== JSON.stringify(Object.keys(archive.tableCounts).sort())) throw new Error('Tabelas restauradas divergem do manifesto.')
    for (const table of tables) {
      const total = Number((await database.query(`SELECT count(*) AS total FROM public.${pg.escapeIdentifier(table)}`)).rows[0].total)
      if (total !== archive.tableCounts[table]) throw new Error('Contagem restaurada diverge do snapshot.')
    }
    const migrations = (await database.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows
    if (JSON.stringify(migrations.map(row => row.version)) !== JSON.stringify(archive.migrations) ||
        migrations.some(row => row.checksum !== archive.migrationChecksums[row.version])) throw new Error('Migrations ou checksums restaurados divergem do manifesto.')
    const extensions = (await database.query("SELECT e.extname AS name,e.extversion AS version FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname<>'plpgsql' AND n.nspname='public' ORDER BY e.extname")).rows
    if (JSON.stringify(extensions) !== JSON.stringify(archive.extensions)) throw new Error('Extensoes restauradas divergem da origem.')
    const invalid = await database.query("SELECT count(*)::int AS total FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND NOT convalidated")
    if (invalid.rows[0].total) throw new Error('Restricoes restauradas nao validadas.')
    stage = 'objects'
    for (const object of archive.objects) {
      const result = await copyEncryptedObject(storage, bucket, object.backupKey, localStorage.client, localStorage.bucket, object.sourceKey)
      if (result.sha256 !== object.sha256 || result.bytes !== object.bytes) throw new Error('Arquivo restaurado diverge do snapshot.')
    }
    stage = 'decrypt'
    const privateFields = await verifyPrivateData(database)
    const privateObjects = await verifyPrivateObjects(database, localStorage.client, localStorage.bucket, archive)
    stage = 'application'
    const application = await verifyRestoredApplication(database, url, archive)
    const elapsedSeconds = Math.round((performance.now() - started) / 10) / 100
    stage = 'validation'
    const validation = await publishBackupValidation(storage, bucket, validationSecret, {
      version: 1, backupKey: objectKey, archiveSha256: createHash('sha256').update(bytes).digest('hex'), archiveBytes: bytes.length,
      createdAt: archive.createdAt, validatedAt: new Date().toISOString(), tables: tables.length, objects: archive.objects.length, elapsedSeconds,
    })
    console.log(JSON.stringify({ restored: true, isolated: true, tables: tables.length, migrations: migrations.length, extensions: extensions.length, snapshotCountsMatch: true, migrationChecksumsMatch: true, privateFields, privateObjects, application, validated: true, historical: validation.historical, freshnessEligible: !validation.historical, elapsedSeconds, academicRtoMinutes: 60, withinAcademicRto: elapsedSeconds <= 3600, expiredRemoved: validation.expiredRemoved }))
  } catch (error) {
    console.error(JSON.stringify({ recoveryFailed: true, stage }))
    throw error
  } finally {
    if (connected) await database.end()
    storage.destroy()
    localStorage.client.destroy()
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  verifyNeonBackup(process.argv[2] || '').catch(error => {
    console.error('Verificacao completa de restauracao Neon falhou.')
    if (error instanceof Error && /^Comando PostgreSQL falhou \[[A-Z_]+\]\.$/.test(error.message)) console.error(error.message)
    process.exitCode = 1
  })
}
