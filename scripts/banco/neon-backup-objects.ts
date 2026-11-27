import { createHash } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { MAX_BACKUP_BYTES, required, restoreStorageSettings } from './neon-backup-shared.js'

export function applicationStorage() {
  const endpoint = new URL(required('NEON_BACKUP_SOURCE_S3_ENDPOINT'))
  const bucket = required('NEON_BACKUP_SOURCE_S3_BUCKET')
  if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.tigris.dev') || endpoint.username || endpoint.password ||
      !/^linkatletas-[a-z0-9-]+$/.test(bucket) || bucket.startsWith('linkatletas-backups-')) {
    throw new Error('Origem de objetos exige bucket de aplicacao Tigris separado do backup.')
  }
  return {
    bucket,
    client: new S3Client({
      endpoint: endpoint.toString(), region: 'auto', forcePathStyle: true,
      credentials: { accessKeyId: required('NEON_BACKUP_SOURCE_S3_ACCESS_KEY'), secretAccessKey: required('NEON_BACKUP_SOURCE_S3_SECRET_KEY') },
      requestChecksumCalculation: 'WHEN_REQUIRED', requestHandler: { connectionTimeout: 15000, requestTimeout: 120000 },
    }),
  }
}

export function isolatedStorage() {
  const settings = restoreStorageSettings(required('NEON_BACKUP_RESTORE_S3_ENDPOINT'), required('NEON_BACKUP_RESTORE_S3_BUCKET'))
  return {
    ...settings,
    client: new S3Client({
      endpoint: settings.endpoint.toString(), region: 'us-east-1', forcePathStyle: true,
      credentials: { accessKeyId: required('NEON_BACKUP_RESTORE_S3_ACCESS_KEY'), secretAccessKey: required('NEON_BACKUP_RESTORE_S3_SECRET_KEY') },
      requestChecksumCalculation: 'WHEN_REQUIRED', requestHandler: { connectionTimeout: 15000, requestTimeout: 120000 },
    }),
  }
}

export async function readObject(storage: S3Client, bucket: string, key: string, maximum = MAX_BACKUP_BYTES) {
  const response = await storage.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  if (!response.Body || !response.ContentLength || response.ContentLength > maximum) {
    ;(response.Body as Readable | undefined)?.destroy()
    throw new Error('Objeto ausente ou acima do limite permitido.')
  }
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of response.Body as Readable) {
      const bytes = Buffer.from(chunk)
      size += bytes.length
      if (size > maximum) throw new Error('Objeto excedeu o limite de leitura.')
      chunks.push(bytes)
    }
    if (size !== response.ContentLength) throw new Error('Objeto incompleto.')
    return Buffer.concat(chunks)
  } finally {
    ;(response.Body as Readable).destroy()
  }
}

export async function objectHash(storage: S3Client, bucket: string, key: string) {
  const response = await storage.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  if (!response.Body || !response.ContentLength || response.ContentLength > MAX_BACKUP_BYTES) {
    ;(response.Body as Readable | undefined)?.destroy()
    throw new Error('Objeto invalido para conferencia.')
  }
  const digest = createHash('sha256')
  let size = 0
  try {
    for await (const chunk of response.Body as Readable) {
      size += chunk.length
      if (size > MAX_BACKUP_BYTES) throw new Error('Objeto excedeu o limite de conferencia.')
      digest.update(chunk)
    }
    if (size !== response.ContentLength) throw new Error('Objeto incompleto.')
    return { sha256: digest.digest('hex'), bytes: size }
  } finally {
    ;(response.Body as Readable).destroy()
  }
}

export async function copyEncryptedObject(source: S3Client, sourceBucket: string, sourceKey: string, target: S3Client, targetBucket: string, targetKey: string) {
  const response = await source.send(new GetObjectCommand({ Bucket: sourceBucket, Key: sourceKey }))
  if (!response.Body || !response.ContentLength || response.ContentLength < 4 || response.ContentLength > MAX_BACKUP_BYTES) {
    ;(response.Body as Readable | undefined)?.destroy()
    throw new Error('Objeto de origem ausente ou acima do limite.')
  }
  const digest = createHash('sha256')
  let size = 0
  let prefix = Buffer.alloc(0)
  const transform = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length
      if (size > MAX_BACKUP_BYTES) { done(new Error('Objeto excedeu o limite de copia.')); return }
      digest.update(chunk)
      if (prefix.length < 4) {
        const initial = Buffer.concat([prefix, chunk])
        if (initial.length < 4) { prefix = initial; done(); return }
        prefix = initial.subarray(0, 4)
        if (!['la1:', 'la2:'].includes(prefix.toString())) { done(new Error('Objeto de origem nao esta cifrado.')); return }
        done(null, initial)
        return
      }
      done(null, chunk)
    },
  })
  const controller = new AbortController()
  const transfer = pipeline(response.Body as Readable, transform)
  const upload = target.send(new PutObjectCommand({
    Bucket: targetBucket, Key: targetKey, Body: transform, ContentLength: response.ContentLength,
    ContentType: 'application/octet-stream', CacheControl: 'private, no-store',
  }), { abortSignal: controller.signal })
  try {
    await Promise.all([transfer, upload])
    if (size !== response.ContentLength || !['la1:', 'la2:'].includes(prefix.toString())) throw new Error('Objeto de origem nao e um envelope privado completo.')
    const expected = { bytes: size, sha256: digest.digest('hex') }
    const saved = await objectHash(target, targetBucket, targetKey)
    if (saved.sha256 !== expected.sha256 || saved.bytes !== expected.bytes) throw new Error('Copia de objeto diverge da origem.')
    return expected
  } catch {
    controller.abort()
    ;(response.Body as Readable).destroy()
    transform.destroy()
    await Promise.allSettled([transfer, upload])
    throw new Error('Copia cifrada ou conferencia de objeto falhou.')
  }
}
