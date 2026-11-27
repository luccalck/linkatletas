import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function dataKey(): Buffer {
  const configured = process.env.DATA_ENCRYPTION_KEY
  if (configured) {
    const key = Buffer.from(configured, 'base64')
    if (key.length !== 32)
      throw new Error('DATA_ENCRYPTION_KEY exige 32 bytes em base64.')
    return key
  }
  if (process.env.NODE_ENV === 'production')
    throw new Error('Produção exige DATA_ENCRYPTION_KEY.')
  const file = resolve(process.env.DATA_KEY_FILE || '.data-key.local')
  if (!existsSync(file)) {
    try {
      writeFileSync(file, randomBytes(32).toString('base64'), {
        flag: 'wx',
        mode: 0o600,
      })
    } catch (error) {
      if (!existsSync(file)) throw error
    }
  }
  const key = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64')
  if (key.length !== 32)
    throw new Error(
      'Chave local inválida. Preserve a chave dos dados existentes.',
    )
  return key
}
export function encryptPrivate(value: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', dataKey(), iv)
  const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return `la1:${Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64')}`
}
export function decryptPrivate(value: string): string {
  if (!value.startsWith('la1:'))
    throw new Error('Envelope de criptografia inválido.')
  const bytes = Buffer.from(value.slice(4), 'base64')
  const decipher = createDecipheriv(
    'aes-256-gcm',
    dataKey(),
    bytes.subarray(0, 12),
  )
  decipher.setAuthTag(bytes.subarray(12, 28))
  return Buffer.concat([
    decipher.update(bytes.subarray(28)),
    decipher.final(),
  ]).toString('utf8')
}
