import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3'
import { dataKey, decryptPrivate } from '../../shared/crypto.js'

export const mediaBlockSize = 256 * 1024
const prefix = Buffer.from('la2:')
const overhead = 28

export function mediaObjectKey(id: string) {
  return `private/v2/${id}`
}

function objectCipherKey(key: string) {
  return createHmac('sha256', dataKey()).update('linkatletas/media/v2/').update(key).digest()
}

function blockContext(index: number, size: number) {
  const context = Buffer.alloc(8)
  context.writeUInt32BE(index)
  context.writeUInt32BE(size, 4)
  return context
}

export function encryptMedia(bytes: Buffer, key: string) {
  const cipherKey = objectCipherKey(key)
  const encoded = Buffer.allocUnsafe(prefix.length + bytes.length + Math.ceil(bytes.length / mediaBlockSize) * overhead)
  prefix.copy(encoded)
  let cursor = prefix.length
  for (let offset = 0; offset < bytes.length; offset += mediaBlockSize) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', cipherKey, iv)
    cipher.setAAD(blockContext(offset / mediaBlockSize, bytes.length))
    const body = cipher.update(bytes.subarray(offset, offset + mediaBlockSize))
    cipher.final()
    iv.copy(encoded, cursor)
    cipher.getAuthTag().copy(encoded, cursor + 12)
    body.copy(encoded, cursor + overhead)
    cursor += overhead + body.length
  }
  return encoded
}

export function parseMediaRange(value: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || (!match[1] && !match[2])) return null
  const suffix = !match[1]
  const last = match[2] ? Number(match[2]) : size - 1
  const start = suffix ? Math.max(0, size - last) : Number(match[1])
  const end = suffix ? size - 1 : Math.min(last, size - 1)
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(last) || start >= size || start > end) return null
  return { start, end }
}

export async function readMedia(storage: S3Client, bucket: string, key: string, size: number, start: number, end: number) {
  if (!key.startsWith('private/v2/')) {
    const result = await storage.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    if (!result.Body) throw new Error('Arquivo sem conteudo.')
    const bytes = Buffer.from(decryptPrivate(await result.Body.transformToString()), 'base64')
    if (bytes.length !== size) throw new Error('Tamanho do arquivo diverge dos metadados.')
    return bytes.subarray(start, end + 1)
  }

  const first = Math.floor(start / mediaBlockSize)
  const last = Math.floor(end / mediaBlockSize)
  const requestStart = first === 0 ? 0 : prefix.length + first * (mediaBlockSize + overhead)
  const requestEnd = prefix.length + (last + 1) * overhead + Math.min(size, (last + 1) * mediaBlockSize) - 1
  const objectSize = prefix.length + Math.ceil(size / mediaBlockSize) * overhead + size
  const result = await storage.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=${requestStart}-${requestEnd}` }))
  const contentRange = `bytes ${requestStart}-${requestEnd}/${objectSize}`
  const expectedBytes = requestEnd - requestStart + 1
  if (!result.Body) throw new Error('Arquivo sem conteudo.')
  if (result.ContentRange !== contentRange || result.ContentLength !== expectedBytes) {
    if ('destroy' in result.Body && typeof result.Body.destroy === 'function') result.Body.destroy()
    throw new Error('Intervalo de armazenamento inesperado.')
  }
  const encoded = await result.Body.transformToByteArray()
  const bytes = Buffer.from(encoded.buffer, encoded.byteOffset, encoded.byteLength)
  if (bytes.length !== expectedBytes || (first === 0 && !bytes.subarray(0, prefix.length).equals(prefix)))
    throw new Error('Envelope de midia incompleto.')

  const plain = Buffer.allocUnsafe(end - start + 1)
  const cipherKey = objectCipherKey(key)
  let cursor = first === 0 ? prefix.length : 0
  for (let index = first; index <= last; index++) {
    const offset = index * mediaBlockSize
    const length = Math.min(mediaBlockSize, size - offset)
    const iv = bytes.subarray(cursor, cursor + 12)
    const decipher = createDecipheriv('aes-256-gcm', cipherKey, iv)
    decipher.setAAD(blockContext(index, size))
    decipher.setAuthTag(bytes.subarray(cursor + 12, cursor + overhead))
    const block = decipher.update(bytes.subarray(cursor + overhead, cursor + overhead + length))
    decipher.final()
    block.copy(plain, Math.max(0, offset - start), Math.max(0, start - offset), Math.min(length, end - offset + 1))
    cursor += overhead + length
  }
  return plain
}
