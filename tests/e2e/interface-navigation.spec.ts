import { expect, test } from '@playwright/test'
import { installWebFixture, webFixture } from './helpers/web-fixture.js'

const pages = {
  athlete: [
    '/atleta',
    '/atleta/descobrir',
    '/atleta/conexoes',
    '/atleta/treino',
    '/atleta/perfil',
    '/atleta/mensagens',
    '/atleta/agenda',
    '/atleta/financeiro',
    '/atleta/avaliacoes',
    '/atleta/notificacoes',
    '/atleta/privacidade',
  ],
  coach: [
    '/treinador',
    '/treinador/alunos',
    '/treinador/treinos',
    '/treinador/perfil',
    '/treinador/mensagens',
    '/treinador/consultorias',
    '/treinador/agenda',
    '/treinador/financeiro',
    '/treinador/avaliacoes',
    '/treinador/notificacoes',
    '/treinador/privacidade',
  ],
  admin: [
    '/admin',
    '/admin/avaliacoes',
    '/admin/financeiro',
    '/admin/notificacoes',
    '/admin/privacidade',
  ],
}

for (const role of ['athlete', 'coach', 'admin'] as const) {
  test('navegacao completa e responsiva de ' + role, async ({ page }) => {
    const state = webFixture(role),
      errors: string[] = []
    await installWebFixture(page, state)
    page.on('pageerror', (error) => errors.push(error.message))
    for (const route of pages[role]) {
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.goto(route)
      await expect(page).toHaveURL(new RegExp(route + '$'))
      await expect(
        page.locator('main').getByRole('heading').first(),
      ).toBeVisible()
      await expect(page.getByRole('alert')).toHaveCount(0)
      const links = await page
        .locator('aside a[href]')
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('href')),
        )
      expect(links.every((link) => pages[role].includes(link ?? ''))).toBe(true)
      await page.setViewportSize({ width: 390, height: 844 })
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        )
        .toBe(true)
    }
    await page.goto(role === 'admin' ? '/atleta' : '/admin')
    await expect(page).toHaveURL(new RegExp(pages[role][0] + '$'))
    expect(state.unhandled).toEqual([])
    expect(errors).toEqual([])
  })
}

test('visitante navega pelo site e chega ao cadastro de treinador com o perfil correto', async ({
  page,
}) => {
  const state = webFixture('coach')
  state.loggedIn = false
  await installWebFixture(page, state)
  for (const route of [
    '/',
    '/login',
    '/cadastro',
    '/recuperar-senha',
    '/redefinir-senha#token=' + 'a'.repeat(64),
  ]) {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(route)
    await expect(
      page.locator('main').getByRole('heading').first(),
    ).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      )
      .toBe(true)
  }
  await page.goto('/')
  const question = page.getByRole('button', {
    name: /Preciso ser atleta profissional/,
  })
  const before = await question.getAttribute('aria-expanded')
  await question.click()
  await expect(question).toHaveAttribute(
    'aria-expanded',
    before === 'true' ? 'false' : 'true',
  )
  await page
    .getByRole('link', { name: 'Perguntas frequentes', exact: true })
    .click()
  await expect(page).toHaveURL(/#perguntas$/)
  await page
    .getByRole('link', { name: 'Quero treinar atletas', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Criar cadastro', exact: true })
    .click()
  await page
    .getByLabel('Nome completo', { exact: true })
    .fill('Treinador de demonstracao')
  await page
    .getByLabel('E-mail', { exact: true })
    .fill('visitante@example.invalid')
  await page.getByLabel('Senha', { exact: true }).fill('SenhaJornada123!')
  let submitted: Record<string, unknown> | undefined
  await page.route('**/api/auth/register', (route) => {
    submitted = route.request().postDataJSON()
    state.loggedIn = true
    return route.fulfill({ status: 201, json: { user: state.user } })
  })
  await page
    .getByRole('button', { name: 'Criar minha conta', exact: true })
    .click()
  await expect(page).toHaveURL(/\/treinador$/)
  expect(submitted).toMatchObject({
    role: 'coach',
    name: 'Treinador de demonstracao',
    email: 'visitante@example.invalid',
  })
  expect(state.unhandled).toEqual([])
})
