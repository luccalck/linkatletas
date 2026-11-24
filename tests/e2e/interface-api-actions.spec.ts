import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import {
  journeyPassword,
  realJourney,
  request,
} from './helpers/real-journey.js'

test('avaliacao resposta denuncia moderacao e edicao apos encerramento persistem na API', async ({
  browser,
  baseURL,
}, info) => {
  const flow = await realJourney(browser, baseURL!, info.project.name)
  const original = 'Experiencia ficticia ' + flow.unique,
    updated = 'Experiencia atualizada ' + flow.unique
  try {
    await flow.athlete.goto('/atleta/avaliacoes?treinador=' + flow.coachUser.id)
    await flow.athlete.getByLabel(/Sua experi/).fill(original)
    await flow.athlete.getByRole('button', { name: /Publicar avalia/ }).click()
    await expect(
      flow.athlete.getByText(original, { exact: true }),
    ).toBeVisible()
    await flow.coach.goto(
      '/treinador/avaliacoes?treinador=' + flow.coachUser.id,
    )
    const coachReview = flow.coach
      .locator('article')
      .filter({ hasText: original })
    await coachReview
      .getByLabel('Sua resposta')
      .fill('Resposta ficticia do profissional.')
    await coachReview.getByRole('button', { name: /Responder avalia/ }).click()
    await expect(
      coachReview.getByText('Resposta ficticia do profissional.', {
        exact: true,
      }),
    ).toBeVisible()
    await flow.athlete.reload()
    await flow.athlete.getByRole('button', { name: /Denunciar conte/ }).click()
    await flow.athlete
      .getByLabel(/Motivo da den/)
      .fill('Denuncia ficticia para testar moderacao.')
    await flow.athlete.getByRole('button', { name: /Enviar den/ }).click()
    await expect(flow.athlete.getByText(/enviada para an/)).toBeVisible()
    await flow.admin.goto('/admin/avaliacoes')
    const adminReview = flow.admin
      .locator('article')
      .filter({ hasText: original })
    await adminReview
      .getByLabel(/Justificativa de modera/)
      .fill('Moderacao ficticia para testar persistencia.')
    await adminReview.getByRole('button', { name: /Ocultar avalia/ }).click()
    await expect(
      adminReview.getByRole('button', { name: /Restaurar publica/ }),
    ).toBeVisible()
    await flow.athlete.reload()
    await expect(flow.athlete.getByText(original, { exact: true })).toHaveCount(
      0,
    )
    await adminReview.getByRole('button', { name: /Restaurar publica/ }).click()
    await expect(
      adminReview.getByRole('button', { name: /Ocultar avalia/ }),
    ).toBeVisible()
    await flow.athlete.goto('/atleta/conexoes')
    await flow.athlete.getByRole('button', { name: /Encerrar v/ }).click()
    await flow.athlete
      .getByLabel('Motivo do encerramento')
      .fill('Encerramento ficticio para preservar o historico.')
    await flow.athlete
      .getByRole('button', { name: /Confirmar encerramento/ })
      .click()
    await expect(
      flow.athlete.getByRole('button', { name: /Encerrar v/ }),
    ).toHaveCount(0)
    await flow.athlete.goto('/atleta/avaliacoes?treinador=' + flow.coachUser.id)
    await flow.athlete.getByRole('button', { name: /Editar avalia/ }).click()
    await flow.athlete.getByLabel(/Sua experi/).fill(updated)
    await flow.athlete.getByRole('button', { name: /Salvar edi/ }).click()
    await expect(flow.athlete.getByText(updated, { exact: true })).toBeVisible()
    const stored = await request(
      flow.athleteContext,
      baseURL!,
      'GET',
      '/reviews?coachId=' + flow.coachUser.id,
    )
    expect(stored.reviews[0]).toMatchObject({
      text: updated,
      reply: 'Resposta ficticia do profissional.',
      hidden: false,
    })
    expect(flow.errors).toEqual([])
  } finally {
    await flow.close()
  }
})

test('agenda permite reagendar cancelar e concluir encontros pela interface', async ({
  browser,
  baseURL,
}, info) => {
  const flow = await realJourney(browser, baseURL!, info.project.name)
  try {
    await flow.athlete.goto('/atleta/agenda')
    const date = new Date(Date.now() + 14 * 86400000)
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16)
    await flow.athlete
      .getByLabel(/T.tulo/, { exact: true })
      .fill('Consultoria ' + flow.unique)
    await flow.athlete
      .getByLabel('Objetivo do encontro')
      .fill('Objetivo ficticio da consultoria.')
    await flow.athlete.getByLabel(/Data e hor/).fill(local)
    await flow.athlete
      .getByRole('button', { name: 'Agendar consultoria', exact: true })
      .click()
    await expect(
      flow.athlete.getByText('Consultoria agendada.', { exact: true }),
    ).toBeVisible()
    const first = (
      await request(flow.athleteContext, baseURL!, 'GET', '/consultations')
    ).consultations[0]
    await flow.coach.goto('/treinador/consultorias')
    const card = flow.coach
      .locator('article')
      .filter({ hasText: 'Consultoria ' + flow.unique })
    await card.getByRole('button', { name: 'Reagendar ou cancelar' }).click()
    const next = new Date(date.getTime() + 86400000)
    await card
      .getByLabel(/Novo in/)
      .fill(
        new Date(next.getTime() - next.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16),
      )
    await card
      .getByLabel(/Motivo da mudan/)
      .fill('Reagendamento ficticio da consultoria.')
    await card.getByRole('button', { name: /Salvar novo hor/ }).click()
    await expect(
      flow.coach.getByText('Consultoria reagendada.', { exact: true }),
    ).toBeVisible()
    const changed = (
      await request(flow.coachContext, baseURL!, 'GET', '/consultations')
    ).consultations[0]
    expect(new Date(changed.startsAt).getTime()).toBeGreaterThan(
      new Date(first.startsAt).getTime(),
    )
    const dbUrl =
      process.env.TEST_DATABASE_URL ||
      'postgresql://linkatletas:linkatletas_dev@127.0.0.1:54329/linkatletas_test'
    if (!decodeURIComponent(new URL(dbUrl).pathname).endsWith('_test'))
      throw new Error('Ajuste do relogio exige base de teste.')
    const pool = new pg.Pool({ connectionString: dbUrl, max: 1 })
    try {
      await pool.query(
        "UPDATE consultations SET starts_at=$1 WHERE id=$2 AND contract_id=$3 AND status='scheduled'",
        [
          new Date(Date.now() - 3600000).toISOString(),
          first.id,
          flow.contract.id,
        ],
      )
    } finally {
      await pool.end()
    }
    await flow.coach.reload()
    await card.getByRole('button', { name: /Marcar conclu/ }).click()
    await card
      .getByLabel(/Registro da conclus/)
      .fill('Encontro ficticio concluido.')
    await card.getByRole('button', { name: /Confirmar conclus/ }).click()
    await expect(
      flow.coach.getByText(/Consultoria conclu.da\./, { exact: true }),
    ).toBeVisible()
    const second = (
      await request(flow.athleteContext, baseURL!, 'POST', '/consultations', {
        contractId: flow.contract.id,
        title: 'Cancelar ' + flow.unique,
        description: 'Encontro ficticio para cancelamento.',
        startsAt: new Date(date.getTime() + 2 * 86400000).toISOString(),
        durationMinutes: 30,
      })
    ).consultation
    await flow.athlete.reload()
    const cancelCard = flow.athlete
      .locator('article')
      .filter({ hasText: second.title })
    await cancelCard
      .getByRole('button', { name: 'Reagendar ou cancelar' })
      .click()
    await cancelCard
      .getByLabel(/Motivo da mudan/)
      .fill('Cancelamento ficticio da consultoria.')
    flow.athlete.once('dialog', (dialog) => dialog.accept())
    await cancelCard
      .getByRole('button', { name: 'Cancelar consultoria', exact: true })
      .click()
    await expect(
      flow.athlete.getByText('Consultoria cancelada.', { exact: true }),
    ).toBeVisible()
    const records = (
      await request(flow.athleteContext, baseURL!, 'GET', '/consultations')
    ).consultations
    expect(
      records.find((item: { id: string }) => item.id === first.id)?.status,
    ).toBe('completed')
    expect(
      records.find((item: { id: string }) => item.id === second.id)?.status,
    ).toBe('cancelled')
    expect(flow.errors).toEqual([])
  } finally {
    await flow.close()
  }
})

test('plano carteira e regras financeiras sao salvos sem criar cobranca academica', async ({
  browser,
  baseURL,
}, info) => {
  const flow = await realJourney(browser, baseURL!, info.project.name)
  const before = await request(
    flow.adminContext,
    baseURL!,
    'GET',
    '/billing/config',
  )
  try {
    await flow.coach.goto('/treinador/financeiro')
    await flow.coach.getByLabel('Nome do plano').fill('Plano ' + flow.unique)
    await flow.coach.getByLabel(/Mensalidade/).fill('199.90')
    await flow.coach
      .getByRole('button', { name: 'Salvar plano', exact: true })
      .click()
    await expect(
      flow.coach.getByText('Plano mensal salvo.', { exact: true }),
    ).toBeVisible()
    const walletId = '50000000-0000-4000-8000-000000000001'
    await flow.coach
      .getByLabel('Identificador da carteira Asaas')
      .fill(walletId)
    await flow.coach
      .getByRole('button', { name: 'Salvar carteira', exact: true })
      .click()
    await expect(
      flow.coach.getByText('Carteira de recebimento salva.', { exact: true }),
    ).toBeVisible()
    expect(
      (await request(flow.coachContext, baseURL!, 'GET', '/billing/plan')).plan,
    ).toMatchObject({ amountCents: 19990, name: 'Plano ' + flow.unique })
    expect(
      (await request(flow.coachContext, baseURL!, 'GET', '/billing/wallet'))
        .wallet.walletId,
    ).toBe(walletId)
    await flow.admin.goto('/admin/financeiro')
    await expect(
      flow.admin.getByRole('button', { name: /Salvar regras/ }),
    ).toBeEnabled()
    const commissionBps = before.commissionBps === 750 ? 500 : 750
    await flow.admin.getByLabel(/Comiss/).fill(String(commissionBps / 100))
    await flow.admin.getByLabel(/Car.ncia/).fill('4')
    await flow.admin.getByRole('button', { name: /Salvar regras/ }).click()
    await expect(flow.admin.getByText(/financeira atualizada/)).toBeVisible()
    expect(
      await request(flow.adminContext, baseURL!, 'GET', '/billing/config'),
    ).toMatchObject({ commissionBps, graceDays: 4 })
    await flow.athlete.goto('/atleta/financeiro')
    await expect(
      flow.athlete.getByRole('button', { name: 'Preparar checkout' }),
    ).toBeDisabled()
    expect(
      (await request(flow.athleteContext, baseURL!, 'GET', '/billing/summary'))
        .payments,
    ).toEqual([])
    expect(flow.errors).toEqual([])
  } finally {
    try {
      await request(
        flow.adminContext,
        baseURL!,
        'PATCH',
        '/admin/billing/settings',
        { commissionBps: before.commissionBps, graceDays: before.graceDays },
      )
    } finally {
      await flow.close()
    }
  }
})

test('privacidade exportacao notificacoes e encerramento funcionam com persistencia', async ({
  browser,
  baseURL,
}, info) => {
  const flow = await realJourney(browser, baseURL!, info.project.name)
  try {
    await flow.athlete.goto('/atleta/privacidade')
    await flow.athlete.getByRole('checkbox', { name: /Informa.*sa.de/ }).check()
    await flow.athlete.getByLabel('Altura (cm)').fill('178')
    await flow.athlete.getByLabel('Peso (kg)').fill('76.5')
    await flow.athlete
      .getByLabel(/Observa.*privadas/)
      .fill('Saude ficticia para exportacao.')
    await flow.athlete.getByRole('button', { name: /Salvar informa/ }).click()
    await expect(flow.athlete.getByText(/privadas salvas/)).toBeVisible()
    const download = flow.athlete.waitForEvent('download')
    await flow.athlete
      .getByRole('button', { name: 'Exportar meus dados', exact: true })
      .click()
    const file = await download
    const filePath = await file.path()
    expect(filePath).not.toBeNull()
    const exported = JSON.parse(await readFile(filePath!, 'utf8'))
    expect(exported.user.id).toBe(flow.athleteUser.id)
    expect(exported.health).toMatchObject({
      notes: 'Saude ficticia para exportacao.',
      heightCm: 178,
      weightKg: 76.5,
    })
    await flow.athlete
      .getByRole('checkbox', { name: /Informa.*sa.de/ })
      .uncheck()
    await expect(flow.athlete.getByLabel('Altura (cm)')).toHaveCount(0)
    expect(
      (await request(flow.athleteContext, baseURL!, 'GET', '/privacy/health'))
        .health,
    ).toBeNull()
    await flow.coach.goto('/treinador/notificacoes')
    await expect(
      flow.coach.getByRole('button', { name: 'Marcar todas como lidas' }),
    ).toBeEnabled()
    await flow.coach
      .getByRole('button', { name: 'Marcar todas como lidas' })
      .click()
    await expect(
      flow.coach.getByRole('button', { name: 'Marcar todas como lidas' }),
    ).toBeDisabled()
    expect(
      (await request(flow.coachContext, baseURL!, 'GET', '/notifications'))
        .unread,
    ).toBe(0)
    await flow.athlete.getByLabel('Confirme sua senha').fill(journeyPassword)
    await flow.athlete
      .getByRole('checkbox', { name: /Entendo que esta/ })
      .check()
    await flow.athlete
      .getByRole('button', { name: 'Encerrar minha conta', exact: true })
      .click()
    await expect(flow.athlete).toHaveURL(/\/login$/)
    expect(
      (await request(flow.athleteContext, baseURL!, 'GET', '/auth/session'))
        .user,
    ).toBeNull()
    await flow.admin.goto('/admin/privacidade')
    await expect(
      flow.admin.getByText('Conta ' + flow.athleteUser.id, { exact: true }),
    ).toBeVisible()
    expect(flow.errors).toEqual([])
  } finally {
    await flow.close()
  }
})
