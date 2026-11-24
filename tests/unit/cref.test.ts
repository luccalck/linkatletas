import { describe, expect, it } from 'vitest'
import { CREF_UFS, parseCref } from '../../shared/cref.js'

describe('formato do CREF profissional', () => {
  it('normaliza UFs, categorias G/P e registros secundários', () => {
    for (const uf of CREF_UFS) for (const category of ['G', 'P']) for (const suffix of ['', '-S']) {
      expect(parseCref(`CREF 123-${category.toLowerCase()}/${uf.toLowerCase()}${suffix}`))
        .toBe(`000123-${category}/${uf}${suffix}`)
    }
  })
  it.each(['123-G', '123-PJ/SP', '123-G/XX', '1234567-G/SP', '', '123/SP'])('rejeita formato inválido: %s', value => {
    expect(() => parseCref(value)).toThrow()
  })
})
