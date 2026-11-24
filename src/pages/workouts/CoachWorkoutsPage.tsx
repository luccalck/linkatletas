import {
  type ExerciseBlock,
  type WorkoutInput,
  type Workout,
  type Contract,
  SPORTS,
} from '../../../shared/contracts'
import { useRemote } from '../../hooks/useRemote'
import { useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { api, json } from '../../services/api'
import { message } from '../../utils/errors'
import { PageTitle } from '../../components/ui/PageTitle'
import { Plus, Trash2, Save, Send } from 'lucide-react'
import { Notice, State, Empty } from '../../components/ui/Feedback'
import { day } from '../../utils/formatters'
import { Badge } from '../../components/ui/Badge'
import { WorkoutDetails } from '../../components/workouts/WorkoutDetails'

const blankBlock = (): ExerciseBlock => ({ name: '', instructions: '' })

function blankWorkout(contractId = ''): WorkoutInput {
  return {
    contractId,
    title: '',
    sport: 'Corrida',
    scheduledDate: new Date().toLocaleDateString('en-CA'),
    instructions: '',
    status: 'draft',
    blocks: [blankBlock()],
  }
}

export function CoachWorkoutsPage() {
  const remote = useRemote<{ workouts: Workout[] }>('/workouts')
  const contracts = useRemote<{ contracts: Contract[] }>('/contracts')
  const [params] = useSearchParams()
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState<WorkoutInput | null>(
    params.get('atleta') ? blankWorkout(params.get('atleta')!) : null,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [view, setView] = useState<string | null>(null)
  const active =
    contracts.data?.contracts.filter((c) => c.status === 'active') || []
  const canWrite = (contractId: string) =>
    !contracts.loading &&
    !contracts.error &&
    active.some((contract) => contract.id === contractId)
  function edit(w: Workout) {
    setEditing(w.id)
    setForm({
      contractId: w.contractId,
      title: w.title,
      sport: w.sport,
      scheduledDate: w.scheduledDate.slice(0, 10),
      instructions: w.instructions,
      status: w.status,
      blocks: w.blocks.map((b) => ({ ...b })),
    })
    setSuccess('')
    setError('')
  }
  function set<K extends keyof WorkoutInput>(key: K, value: WorkoutInput[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f))
  }
  function setBlock<K extends keyof ExerciseBlock>(
    index: number,
    key: K,
    value: ExerciseBlock[K],
  ) {
    if (form)
      set(
        'blocks',
        form.blocks.map((b, i) => (i === index ? { ...b, [key]: value } : b)),
      )
  }
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!form) return
    if (!canWrite(form.contractId)) return
    const submitter = (e.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null
    const status = submitter?.value === 'published' ? 'published' : 'draft'
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      await api(
        editing ? '/workouts/' + editing : '/workouts',
        json(editing ? 'PUT' : 'POST', { ...form, status }),
      )
      setSuccess(
        status === 'published'
          ? 'Treino publicado. O atleta já pode acessá-lo.'
          : 'Rascunho salvo. Publique quando estiver pronto.',
      )
      setForm(null)
      setEditing(null)
      await remote.reload()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <PageTitle
        title="Planeje o próximo passo"
        description="Crie treinos para seus atletas e acompanhe o retorno de cada execução."
        action={
          <button
            className="button button--dark"
            disabled={
              busy || contracts.loading || !!contracts.error || !active.length
            }
            onClick={() => {
              setEditing(null)
              setForm(blankWorkout(active[0]?.id))
              setError('')
              setSuccess('')
            }}
          >
            <Plus size={18} />
            Novo treino
          </button>
        }
      />
      <Notice error={error} success={success} />
      <State {...contracts} retry={contracts.reload} />
      <State {...remote} retry={remote.reload} />
      {contracts.data && !active.length && (
        <Empty>
          Você precisa aceitar uma solicitação de contratação para prescrever
          treinos.
        </Empty>
      )}
      {form && canWrite(form.contractId) && (
        <form
          className="live-panel live-form live-workout-editor"
          onSubmit={save}
        >
          <div className="live-panel-heading">
            <div>
              <h3>{editing ? 'Editar treino' : 'Novo treino'}</h3>
              <p>Adicione instruções claras e os blocos de exercícios.</p>
            </div>
            <button
              type="button"
              className="button button--outline"
              disabled={busy}
              onClick={() => {
                setForm(null)
                setEditing(null)
                setError('')
              }}
            >
              Cancelar edição
            </button>
          </div>
          <div className="live-grid-2">
            <label>
              Título do treino
              <input
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                minLength={3}
                maxLength={160}
                required
              />
            </label>
            <label>
              Atleta
              <select
                value={form.contractId}
                onChange={(e) => set('contractId', e.target.value)}
                disabled={!!editing}
                required
              >
                <option value="">Selecione um atleta</option>
                {active.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.athleteName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Modalidade
              <select
                value={form.sport}
                onChange={(e) => set('sport', e.target.value)}
              >
                {SPORTS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Data do treino
              <input
                type="date"
                value={form.scheduledDate.slice(0, 10)}
                onChange={(e) => set('scheduledDate', e.target.value)}
                required
              />
            </label>
          </div>
          <label>
            Orientações gerais
            <textarea
              rows={3}
              value={form.instructions}
              onChange={(e) => set('instructions', e.target.value)}
              maxLength={3000}
            />
          </label>
          {form.blocks.map((block, index) => (
            <fieldset className="live-block-editor" key={index}>
              <legend>Bloco {index + 1}</legend>
              <div className="live-grid-2">
                <label>
                  Nome do exercício
                  <input
                    minLength={2}
                    value={block.name}
                    onChange={(e) => setBlock(index, 'name', e.target.value)}
                    required
                    maxLength={150}
                  />
                </label>
                <label>
                  Vídeo de referência (URL)
                  <input
                    type="url"
                    value={block.videoUrl || ''}
                    placeholder="https://…"
                    pattern="https://.*"
                    onChange={(e) =>
                      setBlock(index, 'videoUrl', e.target.value || undefined)
                    }
                    maxLength={2000}
                  />
                </label>
              </div>
              <label>
                Instruções do exercício
                <textarea
                  value={block.instructions}
                  onChange={(e) =>
                    setBlock(index, 'instructions', e.target.value)
                  }
                  maxLength={2000}
                  rows={2}
                />
              </label>
              <div className="live-grid-3">
                {(
                  [
                    { key: 'sets', label: 'Séries', step: 1, max: 100 },
                    {
                      key: 'repetitions',
                      label: 'Repetições',
                      step: 1,
                      max: 10000,
                    },
                    {
                      key: 'loadKg',
                      label: 'Carga (kg)',
                      step: 0.1,
                      max: 1000,
                    },
                    {
                      key: 'durationMinutes',
                      label: 'Duração (min)',
                      step: 0.1,
                      max: 1440,
                    },
                    {
                      key: 'distanceKm',
                      label: 'Distância (km)',
                      step: 0.01,
                      max: 1500,
                    },
                  ] as const
                ).map(({ key, label, step, max }) => (
                  <label key={key}>
                    {label}
                    <input
                      type="number"
                      min={key === 'sets' || key === 'repetitions' ? 1 : 0}
                      max={max}
                      step={step}
                      value={block[key] ?? ''}
                      onChange={(e) =>
                        setBlock(
                          index,
                          key,
                          e.target.value === ''
                            ? undefined
                            : Number(e.target.value),
                        )
                      }
                    />
                  </label>
                ))}
              </div>
              {form.blocks.length > 1 && (
                <button
                  className="button button--outline"
                  type="button"
                  onClick={() =>
                    set(
                      'blocks',
                      form.blocks.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Trash2 size={15} />
                  Remover bloco {index + 1}
                </button>
              )}
            </fieldset>
          ))}
          <button
            type="button"
            className="button button--outline"
            disabled={form.blocks.length >= 30}
            onClick={() => set('blocks', [...form.blocks, blankBlock()])}
          >
            <Plus size={16} />
            Adicionar bloco
          </button>
          <div className="live-actions">
            <button
              className="button button--outline"
              value="draft"
              disabled={busy}
            >
              <Save size={17} />
              {busy ? 'Salvando…' : 'Salvar rascunho'}
            </button>
            <button
              className="button button--dark"
              value="published"
              disabled={busy}
            >
              <Send size={17} />
              {busy ? 'Salvando…' : 'Publicar treino'}
            </button>
          </div>
        </form>
      )}
      <div className="live-stack">
        {remote.data && !remote.data.workouts.length && !form && (
          <Empty>
            Nenhum treino prescrito. Crie um treino e salve como rascunho ou
            publique para o atleta.
          </Empty>
        )}
        {remote.data?.workouts.map((w) => (
          <article className="live-panel" key={w.id}>
            <div className="live-panel-heading">
              <div>
                <h3>{w.title}</h3>
                <p>
                  {w.athleteName} · {w.sport} · {day(w.scheduledDate)}
                </p>
              </div>
              <Badge status={w.status} />
            </div>
            <div className="live-actions">
              <button
                className="button button--outline"
                onClick={() => setView(view === w.id ? null : w.id)}
              >
                {view === w.id ? 'Ocultar detalhes' : 'Ver detalhes e execução'}
              </button>
              {!w.execution && canWrite(w.contractId) && (
                <button className="button button--dark" onClick={() => edit(w)}>
                  Editar treino
                </button>
              )}
              {w.execution && (
                <span className="live-badge live-badge--approved">
                  Feedback registrado
                </span>
              )}
            </div>
            {view === w.id && (
              <WorkoutDetails workout={w} allowWrite={canWrite(w.contractId)} />
            )}
          </article>
        ))}
      </div>
    </>
  )
}
