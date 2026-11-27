import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CreateBucketCommand, DeleteBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { decryptPrivate, encryptPrivate } from '../../server/shared/crypto.js'
import { copyEncryptedObject, readObject } from '../../scripts/banco/neon-backup-objects.js'
import { encryptMedia, mediaBlockSize, mediaObjectKey, readMedia } from '../../server/modules/media/object-format.js'

const endpoint = new URL(process.env.S3_ENDPOINT || 'http://127.0.0.1:8333')
if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
  throw new Error('Teste de recuperacao exige S3 local isolado; nenhum armazenamento remoto e permitido.')
}
const storage = new S3Client({
  endpoint: endpoint.toString(), region: 'us-east-1', forcePathStyle: true,
  credentials: { accessKeyId: 'linkatletas-local', secretAccessKey: 'local-only-change-in-production' },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  maxAttempts: 1,
  requestHandler: { connectionTimeout: 3000, requestTimeout: 10000 },
})
const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
const sourceBucket = `linkatletas-backup-it-${suffix}-source`
const backupBucket = `linkatletas-backup-it-${suffix}-backup`
const restoreBucket = `linkatletas-backup-it-${suffix}-restore`
const createdBuckets: string[] = []
const privateKey = randomBytes(32).toString('base64')

async function uploadFixture() {
  const key = 'private/' + randomUUID()
  const bytes = Buffer.concat([Buffer.from('arquivo ficticio de recuperacao\n'), randomBytes(128 * 1024)])
  const encrypted = Buffer.from(encryptPrivate(bytes.toString('base64')))
  await storage.send(new PutObjectCommand({ Bucket: sourceBucket, Key: key, Body: encrypted, ContentType: 'application/octet-stream' }))
  return { key, bytes, encrypted }
}

function corrupt(bytes: Buffer) {
  const result = Buffer.from(bytes)
  const position = result.length - 8
  result[position] = result[position] === 65 ? 66 : 65
  return result
}

beforeAll(async () => {
  for (const bucket of [sourceBucket, backupBucket, restoreBucket]) {
    await storage.send(new CreateBucketCommand({ Bucket: bucket }))
    createdBuckets.push(bucket)
  }
})

beforeEach(() => vi.stubEnv('DATA_ENCRYPTION_KEY', privateKey))
afterEach(() => vi.unstubAllEnvs())

afterAll(async () => {
  try {
    for (const bucket of createdBuckets) {
      if (!bucket.startsWith(`linkatletas-backup-it-${suffix}-`)) throw new Error('Limpeza fora do escopo isolado recusada.')
      let continuation: string | undefined
      do {
        const page = await storage.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuation }))
        for (const object of page.Contents || []) {
          if (object.Key) await storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }))
        }
        continuation = page.IsTruncated ? page.NextContinuationToken : undefined
      } while (continuation)
      await storage.send(new DeleteBucketCommand({ Bucket: bucket }))
    }
  } finally {
    storage.destroy()
  }
})

describe('recuperacao independente de objetos em S3 real isolado', () => {
  it('restaura e descriptografa somente pela copia depois de apagar a origem', async () => {
    const fixture = await uploadFixture()
    const backupKey = 'snapshot/' + randomUUID()
    const expected = { bytes: fixture.encrypted.length, sha256: createHash('sha256').update(fixture.encrypted).digest('hex') }
    const copied = await copyEncryptedObject(storage, sourceBucket, fixture.key, storage, backupBucket, backupKey)
    expect(copied).toEqual(expected)
    const head = await storage.send(new HeadObjectCommand({ Bucket: backupBucket, Key: backupKey }))
    expect(head.ContentLength).toBe(expected.bytes)
    expect(head.ContentType).toBe('application/octet-stream')
    expect(head.CacheControl).toBe('private, no-store')
    const saved = await readObject(storage, backupBucket, backupKey)
    expect(saved).toEqual(fixture.encrypted)
    expect(saved.includes(fixture.bytes)).toBe(false)
    await storage.send(new DeleteObjectCommand({ Bucket: sourceBucket, Key: fixture.key }))
    await expect(storage.send(new HeadObjectCommand({ Bucket: sourceBucket, Key: fixture.key }))).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } })
    expect(await copyEncryptedObject(storage, backupBucket, backupKey, storage, restoreBucket, fixture.key)).toEqual(expected)
    const restored = await readObject(storage, restoreBucket, fixture.key)
    expect(Buffer.from(decryptPrivate(restored.toString('utf8')), 'base64')).toEqual(fixture.bytes)
  })

  it('restores authenticated blocks and serves partial content after backup', async () => {
    const bytes = randomBytes(mediaBlockSize * 2 + 7)
    const key = mediaObjectKey(randomUUID())
    const backupKey = 'snapshot/' + randomUUID()
    await storage.send(new PutObjectCommand({ Bucket: sourceBucket, Key: key, Body: encryptMedia(bytes, key) }))
    await copyEncryptedObject(storage, sourceBucket, key, storage, backupBucket, backupKey)
    await copyEncryptedObject(storage, backupBucket, backupKey, storage, restoreBucket, key)
    expect(await readMedia(storage, restoreBucket, key, bytes.length, mediaBlockSize - 4, mediaBlockSize + 3)).toEqual(bytes.subarray(mediaBlockSize - 4, mediaBlockSize + 4))
  })

  it('recusa arquivo referenciado ausente sem criar uma copia valida', async () => {
    const key = 'private/missing-' + randomUUID()
    await expect(copyEncryptedObject(storage, sourceBucket, key, storage, backupBucket, key)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } })
    await expect(storage.send(new HeadObjectCommand({ Bucket: backupBucket, Key: key }))).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } })
  })

  it('detecta alteracao persistida pelo destino antes da releitura de conferencia', async () => {
    const fixture = await uploadFixture()
    const backupKey = 'corrupted/' + randomUUID()
    const tamperingTarget = {
      async send(command: GetObjectCommand | PutObjectCommand) {
        if (command instanceof PutObjectCommand) {
          const result = await storage.send(command)
          const bytes = await readObject(storage, backupBucket, backupKey)
          await storage.send(new PutObjectCommand({ Bucket: backupBucket, Key: backupKey, Body: corrupt(bytes) }))
          return result
        }
        return storage.send(command)
      },
    } as unknown as S3Client
    await expect(copyEncryptedObject(storage, sourceBucket, fixture.key, tamperingTarget, backupBucket, backupKey)).rejects.toThrow('Copia cifrada ou conferencia de objeto falhou.')
  })

  it('rejeita adulteracao do envelope GCM e chave incorreta depois da leitura HTTP', async () => {
    const fixture = await uploadFixture()
    const backupKey = 'gcm/' + randomUUID()
    await copyEncryptedObject(storage, sourceBucket, fixture.key, storage, backupBucket, backupKey)
    const valid = await readObject(storage, backupBucket, backupKey)
    vi.stubEnv('DATA_ENCRYPTION_KEY', randomBytes(32).toString('base64'))
    expect(() => decryptPrivate(valid.toString('utf8'))).toThrow()
    vi.stubEnv('DATA_ENCRYPTION_KEY', privateKey)
    await storage.send(new PutObjectCommand({ Bucket: backupBucket, Key: backupKey, Body: corrupt(valid) }))
    const changed = await readObject(storage, backupBucket, backupKey)
    expect(createHash('sha256').update(changed).digest('hex')).not.toBe(createHash('sha256').update(valid).digest('hex'))
    expect(() => decryptPrivate(changed.toString('utf8'))).toThrow()
  })

  it('recusa objeto sem envelope privado antes de transmitir seu conteudo', async () => {
    const key = 'plaintext/' + randomUUID()
    await storage.send(new PutObjectCommand({ Bucket: sourceBucket, Key: key, Body: 'conteudo ficticio sem criptografia' }))
    await expect(copyEncryptedObject(storage, sourceBucket, key, storage, backupBucket, key)).rejects.toThrow('Copia cifrada ou conferencia de objeto falhou.')
    const candidate = await storage.send(new GetObjectCommand({ Bucket: backupBucket, Key: key })).catch(error => {
      expect(error.$metadata?.httpStatusCode).toBe(404)
      return undefined
    })
    if (candidate?.Body) {
      const value = Buffer.from(await candidate.Body.transformToByteArray())
      expect(value.includes(Buffer.from('conteudo ficticio sem criptografia'))).toBe(false)
    }
  })
})
