import { randomBytes } from 'node:crypto'
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { encryptMedia, mediaBlockSize, mediaObjectKey, parseMediaRange, readMedia } from '../../server/modules/media/object-format.js'
import { encryptPrivate } from '../../server/shared/crypto.js'

beforeEach(() => vi.stubEnv('DATA_ENCRYPTION_KEY', randomBytes(32).toString('base64')))
afterEach(() => vi.unstubAllEnvs())

function storage(object: Buffer) {
  const send = vi.fn(async (command: GetObjectCommand) => {
    const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(command.input.Range ?? '') ?? []
    const slice = from === undefined ? object : object.subarray(Number(from), Number(to) + 1)
    return {
      ContentRange: from === undefined ? undefined : `bytes ${from}-${to}/${object.length}`,
      ContentLength: slice.length,
      Body: { transformToByteArray: async () => slice, transformToString: async () => slice.toString() },
    }
  })
  return { send, client: { send } as unknown as S3Client }
}

it('fetches just the authenticated blocks containing a cross-block range', async () => {
  const plain = randomBytes(mediaBlockSize * 5 + 17)
  const key = mediaObjectKey('test')
  const target = storage(encryptMedia(plain, key))
  const start = mediaBlockSize * 2 - 3
  const end = mediaBlockSize * 2 + 4
  expect(await readMedia(target.client, 'private', key, plain.length, start, end)).toEqual(plain.subarray(start, end + 1))
  expect(target.send).toHaveBeenCalledOnce()
  expect(target.send.mock.calls[0][0].input.Range).toBe(`bytes=${4 + mediaBlockSize + 28}-${4 + (mediaBlockSize + 28) * 3 - 1}`)
  expect(await readMedia(target.client, 'private', key, plain.length, plain.length - 8, plain.length - 1)).toEqual(plain.subarray(-8))
})

it('rejects corrupt ciphertext and a chunk read under another object identity', async () => {
  const plain = randomBytes(mediaBlockSize + 5)
  const key = mediaObjectKey('original')
  const object = encryptMedia(plain, key)
  await expect(readMedia(storage(object).client, 'private', mediaObjectKey('other'), plain.length, 0, 4)).rejects.toThrow()
  object[object.length - 1] ^= 1
  await expect(readMedia(storage(object).client, 'private', key, plain.length, mediaBlockSize, plain.length - 1)).rejects.toThrow()
})

it('preserves reads of existing envelopes and validates HTTP ranges', async () => {
  const plain = Buffer.from('historic content')
  const target = storage(Buffer.from(encryptPrivate(plain.toString('base64'))))
  expect(await readMedia(target.client, 'private', 'private/original', plain.length, 2, 6)).toEqual(plain.subarray(2, 7))
  expect(target.send.mock.calls[0][0].input.Range).toBeUndefined()
  expect(parseMediaRange('bytes=-3', 12)).toEqual({ start: 9, end: 11 })
  expect(parseMediaRange('bytes=4-', 12)).toEqual({ start: 4, end: 11 })
  expect(parseMediaRange('bytes=4-99', 12)).toEqual({ start: 4, end: 11 })
  for (const range of ['bytes=-0', 'bytes=12-', 'bytes=3-2', 'bytes=1-2,6-7', 'bytes=-99999999999999999']) {
    expect(parseMediaRange(range, 12)).toBeNull()
  }
})
