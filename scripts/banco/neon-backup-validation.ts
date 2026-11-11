import { S3Client, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3'
import { assertValidationTimeline, encodeValidation, validationKey, type BackupValidation } from './neon-backup-shared.js'
import { checkValidatedBackup } from './neon-backup-check.js'

export async function publishBackupValidation(storage: S3Client, bucket: string, key: Buffer, result: BackupValidation, now = new Date()) {
  assertValidationTimeline(result, now)
  const historical = now.getTime() - Date.parse(result.createdAt) > 26 * 3600000
  const head = await storage.send(new HeadObjectCommand({ Bucket: bucket, Key: result.backupKey }))
  if (head.ContentLength !== result.archiveBytes || head.Metadata?.sha256 !== result.archiveSha256) throw new Error('Arquivo foi alterado antes da publicacao da validacao.')
  await storage.send(new PutObjectCommand({ Bucket: bucket, Key: validationKey(result.backupKey), Body: encodeValidation(result, key), ContentType: 'application/octet-stream', CacheControl: 'private, no-store' }))
  if (historical) return { historical: true, expiredRemoved: 0 }
  await checkValidatedBackup(storage, bucket, key, now)
  let continuation: string | undefined
  const cutoff = now.getTime() - 7 * 86400000
  let removed = 0
  do {
    const page = await storage.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'neon/', ContinuationToken: continuation }))
    for (const object of page.Contents || []) {
      const owned = object.Key && /^neon\/(?:\d{4}-\d{2}-\d{2}\/[a-f0-9]{32}(?:\.lan|\/objects\/[a-f0-9]{64})|validated\/[a-f0-9]{32}\.lav)$/.test(object.Key)
      if (owned && object.LastModified && object.LastModified.getTime() < cutoff) {
        await storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }))
        removed++
      }
    }
    continuation = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (continuation)
  return { historical: false, expiredRemoved: removed }
}
