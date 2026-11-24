import { expect, test } from '@playwright/test'
import { installWebFixture, webFixture } from './helpers/web-fixture.js'
import { workoutSchema } from '../../server/shared/validation.js'

test('atleta edita sua avaliacao depois do encerramento do vinculo', async ({
  page,
}) => {
  const state = webFixture('athlete')
  state.contract.status = 'cancelled'
  await installWebFixture(page, state)
  await page.goto('/atleta/avaliacoes')
  await page.getByRole('button', { name: /Editar avalia/ }).click()
  await page
    .getByLabel(/Sua experi/)
    .fill('Avaliacao atualizada depois do encerramento.')
  await expect(page.getByRole('button', { name: /Salvar edi/ })).toBeEnabled()
  await page.getByRole('button', { name: /Salvar edi/ }).click()
  await expect(
    page.getByText('Avaliacao atualizada depois do encerramento.', {
      exact: true,
    }),
  ).toBeVisible()
  expect(state.writes).toContainEqual({
    method: 'PUT',
    path: '/reviews/' + state.reviews[0].id,
    body: { rating: 5, text: 'Avaliacao atualizada depois do encerramento.' },
  })
})

test('administrador so salva regras depois de carregar a configuracao', async ({
  page,
}) => {
  const state = webFixture('admin')
  state.faults.add('/billing/config')
  await installWebFixture(page, state)
  await page.goto('/admin/financeiro')
  await expect(page.getByRole('alert')).toContainText('Falha de teste')
  await expect(
    page.getByRole('button', { name: /Salvar regras/ }),
  ).toBeDisabled()
  expect(state.writes).toEqual([])
  state.faults.clear()
  await page.getByRole('button', { name: /Tentar novamente/ }).click()
  await expect(page.getByLabel(/Comiss/)).toHaveValue('5')
  await page.getByLabel(/Comiss/).fill('2.5')
  await page.getByLabel(/Car.ncia/).fill('4')
  await page.getByRole('button', { name: /Salvar regras/ }).click()
  await expect(page.getByText(/financeira atualizada/)).toBeVisible()
  expect(state.writes).toContainEqual({
    method: 'PATCH',
    path: '/admin/billing/settings',
    body: { commissionBps: 250, graceDays: 4 },
  })
})

test('treinador preserva plano e carteira quando a consulta falha', async ({
  page,
}) => {
  const state = webFixture('coach')
  state.faults.add('/billing/plan').add('/billing/wallet')
  await installWebFixture(page, state)
  await page.goto('/treinador/financeiro')
  await expect(page.getByRole('alert')).toHaveCount(2)
  await expect(
    page.getByRole('button', { name: 'Salvar plano' }),
  ).toBeDisabled()
  await expect(
    page.getByRole('button', { name: 'Salvar carteira' }),
  ).toBeDisabled()
  state.faults.clear()
  await page
    .getByRole('alert')
    .filter({ hasText: '/billing/plan' })
    .getByRole('button')
    .click()
  await page
    .getByRole('alert')
    .filter({ hasText: '/billing/wallet' })
    .getByRole('button')
    .click()
  await expect(page.getByLabel('Nome do plano')).toHaveValue('Plano existente')
  await page.getByLabel(/Mensalidade/).fill('175.50')
  await page.getByRole('button', { name: 'Salvar plano' }).click()
  await expect(page.getByText('Plano mensal salvo.')).toBeVisible()
  await page.getByRole('button', { name: 'Salvar carteira' }).click()
  await expect(page.getByText('Carteira de recebimento salva.')).toBeVisible()
  expect(state.writes).toContainEqual({
    method: 'PUT',
    path: '/billing/plan',
    body: { name: 'Plano existente', amountCents: 17550, active: true },
  })
  expect(state.writes).toContainEqual({
    method: 'PUT',
    path: '/billing/wallet',
    body: { walletId: state.wallet?.walletId },
  })
})

test('falha ao consultar saude nao permite salvar um formulario vazio', async ({
  page,
}) => {
  const state = webFixture('athlete')
  state.faults.add('/privacy/health')
  await installWebFixture(page, state)
  await page.goto('/atleta/privacidade')
  await expect(page.getByRole('alert')).toContainText('/privacy/health')
  await expect(
    page.getByRole('button', { name: /Salvar informa/ }),
  ).toBeDisabled()
  state.faults.clear()
  await page.getByRole('button', { name: /Tentar novamente/ }).click()
  await expect(page.getByLabel(/Observa.*privadas/)).toHaveValue(
    'Informacoes existentes',
  )
  await page.getByLabel(/Observa.*privadas/).fill('Informacoes atualizadas.')
  await page.getByRole('button', { name: /Salvar informa/ }).click()
  await expect(page.getByText(/privadas salvas/)).toBeVisible()
  expect(state.writes).toContainEqual({
    method: 'PUT',
    path: '/privacy/health',
    body: { notes: 'Informacoes atualizadas.', heightCm: 180, weightKg: 80 },
  })
})

test('trocar de treino descarta o arquivo selecionado para o treino anterior', async ({
  page,
}) => {
  const state = webFixture('athlete')
  state.workouts.push({
    ...state.workouts[0],
    id: '30000000-0000-4000-8000-000000000002',
    title: 'Outro treino',
  })
  await installWebFixture(page, state)
  await page.goto('/atleta/treino')
  await page.getByLabel('Arquivo privado', { exact: true }).setInputFiles({
    name: 'treino-anterior.png',
    mimeType: 'image/png',
    buffer: Buffer.from('arquivo ficticio'),
  })
  await expect(
    page.getByRole('button', { name: 'Enviar arquivo' }),
  ).toBeEnabled()
  await page.getByLabel('Treino selecionado').selectOption(state.workouts[1].id)
  await expect(
    page.getByRole('heading', { name: 'Outro treino', exact: true }),
  ).toBeVisible()
  await expect
    .poll(() =>
      page
        .getByLabel('Arquivo privado', { exact: true })
        .evaluate((element: HTMLInputElement) => element.files?.length),
    )
    .toBe(0)
  await expect(
    page.getByRole('button', { name: 'Enviar arquivo' }),
  ).toBeDisabled()
})

for (const role of ['athlete', 'coach'] as const) {
  test(
    'historico de treino nao oferece escrita em vinculo encerrado para ' + role,
    async ({ page }) => {
      const state = webFixture(role)
      state.contract.status = 'cancelled'
      await installWebFixture(page, state)
      await page.goto(
        role === 'coach' ? '/treinador/treinos' : '/atleta/treino',
      )
      if (role === 'coach') {
        await expect(
          page.getByRole('button', { name: 'Editar treino' }),
        ).toHaveCount(0)
        await page.getByRole('button', { name: /Ver detalhes/ }).click()
      } else
        await expect(
          page.getByRole('button', { name: /Registrar execu/ }),
        ).toHaveCount(0)
      await expect(
        page.getByText('Orientacao de teste.', { exact: true }),
      ).toBeVisible()
      await expect(
        page.getByLabel('Arquivo privado', { exact: true }),
      ).toHaveCount(0)
      expect(state.writes).toEqual([])
    },
  )
}

for (const resource of ['contracts', 'metrics'] as const) {
  test(
    'falha de ' + resource + ' tem mensagem e recuperacao na interface',
    async ({ page }) => {
      const state = webFixture('athlete')
      state.faults.add('/' + resource)
      state.workouts[0].execution = {
        id: '70000000-0000-4000-8000-000000000001',
        completedBlocks: [0],
        effort: 5,
        notes: '',
        metrics: { duration: 20 },
        updatedAt: new Date().toISOString(),
      }
      await installWebFixture(page, state)
      await page.goto(
        resource === 'contracts' ? '/atleta/avaliacoes' : '/atleta/treino',
      )
      await expect(page.getByRole('alert')).toContainText('/' + resource)
      state.faults.clear()
      await page.getByRole('button', { name: /Tentar novamente/ }).click()
      await expect(page.getByRole('alert')).toHaveCount(0)
      if (resource === 'contracts')
        await expect(
          page.getByRole('button', { name: /Publicar avalia/ }),
        ).toBeEnabled()
      else
        await expect(
          page.locator('.live-execution-summary .live-tags'),
        ).toContainText('Duracao: 20 min')
      expect(state.writes).toEqual([])
    },
  )
}

test('perfil aceita todas as modalidades do catalogo e salva dentro do limite', async ({
  page,
}) => {
  const state = webFixture('athlete')
  state.profile.sports = []
  await installWebFixture(page, state)
  await page.goto('/atleta/perfil')
  const choices = page
    .getByRole('group', { name: 'Modalidades', exact: true })
    .getByRole('checkbox')
  await expect(choices).toHaveCount(5)
  for (let index = 0; index < 5; index++) await choices.nth(index).check()
  await page.getByRole('button', { name: 'Salvar perfil', exact: true }).click()
  await expect(page.getByText(/Perfil salvo com sucesso/)).toBeVisible()
  expect(
    state.writes.find((write) => write.path === '/profiles/me')?.body.sports,
  ).toHaveLength(5)
})

test('perfil profissional mostra imediatamente o nome que acabou de ser salvo', async ({
  page,
}) => {
  const state = webFixture('coach')
  await installWebFixture(page, state)
  await page.goto('/treinador/perfil')
  await page
    .getByLabel('Nome completo', { exact: true })
    .fill('Nome profissional atualizado')
  await page.getByRole('button', { name: 'Salvar perfil', exact: true }).click()
  await expect(page.getByText(/Perfil salvo com sucesso/)).toBeVisible()
  await expect(
    page.getByLabel('Nome do profissional', { exact: true }),
  ).toHaveValue('Nome profissional atualizado')
  await expect(page.locator('.sidebar__user strong')).toHaveText(
    'Nome profissional atualizado',
  )
})

test('editor preserva titulo e distancia validos nos limites aceitos pela API', async ({
  page,
}) => {
  const state = webFixture('coach')
  await installWebFixture(page, state)
  await page.goto('/treinador/treinos')
  await page.getByRole('button', { name: 'Editar treino', exact: true }).click()
  const title = 'Treino valido ' + 'a'.repeat(144)
  await page.getByLabel(/T.tulo/, { exact: false }).fill(title)
  await expect(page.getByLabel(/T.tulo/, { exact: false })).toHaveValue(title)
  await page.getByLabel(/Dist.ncia/).fill('1200')
  await page
    .getByRole('button', { name: 'Salvar rascunho', exact: true })
    .click()
  await expect(page.getByText(/Rascunho salvo/)).toBeVisible()
  const saved = state.writes.find(
    (write) => write.path === '/workouts/' + state.workouts[0].id,
  )?.body
  expect(workoutSchema.safeParse(saved).success).toBe(true)
  expect(saved?.title).toBe(title)
  expect(saved?.blocks).toEqual(
    expect.arrayContaining([expect.objectContaining({ distanceKm: 1200 })]),
  )
})

for (const role of ['athlete', 'coach'] as const) {
  test(
    'controles de assinatura enviam a operacao correta para ' + role,
    async ({ page }) => {
      const state = webFixture(role)
      state.config = {
        ...state.config,
        mode: 'asaas',
        environment: 'sandbox',
        available: true,
      }
      state.subscriptions.push({
        id: '60000000-0000-4000-8000-000000000001',
        contractId: state.contract.id,
        athleteId: state.contract.athleteId,
        coachId: state.contract.coachId,
        athleteName: state.contract.athleteName,
        coachName: state.contract.coachName,
        planName: 'Assinatura de teste',
        amountCents: 15000,
        commissionBps: 500,
        environment: 'sandbox',
        state: 'regular',
        checkoutUrl: 'https://example.invalid/checkout',
        paidUntil: new Date(Date.now() + 86400000).toISOString(),
        graceUntil: null,
        cancellationConfirmed: false,
        cancellationReason: '',
        createdAt: new Date().toISOString(),
      })
      await installWebFixture(page, state)
      await page.goto(
        role === 'coach' ? '/treinador/financeiro' : '/atleta/financeiro',
      )
      if (role === 'athlete') {
        await page.getByRole('button', { name: 'Preparar checkout' }).click()
        await expect(page.getByText(/Checkout preparado/)).toBeVisible()
        await expect(
          page.getByRole('link', { name: 'Abrir checkout' }),
        ).toHaveAttribute('href', 'https://example.invalid/checkout')
        expect(state.writes).toContainEqual({
          method: 'POST',
          path: '/billing/checkout',
          body: { contractId: state.contract.id },
        })
      } else
        await expect(
          page.getByRole('button', { name: 'Preparar checkout' }),
        ).toHaveCount(0)
      await page.getByRole('button', { name: /Cancelar renova/ }).click()
      await page
        .getByLabel('Motivo do cancelamento')
        .fill('Cancelamento ficticio da assinatura.')
      await page
        .getByRole('button', { name: 'Confirmar cancelamento', exact: true })
        .click()
      await expect(page.getByText(/cancelamento registrada/)).toBeVisible()
      expect(state.writes).toContainEqual({
        method: 'POST',
        path: '/billing/subscriptions/' + state.subscriptions[0].id + '/cancel',
        body: { reason: 'Cancelamento ficticio da assinatura.' },
      })
    },
  )
}
