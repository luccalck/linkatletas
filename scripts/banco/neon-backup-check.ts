import { pathToFileURL } from 'node:url'
import { S3Client, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { assertFreshValidation, backupKey, backupStorage, decodeValidation, required, validationKey, type BackupValidation } from './neon-backup-shared.js'
import { readObject } from './neon-backup-objects.js'

type CheckStage = 'configuration' | 'list_markers' | 'read_marker' | 'verify_marker' | 'find_marker' | 'check_freshness' | 'head_archive' | 'verify_archive'

function reportStage(stage: CheckStage, error: unknown) {
  const status = (error as { $metadata?: { httpStatusCode?: unknown } } | null)?.$metadata?.httpStatusCode
  console.error(JSON.stringify({ healthy: false, stage, httpStatus: Number.isInteger(status) ? status : undefined }))
}

export async function checkValidatedBackup(storage: S3Client, bucket: string, key: Buffer, now = new Date(), stage?: (value: CheckStage) => void) {
  let continuation: string | undefined
  const markers: string[] = []
  stage?.('list_markers')
  do {
    const page = await storage.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'neon/validated/', ContinuationToken: continuation }))
    for (const object of page.Contents || []) {
      if (!object.Key || !/^neon\/validated\/[a-f0-9]{32}\.lav$/.test(object.Key) || !object.LastModified) continue
      markers.push(object.Key)
    }
    continuation = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (continuation)
  let newest: BackupValidation | undefined
  for (const marker of markers) {
    stage?.('read_marker')
    const bytes = await readObject(storage, bucket, marker, 4096)
    stage?.('verify_marker')
    const candidate = decodeValidation(bytes, key)
    if (validationKey(candidate.backupKey) !== marker) throw new Error('Marcador nao corresponde ao backup.')
    if (!newest || Date.parse(candidate.createdAt) > Date.parse(newest.createdAt)) newest = candidate
  }
  stage?.('find_marker')
  if (!newest) throw new Error('Nenhum backup com restauracao completa validada foi encontrado.')
  stage?.('check_freshness')
  const result = assertFreshValidation(newest, now)
  stage?.('head_archive')
  const head = await storage.send(new HeadObjectCommand({ Bucket: bucket, Key: result.backupKey }))
  stage?.('verify_archive')
  if (head.ContentLength !== result.archiveBytes || head.Metadata?.sha256 !== result.archiveSha256) throw new Error('Arquivo validado foi removido ou alterado.')
  return result
}

export async function checkNeonBackup(stage?: (value: CheckStage) => void) {
  const storage = backupStorage()
  try {
    const result = await checkValidatedBackup(storage.client, storage.bucket, backupKey(required('NEON_BACKUP_VALIDATION_KEY')), new Date(), stage)
    console.log(JSON.stringify({ healthy: true, freshnessOnly: true, createdAt: result.createdAt, validatedAt: result.validatedAt, tables: result.tables, objects: result.objects, restoreSeconds: result.elapsedSeconds, maximumAgeHours: 26 }))
    return result
  } finally {
    storage.client.destroy()
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  let stage: CheckStage = 'configuration'
  checkNeonBackup((value) => { stage = value }).catch((error) => {
    reportStage(stage, error)
    process.exitCode = 1
  })
}
