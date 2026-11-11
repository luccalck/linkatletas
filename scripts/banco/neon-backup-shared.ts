import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { S3Client } from '@aws-sdk/client-s3'
import { z } from 'zod'

export const MAX_BACKUP_BYTES = 128 * 1024 * 1024
export const backupPattern = /^neon\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{32}\.lan$/
const header = Buffer.from('LAN1')
const legacyArchiveSchema = z.object({
  version: z.literal(1),
  createdAt: z.iso.datetime(),
  tableCounts: z.record(z.string().regex(/^[a-z_][a-z0-9_]*$/), z.number().int().nonnegative()),
  migrations: z.array(z.string().regex(/^\d{3}_[a-z0-9_]+\.sql$/)),
  dataKeyFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  dumpBase64: z.string().min(8),
}).strict()
const identifier = z.string().regex(/^[a-z_][a-z0-9_]*$/)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const archiveSchema = z.discriminatedUnion('version', [legacyArchiveSchema, legacyArchiveSchema.extend({
  version: z.literal(2),
  objects: z.array(z.object({
    sourceKey: z.string().min(1).max(1024),
    backupKey: z.string().regex(/^neon\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{32}\/objects\/[a-f0-9]{64}$/),
    bytes: z.number().int().positive().max(MAX_BACKUP_BYTES),
    sha256: hash,
  }).strict()),
  extensions: z.array(z.object({ name: identifier, version: z.string().regex(/^[0-9][a-z0-9_.-]*$/) }).strict()),
  migrationChecksums: z.record(z.string().regex(/^\d{3}_[a-z0-9_]+\.sql$/), hash),
  runtimePrivileges: z.record(identifier, z.array(z.enum(['SELECT', 'INSERT', 'UPDATE', 'DELETE']))),
}).strict()])
export type NeonArchive = z.infer<typeof archiveSchema>
export type FullNeonArchive = Extract<NeonArchive, { version: 2 }>

const validationSchema = z.object({
  version: z.literal(1),
  backupKey: z.string().regex(backupPattern),
  archiveSha256: hash,
  archiveBytes: z.number().int().positive().max(MAX_BACKUP_BYTES),
  createdAt: z.iso.datetime(),
  validatedAt: z.iso.datetime(),
  tables: z.number().int().positive(),
  objects: z.number().int().nonnegative(),
  elapsedSeconds: z.number().nonnegative(),
}).strict()
export type BackupValidation = z.infer<typeof validationSchema>
const validationHeader = Buffer.from('LAV1')

export function objectBackupPrefix(key: string) {
  if (!backupPattern.test(key)) throw new Error('Objeto de backup invalido.')
  return key.slice(0, -4) + '/objects/'
}

export function validationKey(key: string) {
  objectBackupPrefix(key)
  return 'neon/validated/' + key.slice(-36, -4) + '.lav'
}

export function encodeValidation(input: BackupValidation, key: Buffer) {
  const value = validationSchema.parse(input)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(validationHeader)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()])
  return Buffer.concat([validationHeader, iv, cipher.getAuthTag(), encrypted])
}

export function decodeValidation(bytes: Buffer, key: Buffer) {
  if (bytes.length < 33 || bytes.length > 4096 || !bytes.subarray(0, 4).equals(validationHeader)) throw new Error('Validacao de backup invalida.')
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(4, 16))
  decipher.setAAD(validationHeader)
  decipher.setAuthTag(bytes.subarray(16, 32))
  const value = Buffer.concat([decipher.update(bytes.subarray(32)), decipher.final()])
  return validationSchema.parse(JSON.parse(value.toString('utf8')))
}

export function assertValidationTimeline(input: BackupValidation, now = new Date()) {
  const value = validationSchema.parse(input)
  const created = Date.parse(value.createdAt)
  const validated = Date.parse(value.validatedAt)
  const age = now.getTime() - created
  if (!Number.isFinite(age) || age < -300000 || validated < created || validated > now.getTime() + 300000 || value.createdAt.slice(0, 10) !== value.backupKey.split('/')[1]) {
    throw new Error('Validacao de backup com cronologia invalida.')
  }
  return value
}

export function assertFreshValidation(input: BackupValidation, now = new Date()) {
  const value = assertValidationTimeline(input, now)
  if (now.getTime() - Date.parse(value.createdAt) > 26 * 3600000) {
    throw new Error('Ultimo backup validado ausente ou atrasado.')
  }
  return value
}

export function restoreStorageSettings(endpointValue: string, bucket: string) {
  const endpoint = new URL(endpointValue)
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) ||
    endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !/^linkatletas-restore-[a-z0-9-]+-test$/.test(bucket)) {
    throw new Error('Restauracao de objetos exige bucket local exclusivo com sufixo -test.')
  }
  return { endpoint, bucket }
}

export function backupKey(value: string) {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error('Chave de backup invalida.')
  const key = Buffer.from(value, 'base64')
  if (key.length !== 32) throw new Error('Chave de backup invalida.')
  return key
}

export function encodeBackup(input: NeonArchive, key: Buffer) {
  const value = archiveSchema.parse(input)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(header)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()])
  const output = Buffer.concat([header, iv, cipher.getAuthTag(), encrypted])
  if (output.length > MAX_BACKUP_BYTES) throw new Error('Backup ultrapassa o limite de memoria configurado.')
  return output
}

export function decodeBackup(bytes: Buffer, key: Buffer): NeonArchive {
  if (bytes.length < 33 || bytes.length > MAX_BACKUP_BYTES || !bytes.subarray(0, 4).equals(header)) {
    throw new Error('Arquivo de backup invalido.')
  }
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(4, 16))
  decipher.setAAD(header)
  decipher.setAuthTag(bytes.subarray(16, 32))
  const value = Buffer.concat([decipher.update(bytes.subarray(32)), decipher.final()])
  const archive = archiveSchema.parse(JSON.parse(value.toString('utf8')))
  if (Buffer.from(archive.dumpBase64, 'base64').subarray(0, 5).toString() !== 'PGDMP') {
    throw new Error('Dump PostgreSQL invalido.')
  }
  return archive
}

export function expiredBackups(objects: { Key?: string; LastModified?: Date }[], now = new Date()) {
  return objects.filter(object => object.Key && backupPattern.test(object.Key) && object.LastModified &&
    object.LastModified.getTime() < now.getTime() - 7 * 86400000).map(object => object.Key!)
}

export function sourceDatabase(value: string) {
  const url = new URL(value)
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || !url.hostname.endsWith('.neon.tech') || !url.username || !url.password) {
    throw new Error('Origem exige conexao Neon autenticada.')
  }
  const labels = url.hostname.split('.')
  labels[0] = labels[0].replace(/-pooler$/, '')
  url.hostname = labels.join('.')
  url.search = ''
  url.searchParams.set('sslmode', 'verify-full')
  return url
}

export function restoreDatabase(value: string) {
  const url = new URL(value)
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !/^[a-z][a-z0-9_]*_test$/.test(decodeURIComponent(url.pathname.slice(1)))) throw new Error('Restauracao exige base local isolada com sufixo _test.')
  url.search = ''
  url.searchParams.set('sslmode', 'disable')
  return url
}

export function required(name: string) {
  const value = process.env[name]
  if (!value) throw new Error('Configuracao de backup ausente: ' + name)
  return value
}

export function postgresFailure(stderr: string) {
  const cases: [RegExp, string][] = [
    [/schema "public" already exists/i, 'PUBLIC_SCHEMA_EXISTS'],
    [/function [^\r\n]+ does not exist/i, 'FUNCTION_MISSING'],
    [/permission denied/i, 'PERMISSION_DENIED'],
    [/authentication failed/i, 'AUTHENTICATION_FAILED'],
    [/connection [^\r\n]+ failed|could not connect/i, 'CONNECTION_FAILED'],
  ]
  return 'Comando PostgreSQL falhou [' + (cases.find(([pattern]) => pattern.test(stderr))?.[1] || 'COMMAND_FAILED') + '].'
}

export function backupStorage() {
  const endpoint = new URL(required('NEON_BACKUP_S3_ENDPOINT'))
  if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.tigris.dev')) throw new Error('Endpoint Tigris invalido.')
  const bucket = required('NEON_BACKUP_BUCKET')
  if (!/^linkatletas-backups-[a-z0-9-]+$/.test(bucket)) throw new Error('Bucket exclusivo de backup obrigatorio.')
  const client = new S3Client({
    endpoint: endpoint.toString(), region: 'auto', forcePathStyle: true,
    credentials: { accessKeyId: required('NEON_BACKUP_ACCESS_KEY'), secretAccessKey: required('NEON_BACKUP_SECRET_KEY') },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    requestHandler: { connectionTimeout: 15000, requestTimeout: 120000 },
  })
  return { client, bucket, endpoint }
}

export async function postgresCommand(tool: 'pg_dump' | 'pg_restore', url: URL, args: string[], input?: Buffer) {
  const variables = {
    PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE: url.searchParams.get('sslmode') || 'verify-full', PGCONNECT_TIMEOUT: '15',
    PGSSLROOTCERT: url.searchParams.get('sslmode') === 'disable' ? undefined : 'system',
  }
  const child = spawn('docker', [
    'run', '--rm', '--network', 'host', '-i',
    ...Object.keys(variables).flatMap(name => ['--env', name]),
    'postgres:18-alpine', tool, ...args,
  ], { env: { ...process.env, ...variables }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => { if (stderr.length < 16384) stderr += chunk.toString('utf8').slice(0, 16384 - stderr.length) })
  child.stdin.on('error', () => {})
  const output: Buffer[] = []
  let size = 0
  const finished = new Promise<Buffer>((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BACKUP_BYTES) { child.kill(); reject(new Error('Dump excede o limite de memoria.')); return }
      output.push(chunk)
    })
    child.once('error', () => reject(new Error('Cliente PostgreSQL indisponivel.')))
    child.once('close', code => code === 0 ? resolve(Buffer.concat(output)) : reject(new Error(postgresFailure(stderr))))
  })
  const timeout = setTimeout(() => child.kill(), 180000)
  try {
    child.stdin.end(input)
    return await finished
  } finally { clearTimeout(timeout) }
}
