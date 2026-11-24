import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const password = 'SenhaTeste123!'
const evidenceDir = path.resolve(
  process.env.EVIDENCE_DIR || 'docs/evidencias/web',
)
async function noHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true)
}
async function register(
  page: Page,
  name: string,
  email: string,
  role: 'athlete' | 'coach',
) {
  await page.goto('/login?cadastro=1')
  await page
    .getByRole('button', {
      name: role === 'coach' ? 'Sou treinador' : 'Sou atleta',
      exact: true,
    })
    .click()
  await page.getByLabel('Nome completo', { exact: true }).fill(name)
  await page.getByLabel('E-mail', { exact: true }).fill(email)
  await page.getByLabel('Senha', { exact: true }).fill(password)
  await page
    .getByRole('button', { name: 'Criar minha conta', exact: true })
    .click()
  await expect(page).toHaveURL(role === 'coach' ? /\/treinador$/ : /\/atleta$/)
  await expect(page.getByText('Treinos publicados', { exact: true })).toBeVisible()
}
async function saveProfile(page: Page, role: 'athlete' | 'coach') {
  await page.goto(role === 'coach' ? '/treinador/perfil' : '/atleta/perfil')
  await page.getByLabel('Cidade', { exact: true }).fill('São Paulo')
  for (const name of ['Corrida', 'Performance', 'Iniciante', 'Segunda manhã'])
    await page.getByRole('checkbox', { name, exact: true }).check()
  await page
    .getByLabel(
      role === 'coach' ? 'Preço mensal (R$)' : 'Orçamento mensal (R$)',
      { exact: true },
    )
    .fill(role === 'coach' ? '150' : '200')
  await page.getByRole('button', { name: 'Salvar perfil', exact: true }).click()
  await expect(
    page.getByText('Perfil salvo com sucesso.', { exact: true }),
  ).toBeVisible()
}

test('login informa erro real e mantém formulário utilizável em celular', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/login')
  await page
    .getByLabel('E-mail', { exact: true })
    .fill('inexistente-e2e@example.com')
  await page.getByLabel('Senha', { exact: true }).fill(password)
  await page
    .getByRole('button', { name: 'Entrar na plataforma', exact: true })
    .click()
  await expect(page.getByRole('alert')).toBeVisible()
  await noHorizontalOverflow(page)
  await mkdir(evidenceDir, { recursive: true })
  await page.screenshot({
    path: path.join(evidenceDir, 'login-mobile-erro.png'),
    fullPage: true,
  })
})

test('cadastro → aprovação → contratação → publicação → execução persistida', async ({
  browser,
  baseURL,
}) => {
  // Windows WebKit spends several seconds per interaction across three contexts.
  // Keep the individual action/assertion limits, but allow the complete journey.
  if (process.platform === 'win32' && browser.browserType().name() === 'webkit')
    test.setTimeout(180_000)
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const coachName = `Treinador E2E ${unique}`
  const athleteName = `Atleta E2E ${unique}`
  const coachContext = await browser.newContext({
    reducedMotion: 'reduce',
    baseURL,
    viewport: { width: 1440, height: 1000 },
  })
  const athleteContext = await browser.newContext({
    reducedMotion: 'reduce',
    baseURL,
    viewport: { width: 1440, height: 1000 },
  })
  const adminContext = await browser.newContext({
    reducedMotion: 'reduce',
    baseURL,
    viewport: { width: 1440, height: 1000 },
  })
  const coach = await coachContext.newPage(),
    athlete = await athleteContext.newPage(),
    admin = await adminContext.newPage()
  const runtimeErrors: string[] = []
  for (const page of [coach, athlete, admin])
    page.on('pageerror', (error) => runtimeErrors.push(error.message))
  try {
    await test.step('Novas contas e perfis são gravados pela interface', async () => {
      await register(coach, coachName, `coach-${unique}@e2e.local`, 'coach')
      await saveProfile(coach, 'coach')
      await coach.getByLabel('CREF', { exact: true }).fill('123456-G/SP')
      await coach
        .getByLabel('Informações adicionais (opcional)', { exact: true })
        .fill('https://example.com/registro-ficticio-para-teste')
      await coach.getByRole('combobox', { name: /^Formação profissional/ }).selectOption('Bacharelado')
      await coach.getByLabel('Imagem do CREF para avaliação').setInputFiles({
        name: 'cref-ficticio.png',
        mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9uoAAAAASUVORK5CYII=', 'base64'),
      })
      await coach
        .getByRole('button', { name: 'Enviar para análise', exact: true })
        .click()
      await expect(coach.getByText('Aguarde a confirmação do administrador. Seu comprovante foi enviado para avaliação.', { exact: true })).toBeVisible()
      await expect(coach.getByRole('button', { name: 'Enviar para análise', exact: true })).toHaveCount(0)
      await register(
        athlete,
        athleteName,
        `athlete-${unique}@e2e.local`,
        'athlete',
      )
      await saveProfile(athlete, 'athlete')
      await athlete.goto('/atleta/descobrir')
      await expect(athlete.getByText(coachName, { exact: true })).toHaveCount(0)
    })

    await test.step('Administrador confere credenciais antes da descoberta', async () => {
      await admin.goto('/login')
      await admin
        .getByLabel('E-mail', { exact: true })
        .fill(process.env.E2E_ADMIN_EMAIL ?? 'admin@linkatletas.local')
      await admin
        .getByLabel('Senha', { exact: true })
        .fill(process.env.E2E_ADMIN_PASSWORD ?? 'SenhaAdmin123!')
      await admin
        .getByRole('button', { name: 'Entrar na plataforma', exact: true })
        .click()
      await expect(admin).toHaveURL(/\/admin$/)
      const submission = admin.locator('article').filter({
        has: admin.getByRole('heading', { name: coachName, exact: true }),
      })
      await submission
        .getByLabel('Justificativa da análise')
        .fill('Aprovação fictícia registrada pelo teste automatizado.')
      await submission
        .getByRole('button', { name: 'Aprovar', exact: true })
        .click()
      await expect(
        admin.getByText('Profissional aprovado.', { exact: true }),
      ).toBeVisible()
      await mkdir(evidenceDir, { recursive: true })
      await admin.screenshot({
        path: path.join(evidenceDir, 'aprovacao-administrativa.png'),
        fullPage: true,
      })
    })

    await test.step('Atleta solicita e treinador aceita o vínculo', async () => {
      await athlete.reload()
      const card = athlete.locator('article').filter({ hasText: coachName })
      await card
        .getByRole('button', { name: 'Solicitar contratação', exact: true })
        .click()
      await expect(athlete.getByText(/solicitação enviada/i)).toBeVisible()
      await coach.goto('/treinador/alunos')
      const request = coach.locator('article').filter({ hasText: athleteName })
      await request
        .getByRole('button', { name: 'Aceitar solicitação', exact: true })
        .click()
      await expect(coach.getByText(/solicitação aceita/i)).toBeVisible()
    })

    await test.step('Treinador publica uma ficha e atleta registra seu retorno', async () => {
      await coach.goto('/treinador/treinos')
      await coach
        .getByRole('button', { name: 'Novo treino', exact: true })
        .click()
      await coach
        .getByLabel('Título do treino', { exact: true })
        .fill(`Treino E2E ${unique}`)
      await coach
        .getByRole('combobox', { name: /^Atleta/ })
        .selectOption({ label: athleteName })
      await coach
        .getByRole('combobox', { name: /^Modalidade/ })
        .selectOption('Corrida')
      await coach
        .getByLabel('Data do treino', { exact: true })
        .fill('2026-10-20')
      await coach
        .getByLabel('Nome do exercício', { exact: true })
        .fill('Corrida confortável')
      await coach
        .getByLabel('Instruções do exercício', { exact: true })
        .fill('Corra em ritmo confortável e registre como se sentiu.')
      await coach.getByLabel('Duração (min)', { exact: true }).fill('20')
      await coach
        .getByRole('button', { name: 'Publicar treino', exact: true })
        .click()
      await expect(coach.getByText(/treino publicado/i)).toBeVisible()
      await athlete.goto('/atleta/treino')
      const workoutSelect = athlete.getByRole('combobox', {
        name: /^Treino selecionado/,
      })
      const option = workoutSelect
        .locator('option')
        .filter({ hasText: `Treino E2E ${unique}` })
      await expect(option).toHaveCount(1)
      await workoutSelect.selectOption((await option.getAttribute('value'))!)
      await athlete
        .getByRole('button', { name: 'Registrar execução', exact: true })
        .click()
      await athlete
        .getByRole('checkbox', { name: '1. Corrida confortável', exact: true })
        .check()
      await athlete.getByLabel(/esforço/i).fill('7')
      await athlete.getByLabel('Duração (min)', { exact: true }).fill('20')
      await athlete.getByLabel('Distância (km)', { exact: true }).fill('2')
      await athlete
        .getByLabel('Observações do treino', { exact: true })
        .fill('Consegui cumprir o treino. Feedback E2E persistido.')
      await athlete
        .getByRole('button', { name: 'Salvar execução', exact: true })
        .click()
      await expect(
        athlete.getByRole('button', {
          name: 'Atualizar execução',
          exact: true,
        }),
      ).toBeVisible()
      await athlete.reload()
      await expect(
        athlete.getByText(
          'Consegui cumprir o treino. Feedback E2E persistido.',
          { exact: true },
        ),
      ).toBeVisible()
      await athlete.screenshot({
        path: path.join(evidenceDir, 'execucao-desktop.png'),
        fullPage: true,
      })
      await athlete.setViewportSize({ width: 390, height: 844 })
      const sidebar = athlete.locator('#application-sidebar')
      await expect(sidebar).toBeHidden()
      await athlete
        .getByRole('button', { name: 'Abrir menu', exact: true })
        .click()
      await expect(sidebar).toBeVisible()
      await expect(
        athlete.getByRole('button', { name: 'Abrir menu', exact: true }),
      ).toHaveAttribute('aria-expanded', 'true')
      await sidebar
        .getByRole('button', { name: 'Fechar menu', exact: true })
        .click()
      await expect(sidebar).toBeHidden()
      await expect
        .poll(() =>
          sidebar.evaluate((element) => element.getBoundingClientRect().right),
        )
        .toBeLessThanOrEqual(1)
      await noHorizontalOverflow(athlete)
      await athlete.screenshot({
        path: path.join(evidenceDir, 'execucao-mobile.png'),
        fullPage: true,
        animations: 'disabled',
      })
      await coach.reload()
      const savedWorkout = coach.locator('article').filter({
        has: coach.getByRole('heading', {
          name: `Treino E2E ${unique}`,
          exact: true,
        }),
      })
      await savedWorkout
        .getByRole('button', { name: 'Ver detalhes e execução', exact: true })
        .click()
      await expect(
        coach.getByText('Consegui cumprir o treino. Feedback E2E persistido.', {
          exact: true,
        }),
      ).toBeVisible()
      await noHorizontalOverflow(coach)
      await coach.screenshot({
        path: path.join(evidenceDir, 'feedback-treinador.png'),
        fullPage: true,
      })
    })
    await test.step('Suspensao e revogacao preservam a decisao original e exibem o estado atual', async () => {
      await admin.goto('/admin')
      const verification = admin.locator('article').filter({
        has: admin.getByRole('heading', { name: coachName, exact: true }),
      })
      await verification
        .getByRole('textbox')
        .fill('Suspensao ficticia para teste de regressao.')
      admin.once('dialog', (dialog) => void dialog.accept())
      await verification
        .getByRole('button', { name: 'Suspender profissional', exact: true })
        .click()
      await expect(verification.getByText('Suspenso', { exact: true })).toBeVisible()
      await expect(verification.getByText('Aprovado', { exact: true })).toBeVisible()
      await expect(
        verification.getByRole('button', { name: 'Suspender profissional', exact: true }),
      ).toBeDisabled()
      await verification
        .getByRole('textbox')
        .fill('Revogacao ficticia para teste de regressao.')
      admin.once('dialog', (dialog) => void dialog.accept())
      await verification
        .getByRole('button', { name: 'Revogar aprovação', exact: true })
        .click()
      await expect(verification.getByText('Recusado', { exact: true })).toBeVisible()
      await expect(verification.getByText('Aprovado', { exact: true })).toBeVisible()
      await admin.screenshot({
        path: path.join(evidenceDir, 'admin-status-atual.png'),
        fullPage: true,
      })
    })
    expect(runtimeErrors).toEqual([])
  } finally {
    const closed = await Promise.allSettled([
      coachContext.close(),
      athleteContext.close(),
      adminContext.close(),
    ])
    for (const result of closed)
      if (result.status === 'rejected')
        console.warn(
          'Contexto já encerrado durante a finalização do navegador.',
        )
  }
})
