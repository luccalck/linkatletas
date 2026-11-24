import type { Consultation } from './googleCalendar.types.js'

interface TokenResponse { access_token?: string; error?: string; error_description?: string }

interface TokenClient { requestAccessToken: (options?: { prompt?: string }) => void }

interface GoogleOAuth {
  accounts: { oauth2: { initTokenClient: (config: { client_id: string; scope: string; callback: (response: TokenResponse) => void; error_callback?: (error: unknown) => void }) => TokenClient } }
}

declare global { interface Window { google?: GoogleOAuth } }

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events'

let accessToken = ''

export const googleCalendarConfigured = Boolean(CLIENT_ID)

export const googleCalendarConnected = () => Boolean(accessToken)

function waitForGoogleIdentity(): Promise<GoogleOAuth> {
  return new Promise((resolve, reject) => {
    let attempts = 0
    const timer = window.setInterval(() => {
      attempts += 1
      if (window.google?.accounts?.oauth2) {
        window.clearInterval(timer)
        resolve(window.google)
      } else if (attempts > 50) {
        window.clearInterval(timer)
        reject(new Error('Não foi possível carregar o Google Identity Services.'))
      }
    }, 100)
  })
}

export async function connectGoogleCalendar() {
  if (!CLIENT_ID) throw new Error('Adicione VITE_GOOGLE_CLIENT_ID ao arquivo .env para conectar o Google Agenda.')
  const google = await waitForGoogleIdentity()
  return new Promise<void>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: CALENDAR_SCOPE,
      callback: response => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description || 'A autorização do Google não foi concluída.'))
          return
        }
        accessToken = response.access_token
        resolve()
      },
      error_callback: () => reject(new Error('A janela de autorização do Google foi fechada.')),
    })
    client.requestAccessToken({ prompt: accessToken ? '' : 'consent' })
  })
}

function addMinutes(date: string, time: string, duration: number) {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const value = new Date(year, month - 1, day, hour, minute + duration)
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}:00`
}

async function requestCalendarEvent(url: string) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!response.ok) throw new Error('Não foi possível consultar a reunião criada no Google Agenda.')
  return response.json() as Promise<GoogleCalendarEvent>
}

interface GoogleCalendarEvent {
  id: string
  htmlLink?: string
  hangoutLink?: string
  conferenceData?: { entryPoints?: Array<{ entryPointType: string; uri: string }>; createRequest?: { status?: { statusCode?: string } } }
}

export async function createGoogleMeetEvent(input: Omit<Consultation, 'id' | 'status' | 'source' | 'createdAt' | 'meetLink' | 'calendarLink' | 'googleEventId'>) {
  if (!accessToken) await connectGoogleCalendar()
  const startDateTime = `${input.date}T${input.startTime}:00`
  const endDateTime = addMinutes(input.date, input.startTime, input.duration)
  const requestId = crypto.randomUUID()
  const eventBody = {
    summary: `Consultoria LinkAtletas — ${input.athleteName}`,
    description: `PROPÓSITO\n${input.purpose}\n\nDESCRIÇÃO\n${input.description}\n\nAgendada pela plataforma LinkAtletas.`,
    start: { dateTime: startDateTime, timeZone: 'America/Sao_Paulo' },
    end: { dateTime: endDateTime, timeZone: 'America/Sao_Paulo' },
    attendees: input.athleteEmail ? [{ email: input.athleteEmail }] : [],
    conferenceData: { createRequest: { requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 24 * 60 }, { method: 'popup', minutes: 30 }] },
  }
  const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(eventBody),
  })
  if (!response.ok) {
    if (response.status === 401) accessToken = ''
    const details = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw new Error(details?.error?.message || 'O Google Agenda não conseguiu criar a consultoria.')
  }
  let event = await response.json() as GoogleCalendarEvent
  for (let attempt = 0; attempt < 4 && !event.hangoutLink; attempt += 1) {
    await new Promise(resolve => window.setTimeout(resolve, 700))
    event = await requestCalendarEvent(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${event.id}?conferenceDataVersion=1`)
  }
  const videoEntry = event.conferenceData?.entryPoints?.find(item => item.entryPointType === 'video')
  return { googleEventId: event.id, calendarLink: event.htmlLink, meetLink: event.hangoutLink || videoEntry?.uri }
}
