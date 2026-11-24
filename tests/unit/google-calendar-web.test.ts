import { afterEach, expect, it, vi } from 'vitest'

const input = {
  athleteId: 0,
  athleteName: 'Atleta de teste',
  athleteEmail: '',
  purpose: 'Consultoria de teste',
  description: 'Dados ficticios.',
  date: '2026-12-20',
  startTime: '10:00',
  duration: 30,
}
const event = {
  id: 'evento-ficticio',
  hangoutLink: 'https://meet.google.com/abc-defg-hij',
  htmlLink: 'https://calendar.google.com/calendar/event?eid=ficticio',
}

function identity(denied = false) {
  const init = vi.fn(
    (options: {
      callback: (response: { access_token?: string; error?: string }) => void
    }) => ({
      requestAccessToken: () =>
        options.callback(
          denied
            ? { error: 'access_denied' }
            : { access_token: 'token-ficticio' },
        ),
    }),
  )
  vi.stubEnv(
    'VITE_GOOGLE_CLIENT_ID',
    'cliente-ficticio.apps.googleusercontent.com',
  )
  vi.stubGlobal('window', {
    setInterval,
    clearInterval,
    setTimeout,
    google: { accounts: { oauth2: { initTokenClient: init } } },
  })
  return init
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

it('nao oferece integracao sem cliente configurado', async () => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '')
  const calendar = await import('../../src/services/googleCalendar.js')
  expect(calendar.googleCalendarConfigured).toBe(false)
  await expect(calendar.createGoogleMeetEvent(input)).rejects.toThrow(
    'VITE_GOOGLE_CLIENT_ID',
  )
})

it('cria referencia Meet com horario e duracao sem convidar atleta sem email', async () => {
  const init = identity()
  const fetch = vi.fn(
    async () => new Response(JSON.stringify(event), { status: 200 }),
  )
  vi.stubGlobal('fetch', fetch)
  const calendar = await import('../../src/services/googleCalendar.js')
  expect(await calendar.createGoogleMeetEvent(input)).toMatchObject({
    googleEventId: event.id,
    meetLink: event.hangoutLink,
  })
  expect(init).toHaveBeenCalledTimes(1)
  const call = fetch.mock.calls[0] as unknown as [string, RequestInit]
  expect(call[0]).toContain('/calendar/v3/calendars/primary/events?')
  const body = JSON.parse(String(call[1].body))
  expect(body.start.dateTime).toBe('2026-12-20T10:00:00')
  expect(body.end.dateTime).toBe('2026-12-20T10:30:00')
  expect(body.attendees).toEqual([])
  expect(call[1].method).toBe('POST')
})

it('nao cria evento quando o titular recusa a autorizacao', async () => {
  identity(true)
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const calendar = await import('../../src/services/googleCalendar.js')
  await expect(calendar.createGoogleMeetEvent(input)).rejects.toThrow()
  expect(fetch).not.toHaveBeenCalled()
})

it('solicita autorizacao novamente depois de resposta de sessao expirada', async () => {
  const init = identity()
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Sessao expirada.' } }), {
        status: 401,
      }),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify(event)))
  vi.stubGlobal('fetch', fetch)
  const calendar = await import('../../src/services/googleCalendar.js')
  await expect(calendar.createGoogleMeetEvent(input)).rejects.toThrow(
    'Sessao expirada.',
  )
  await expect(calendar.createGoogleMeetEvent(input)).resolves.toMatchObject({
    googleEventId: event.id,
  })
  expect(init).toHaveBeenCalledTimes(2)
})
