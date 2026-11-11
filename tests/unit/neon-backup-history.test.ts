import { randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3'
import { describe, expect, it, vi } from 'vitest'
import { publishBackupValidation } from '../../scripts/banco/neon-backup-validation.js'
import { checkValidatedBackup } from '../../scripts/banco/neon-backup-check.js'
import { encodeValidation, validationKey, type BackupValidation } from '../../scripts/banco/neon-backup-shared.js'

const now = new Date('2026-10-30T10:00:00.000Z')
const key = randomBytes(32)
const old: BackupValidation = { version: 1, backupKey: 'neon/2026-10-27/' + 'a'.repeat(32) + '.lan', archiveSha256: 'b'.repeat(64), archiveBytes: 100, createdAt: '2026-10-27T10:00:00.000Z', validatedAt: now.toISOString(), tables: 37, objects: 0, elapsedSeconds: 3 }

function storage(records: BackupValidation[] = []) {
  const markers = new Map(records.map((record) => [validationKey(record.backupKey), encodeValidation(record, key)]))
  const send = vi.fn(async (command: HeadObjectCommand | PutObjectCommand | ListObjectsV2Command | GetObjectCommand | DeleteObjectCommand) => {
    if (command instanceof HeadObjectCommand) return { ContentLength: 100, Metadata: { sha256: 'b'.repeat(64) } }
    if (command instanceof PutObjectCommand) { markers.set(command.input.Key!, Buffer.from(command.input.Body as Buffer)); return {} }
    if (command instanceof ListObjectsV2Command) return { Contents: [...markers.keys()].map((Key) => ({ Key, LastModified: now })) }
    if (command instanceof GetObjectCommand) {
      const marker = markers.get(command.input.Key!)!
      return { ContentLength: marker.length, Body: Readable.from([marker]) }
    }
    throw new Error('Historico nao deve iniciar limpeza.')
  })
  return { client: { send } as unknown as S3Client, send, markers }
}

describe('recuperacao historica sem mascarar a atualidade', () => {
  it.each([3, 7])('conclui validacao de snapshot de %i dias sem limpar copias', async (days) => {
    const createdAt = new Date(now.getTime() - days * 86400000).toISOString()
    const record = { ...old, createdAt, backupKey: `neon/${createdAt.slice(0, 10)}/${'a'.repeat(32)}.lan` }
    const target = storage()
    await expect(publishBackupValidation(target.client, 'backup', key, record, now)).resolves.toEqual({ historical: true, expiredRemoved: 0 })
    expect(target.markers.has(validationKey(record.backupKey))).toBe(true)
    expect(target.send).toHaveBeenCalledTimes(2)
    await expect(checkValidatedBackup(target.client, 'backup', key, now)).rejects.toThrow('atrasado')
  })

  it('revalidar historico nao mascara nem substitui um snapshot recente', async () => {
    const fresh = { ...old, backupKey: 'neon/2026-10-30/' + 'c'.repeat(32) + '.lan', createdAt: '2026-10-30T09:00:00.000Z' }
    const target = storage([fresh])
    await publishBackupValidation(target.client, 'backup', key, old, now)
    expect(await checkValidatedBackup(target.client, 'backup', key, now)).toEqual(fresh)
    expect(target.markers.size).toBe(2)
  })

  it.each([
    { ...old, createdAt: '2026-10-31T10:00:00.000Z' },
    { ...old, validatedAt: '2026-10-31T10:00:00.000Z' },
    { ...old, validatedAt: '2026-10-26T10:00:00.000Z' },
    { ...old, backupKey: 'neon/2026-10-26/' + 'a'.repeat(32) + '.lan' },
  ])('recusa cronologia invalida antes de acessar armazenamento', async (record) => {
    const target = storage()
    await expect(publishBackupValidation(target.client, 'backup', key, record, now)).rejects.toThrow()
    expect(target.send).not.toHaveBeenCalled()
  })

  it('recusa objeto historico alterado antes de publicar seu marcador', async () => {
    const send = vi.fn(async () => ({ ContentLength: 101, Metadata: { sha256: old.archiveSha256 } }))
    await expect(publishBackupValidation({ send } as unknown as S3Client, 'backup', key, old, now)).rejects.toThrow('alterado')
    expect(send).toHaveBeenCalledOnce()
  })
})
