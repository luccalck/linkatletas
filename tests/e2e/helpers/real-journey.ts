import { randomUUID } from 'node:crypto'
import { expect, type Browser, type BrowserContext } from '@playwright/test'
import {
  GOALS,
  LEVELS,
  SLOTS,
  SPORTS,
  type Contract,
} from '../../../shared/contracts.js'

export const journeyPassword = 'SenhaJornada123!'

export async function request(
  context: BrowserContext,
  baseURL: string,
  method: string,
  endpoint: string,
  data?: unknown,
) {
  const response = await context.request.fetch(baseURL + '/api' + endpoint, {
    method,
    headers: { origin: baseURL },
    ...(data === undefined ? {} : { data }),
  })
  expect(
    response.status(),
    method + ' ' + endpoint + ': ' + (await response.text()),
  ).toBeLessThan(300)
  return response.json()
}

export async function realJourney(
  browser: Browser,
  baseURL: string,
  label: string,
) {
  if (process.env.E2E_BASE_URL)
    throw new Error(
      'Jornada real exige o servidor isolado gerenciado pelo Playwright.',
    )
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname))
    throw new Error('Jornada exige servidor local e banco de teste isolado.')
  const unique = label + '-' + randomUUID().slice(0, 8)
  const contexts = await Promise.all(
    [0, 1, 2].map(() =>
      browser.newContext({ baseURL, reducedMotion: 'reduce' }),
    ),
  )
  const [athleteContext, coachContext, adminContext] = contexts
  const errors: string[] = []
  try {
    const athleteUser = (
      await request(athleteContext, baseURL, 'POST', '/auth/register', {
        name: 'Atleta ' + unique,
        email: 'athlete-' + unique + '@example.invalid',
        password: journeyPassword,
        role: 'athlete',
      })
    ).user
    const coachUser = (
      await request(coachContext, baseURL, 'POST', '/auth/register', {
        name: 'Treinador ' + unique,
        email: 'coach-' + unique + '@example.invalid',
        password: journeyPassword,
        role: 'coach',
      })
    ).user
    await request(adminContext, baseURL, 'POST', '/auth/login', {
      email: 'admin@linkatletas.local',
      password: 'SenhaAdmin123!',
    })
    for (const [context, user] of [
      [athleteContext, athleteUser],
      [coachContext, coachUser],
    ] as const) {
      await request(context, baseURL, 'PUT', '/profiles/me', {
        name: user.name,
        city: 'Cidade de teste',
        bio: 'Dados ficticios da jornada.',
        sports: [SPORTS[0]],
        goals: [GOALS[0]],
        levels: [LEVELS[0]],
        availability: [SLOTS[0]],
        mode: 'online',
        budget: 250,
        price: 150,
      })
    }
    const verification = (
      await request(coachContext, baseURL, 'POST', '/verifications', {
        cref: '123456-G/SP',
        qualification: 'Bacharelado',
        evidence: 'Conferencia ficticia para teste isolado.',
      })
    ).verification
    await request(
      adminContext,
      baseURL,
      'PATCH',
      '/admin/verifications/' + verification.id,
      { status: 'approved', reason: 'Aprovacao ficticia restrita ao teste.' },
    )
    const contract = (
      await request(athleteContext, baseURL, 'POST', '/contracts', {
        coachId: coachUser.id,
      })
    ).contract as Contract
    await request(coachContext, baseURL, 'PATCH', '/contracts/' + contract.id, {
      status: 'active',
    })
    const [athlete, coach, admin] = await Promise.all(
      contexts.map((context) => context.newPage()),
    )
    for (const page of [athlete, coach, admin])
      page.on('pageerror', (error) => errors.push(error.message))
    return {
      unique,
      athlete,
      coach,
      admin,
      athleteContext,
      coachContext,
      adminContext,
      athleteUser,
      coachUser,
      contract,
      errors,
      close: () => Promise.all(contexts.map((context) => context.close())),
    }
  } catch (error) {
    await Promise.all(contexts.map((context) => context.close()))
    throw error
  }
}
