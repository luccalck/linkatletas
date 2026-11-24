import type { Page } from '@playwright/test'
import {
  GOALS,
  LEVELS,
  SLOTS,
  SPORTS,
  type Contract,
  type Profile,
  type Role,
  type Workout,
} from '../../../shared/contracts.js'
import type { Review } from '../../../shared/interaction-contracts.js'
import type {
  BillingConfig,
  BillingPlan,
  BillingSubscription,
  BillingWallet,
} from '../../../shared/billing-contracts.js'

export function webFixture(role: Role) {
  const ids = {
    athlete: '10000000-0000-4000-8000-000000000001',
    coach: '10000000-0000-4000-8000-000000000002',
    admin: '10000000-0000-4000-8000-000000000003',
  }
  const user = {
    id: ids[role],
    role,
    name: 'Pessoa de teste ' + role,
    email: role + '@example.invalid',
  }
  const now = new Date().toISOString()
  const contract: Contract = {
    id: '20000000-0000-4000-8000-000000000001',
    athleteId: ids.athlete,
    coachId: ids.coach,
    athleteName: 'Atleta de teste',
    coachName: 'Treinador de teste',
    status: 'active',
    createdAt: now,
    decidedAt: now,
  }
  const profile: Profile = {
    userId: user.id,
    role,
    name: user.name,
    email: user.email,
    city: 'Cidade de teste',
    bio: '',
    sports: [SPORTS[0]],
    goals: [GOALS[0]],
    levels: [LEVELS[0]],
    availability: [SLOTS[0]],
    mode: 'online',
    budget: 250,
    price: 150,
    cref: role === 'coach' ? '000123-G/SP' : '',
    qualification: role === 'coach' ? 'Bacharelado' : '',
    verificationStatus: role === 'coach' ? 'approved' : 'unsubmitted',
    verificationReason: '',
  }
  const workout: Workout = {
    id: '30000000-0000-4000-8000-000000000001',
    contractId: contract.id,
    title: 'Treino de teste',
    sport: SPORTS[0],
    scheduledDate: now.slice(0, 10),
    instructions: 'Orientacao de teste.',
    status: 'published',
    blocks: [
      { name: 'Bloco de teste', instructions: 'Executar conforme orientacao.' },
    ],
    athleteId: ids.athlete,
    coachId: ids.coach,
    athleteName: contract.athleteName,
    coachName: contract.coachName,
    createdAt: now,
    execution: null,
  }
  const review: Review = {
    id: '40000000-0000-4000-8000-000000000001',
    contractId: contract.id,
    athleteId: ids.athlete,
    athleteName: contract.athleteName,
    coachId: ids.coach,
    coachName: contract.coachName,
    rating: 5,
    text: 'Acompanhamento de teste.',
    reply: null,
    repliedAt: null,
    hidden: false,
    createdAt: now,
    updatedAt: now,
  }
  return {
    user,
    profile,
    contract,
    workouts: [workout],
    reviews: [review],
    subscriptions: [] as BillingSubscription[],
    loggedIn: true,
    config: {
      mode: 'academic',
      environment: 'disabled',
      available: false,
      commissionBps: 500,
      graceDays: 3,
    } as BillingConfig,
    plan: {
      coachId: ids.coach,
      name: 'Plano existente',
      amountCents: 15000,
      active: true,
    } as BillingPlan | null,
    wallet: {
      walletId: '50000000-0000-4000-8000-000000000001',
      updatedAt: now,
    } as BillingWallet | null,
    health: { notes: 'Informacoes existentes', heightCm: 180, weightKg: 80 },
    faults: new Set<string>(),
    writes: [] as {
      method: string
      path: string
      body: Record<string, unknown>
    }[],
    unhandled: [] as string[],
  }
}

export async function installWebFixture(
  page: Page,
  state: ReturnType<typeof webFixture>,
) {
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.slice(4),
      method = request.method()
    if (method === 'GET' && state.faults.has(path))
      return route.fulfill({
        status: 503,
        json: { message: 'Falha de teste em ' + path },
      })
    if (method === 'GET') {
      const bodies: Record<string, unknown> = {
        '/auth/session': { user: state.loggedIn ? state.user : null },
        '/profiles/me': { profile: state.profile },
        '/contracts': { contracts: [state.contract] },
        '/workouts': { workouts: state.workouts },
        '/dashboard': { contracts: [state.contract], workouts: state.workouts },
        '/coaches': {
          coaches: [
            {
              ...state.profile,
              userId: state.contract.coachId,
              role: 'coach',
              name: state.contract.coachName,
              score: 90,
              reasons: ['Modalidade em comum'],
            },
          ],
        },
        '/metrics': {
          metrics: [
            {
              sport: SPORTS[0],
              key: 'duration',
              label: 'Duracao',
              unit: 'min',
              min: 0,
              max: 1440,
            },
          ],
        },
        '/media': { media: [] },
        '/verifications': { verifications: [] },
        '/admin/verifications': { verifications: [] },
        '/reviews': {
          reviews: state.reviews.filter((review) => !review.hidden),
          count: state.reviews.filter((review) => !review.hidden).length,
          average: 5,
        },
        '/admin/reviews': { reviews: state.reviews, reports: [] },
        '/consultations': { consultations: [] },
        '/notifications': { notifications: [], unread: 0 },
        '/billing/config': state.config,
        '/billing/summary': {
          subscriptions: state.subscriptions,
          payments: [],
          totals: {
            receivedCents: 0,
            coachShareCents: 0,
            platformShareCents: 0,
          },
        },
        '/billing/plan': { plan: state.plan },
        '/billing/wallet': { wallet: state.wallet },
        '/privacy/policy': {
          policy: {
            version: 'test',
            text: 'Politica de teste.',
            retention: 'Retencao de teste.',
          },
        },
        '/privacy/consents': {
          consents: [
            {
              purpose: 'health',
              granted: true,
              version: 'test',
              updatedAt: new Date().toISOString(),
            },
          ],
        },
        '/privacy/health': { health: state.health },
        '/admin/privacy/requests': { requests: [] },
      }
      if (path === '/contracts/' + state.contract.id + '/messages')
        return route.fulfill({ json: { messages: [], nextCursor: null } })
      if (Object.hasOwn(bodies, path))
        return route.fulfill({ json: bodies[path] })
    } else {
      const body = request.postDataJSON() as Record<string, unknown>
      state.writes.push({ method, path, body })
      if (method === 'POST' && path === '/billing/checkout')
        return route.fulfill({ json: { subscription: state.subscriptions[0] } })
      if (
        method === 'POST' &&
        path.startsWith('/billing/subscriptions/') &&
        path.endsWith('/cancel')
      ) {
        const subscription = state.subscriptions.find(
          (item) => path === '/billing/subscriptions/' + item.id + '/cancel',
        )
        if (subscription) {
          subscription.state = 'cancellation_requested'
          return route.fulfill({ json: { subscription } })
        }
      }
      if (method === 'PUT' && path.startsWith('/reviews/')) {
        const review = state.reviews.find(
          (item) => path === '/reviews/' + item.id,
        )
        if (review) {
          Object.assign(review, body)
          return route.fulfill({ json: { review } })
        }
      }
      if (method === 'PATCH' && path === '/admin/billing/settings') {
        Object.assign(state.config, body)
        return route.fulfill({ json: state.config })
      }
      if (method === 'PUT' && path === '/billing/plan') {
        state.plan = { coachId: state.contract.coachId, ...body } as BillingPlan
        return route.fulfill({ json: { plan: state.plan } })
      }
      if (method === 'PUT' && path === '/billing/wallet') {
        state.wallet = {
          walletId: String(body.walletId),
          updatedAt: new Date().toISOString(),
        }
        return route.fulfill({ json: { wallet: state.wallet } })
      }
      if (method === 'PUT' && path === '/privacy/health') {
        state.health = body as typeof state.health
        return route.fulfill({ json: { health: state.health } })
      }
      if (method === 'PUT' && path === '/profiles/me') {
        Object.assign(state.profile, body)
        return route.fulfill({ json: { profile: state.profile } })
      }
      if (method === 'POST' && path === '/auth/logout') {
        state.loggedIn = false
        return route.fulfill({ json: { ok: true } })
      }
    }
    state.unhandled.push(method + ' ' + path)
    return route.fulfill({
      status: 500,
      json: { message: 'Operacao sem fixture: ' + method + ' ' + path },
    })
  })
}
