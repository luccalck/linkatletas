import { fail } from './errors.js'

export function rejectNullBytes(...values: unknown[]) {
  const pending = [...values]
  while (pending.length) {
    const value = pending.pop()
    if (typeof value === 'string' && value.includes('\u0000'))
      fail(400, 'INVALID_TEXT', 'Texto contem um caractere nao permitido.')
    if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
      for (const [key, entry] of Object.entries(value)) {
        if (key.includes('\u0000')) fail(400, 'INVALID_TEXT', 'Campo contem um caractere nao permitido.')
        pending.push(entry)
      }
    }
  }
}
