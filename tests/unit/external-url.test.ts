import { describe, expect, it } from 'vitest'
import { externalUrlSchema } from '../../server/shared/external-url.js'

describe('referencias externas recebidas pela API', () => {
  it.each([
    'https://example.com/video?v=1&time=2',
    'https://meet.google.com/abc-defg-hij',
  ])('preserva uma referencia HTTPS publica: %s', (value) => {
    expect(externalUrlSchema.parse(value)).toBe(value)
  })

  it.each([
    'javascript:alert(1)', 'data:text/html,hello', 'file:///etc/passwd',
    'https://user:password@example.com/', 'https://example.com/\nvideo',
    'https://example.com/" onload="test', 'https://localhost/',
    'https://127.0.0.1/', 'https://2130706433/', 'https://10.0.0.1/',
    'https://172.16.0.1/', 'https://192.168.1.1/', 'https://169.254.169.254/',
    'https://[::1]/', 'https://[::ffff:127.0.0.1]/', 'https://internal.local/',
    'https://example.com:8443/',
  ])('recusa esquema, credenciais, controles ou destino local: %s', (value) => {
    expect(externalUrlSchema.safeParse(value).success).toBe(false)
  })
})
