export const CREF_UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ')

export function parseCref(value: string) {
  const match = /^(?:CREF\s+)?(\d{1,6})\s*-?\s*([GP])\s*\/\s*([A-Z]{2})(\s*-\s*S)?$/i.exec(value.trim())
  if (!match || !CREF_UFS.includes(match[3].toUpperCase()))
    throw new Error('Informe o CREF profissional com UF, por exemplo 123456-G/SP ou 123456-P/RJ-S.')
  return `${match[1].padStart(6, '0')}-${match[2].toUpperCase()}/${match[3].toUpperCase()}${match[4] ? '-S' : ''}`
}
