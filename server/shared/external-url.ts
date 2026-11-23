import { isIP } from 'node:net'
import { z } from 'zod'

export const externalUrlSchema = z.string().max(2000).url().refine((value) => {
  if (/[\u0000-\u0020\u007f<>"\\]/.test(value)) return false
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase().replace(/\.$/, '')
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
    if (isIP(host) || host.startsWith('[') || !host.includes('.')) return false
    return !['localhost', 'local', 'internal', 'home', 'lan'].some((suffix) => host === suffix || host.endsWith('.' + suffix))
  } catch {
    return false
  }
}, 'Use uma referencia HTTPS publica sem credenciais ou porta alternativa.')
