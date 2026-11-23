import { describe, expect, it } from 'vitest'
import { rejectNullBytes } from '../../server/shared/input-guard.js'

describe('fronteira de texto PostgreSQL', () => {
  it.each(['text\u0000', { field: ['value\u0000'] }, { ['key\u0000']: 'value' }])('recusa byte nulo em valores ou chaves', (value) => {
    expect(() => rejectNullBytes(value)).toThrow('caractere nao permitido')
  })
  it('preserva texto como dado e ignora conteudo binario', () => {
    expect(() => rejectNullBytes({ text: "';DROP TABLE users;--", lines: 'linha\nseguinte' }, Buffer.from([0, 1, 2]))).not.toThrow()
  })
  it('percorre estruturas profundas sem recursao', () => {
    let value: unknown = 'ok'
    for (let i = 0; i < 10000; i++) value = [value]
    expect(() => rejectNullBytes(value)).not.toThrow()
  })
})
