import { useRemote } from '../../hooks/useRemote'
import type { Contract, Workout } from '../../../shared/contracts'
import { useState, useEffect } from 'react'
import { PageTitle } from '../../components/ui/PageTitle'
import { State, Notice, Empty } from '../../components/ui/Feedback'
import { day } from '../../utils/formatters'
import { Badge } from '../../components/ui/Badge'
import { WorkoutDetails } from '../../components/workouts/WorkoutDetails'
import { ExecutionForm } from './ExecutionForm'

export function AthleteWorkoutsPage() {
  const remote = useRemote<{ workouts: Workout[] }>('/workouts')
  const contracts = useRemote<{ contracts: Contract[] }>('/contracts')
  const [selected, setSelected] = useState('')
  const [executing, setExecuting] = useState(false)
  const [success, setSuccess] = useState('')
  const w =
    remote.data?.workouts.find((w) => w.id === selected) ||
    remote.data?.workouts[0]
  const active =
    !contracts.loading &&
    !contracts.error &&
    !!contracts.data?.contracts.some(
      (contract) =>
        contract.id === w?.contractId && contract.status === 'active',
    )
  useEffect(() => {
    setExecuting(false)
  }, [selected, active])
  return (
    <>
      <PageTitle
        title="Seu treino, sua evolução"
        description="Confira as orientações, realize os exercícios e conte ao treinador como foi."
      />
      <State {...remote} retry={remote.reload} />
      <State {...contracts} retry={contracts.reload} />
      <Notice success={success} />
      {remote.data && !remote.data.workouts.length && (
        <Empty>
          Você ainda não possui treinos publicados. Aguarde a prescrição do seu
          treinador.
        </Empty>
      )}
      {!!remote.data?.workouts.length && w && (
        <>
          <label className="live-field live-panel">
            Treino selecionado
            <select
              value={w.id}
              onChange={(e) => {
                setSelected(e.target.value)
                setSuccess('')
              }}
            >
              {remote.data.workouts.map((item) => (
                <option key={item.id} value={item.id}>
                  {day(item.scheduledDate)} · {item.title}
                  {item.execution ? ' · Feedback registrado' : ''}
                </option>
              ))}
            </select>
          </label>
          <section className="live-panel">
            <div className="live-panel-heading">
              <div>
                <h3>{w.title}</h3>
                <p>
                  {w.sport} · {day(w.scheduledDate)} · Treinador: {w.coachName}
                </p>
              </div>
              <Badge status={w.status} />
            </div>
            <WorkoutDetails workout={w} allowWrite={active} />
            {active && (
              <button
                className="button button--dark"
                onClick={() => setExecuting(!executing)}
              >
                {executing
                  ? 'Fechar registro'
                  : w.execution
                    ? 'Atualizar execução'
                    : 'Registrar execução'}
              </button>
            )}
            {!active && !contracts.loading && !contracts.error && (
              <p className="live-muted">
                Historico preservado. Novos registros e arquivos exigem vinculo
                ativo.
              </p>
            )}
          </section>
          {executing && active && (
            <ExecutionForm
              key={w.id}
              workout={w}
              onSave={async () => {
                await remote.reload()
                setExecuting(false)
                setSuccess('Execução registrada com sucesso.')
              }}
            />
          )}
        </>
      )}
    </>
  )
}
