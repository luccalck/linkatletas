import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('compatibilidade do servidor com o carregador da nuvem', () => {
  it('carrega arquivos estaticos sem depender de require ESM experimental', () => {
    const result = spawnSync(process.execPath, ['--no-experimental-require-module', '-e', "require('@fastify/static')"], { encoding: 'utf8', timeout: 10000, windowsHide: true })
    expect(result.status, result.stderr).toBe(0)
  })
})
