import { useRemote } from '../../hooks/useRemote'
import type { BillingConfig } from '../../../shared/billing-contracts'
import { useState, useEffect } from 'react'
import { PageTitle } from '../../components/ui/PageTitle'
import { State, Notice } from '../../components/ui/Feedback'
import { EnvironmentNotice } from './FinancePage'
import { api, json } from '../../services/api'
import { message } from '../../utils/errors'
import { Save } from 'lucide-react'

export function AdminBillingPage() {
  const config = useRemote<BillingConfig>('/billing/config')
  const [commission, setCommission] = useState(0)
  const [grace, setGrace] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const unavailable = busy || config.loading || !!config.error || !config.data
  useEffect(() => {
    if (config.data) {
      setCommission(config.data.commissionBps / 100)
      setGrace(config.data.graceDays)
    }
  }, [config.data])
  return (
    <>
      <PageTitle
        title="Regras financeiras da plataforma"
        description="Comissão e período de carência registrados para as novas operações."
      />
      <State {...config} retry={config.reload} />
      {config.data && <EnvironmentNotice config={config.data} />}
      <form
        className="live-panel live-form"
        onSubmit={async (e) => {
          e.preventDefault()
          if (unavailable) return
          setBusy(true)
          setError('')
          setSuccess('')
          try {
            await api(
              '/admin/billing/settings',
              json('PATCH', {
                commissionBps: Math.round(commission * 100),
                graceDays: grace,
              }),
            )
            await config.reload()
            setSuccess('Configuração financeira atualizada.')
          } catch (e) {
            setError(message(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        <label>
          Comissão da plataforma (%)
          <input
            required
            type="number"
            disabled={unavailable}
            min={0}
            max={50}
            step="0.01"
            value={commission}
            onChange={(e) => setCommission(Number(e.target.value))}
          />
        </label>
        <label>
          Carência após vencimento (dias)
          <input
            required
            type="number"
            disabled={unavailable}
            min={0}
            max={30}
            step={1}
            value={grace}
            onChange={(e) => setGrace(Number(e.target.value))}
          />
        </label>
        <Notice error={error} success={success} />
        <button className="button button--dark" disabled={unavailable}>
          <Save size={16} /> Salvar regras financeiras
        </button>
      </form>
    </>
  )
}
