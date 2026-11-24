import { expect, test } from '@playwright/test'

for (const status of ['unsubmitted', 'pending'] as const) {
  test(`verificação profissional exibe dados salvos: ${status}`, async ({ page }) => {
    const user = { id: 'coach-1', name: 'João da Silva', email: 'coach@example.com', role: 'coach' }
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/auth/session') return route.fulfill({ json: { user } })
      if (path === '/api/profiles/me') return route.fulfill({ json: { profile: {
        ...user, userId: user.id, city: '', bio: '', sports: [], goals: [], levels: [], availability: [],
        mode: 'online', price: 0, budget: 0, cref: '000123-G/SP', qualification: 'Bacharelado',
        verificationStatus: status, verificationReason: '',
      } } })
      if (path === '/api/verifications') return route.fulfill({ json: { verifications: status === 'unsubmitted' ? [] : [{
        id: 'verification-1', coachId: user.id, coachName: user.name, cref: '000123-G/SP', qualification: 'Bacharelado',
        status, evidence: '', reason: '', documentId: 'document-1',
      }] } })
      return route.fulfill({ json: { notifications: [], unread: 0 } })
    })
    await page.goto('/treinador/perfil')
    await expect(page.getByLabel('Nome do profissional')).toHaveValue(user.name)
    await expect(page.getByLabel('CREF cadastrado')).toHaveValue('000123-G/SP')
    await expect(page.getByText('Formação: Bacharelado', { exact: true })).toBeVisible()
    if (status === 'unsubmitted') {
      await expect(page.getByLabel('CREF', { exact: true })).toHaveValue('000123-G/SP')
      await expect(page.getByRole('combobox', { name: /^Formação profissional/ })).toHaveValue('Bacharelado')
      await expect(page.locator('input[type=file]')).toHaveAttribute('required', '')
      await expect(page.getByRole('button', { name: 'Enviar para análise' })).toBeVisible()
    } else {
      await expect(page.getByRole('button', { name: 'Enviar para análise' })).toHaveCount(0)
      await expect(page.getByText(status === 'pending' ? /Aguarde a confirmação do administrador\. Seu comprovante/ : 'CREF aprovado pelo administrador.', { exact: true })).toBeVisible()
    }
  })
}
