import { useAuth } from '../../context/AuthContext'
import { useSearchParams } from 'react-router-dom'
import { useRemote } from '../../hooks/useRemote'
import type { Review } from '../../../shared/interaction-contracts'
import type { Contract } from '../../../shared/contracts'
import { useState } from 'react'
import { message } from '../../utils/errors'
import { PageTitle } from '../../components/ui/PageTitle'
import { Notice, State, Empty } from '../../components/ui/Feedback'
import { Star } from 'lucide-react'
import { api, json } from '../../services/api'
import { dateTime } from '../../utils/formatters'

export function ReviewsPage() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  const coachId = params.get('treinador')
  const remote = useRemote<{
    reviews: Review[]
    average: number
    count: number
  }>('/reviews' + (coachId ? '?coachId=' + coachId : ''))
  const contracts = useRemote<{ contracts: Contract[] }>('/contracts')
  const [form, setForm] = useState({ contractId: '', rating: 5, text: '' })
  const [editing, setEditing] = useState<string | null>(null)
  const [reply, setReply] = useState<Record<string, string>>({})
  const [report, setReport] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const eligible =
    contracts.data?.contracts.filter(
      (c) => c.status === 'active' && (!coachId || c.coachId === coachId),
    ) || []
  const choices = editing
    ? contracts.data?.contracts.filter(
        (contract) => contract.id === form.contractId,
      ) || []
    : eligible
  async function perform(action: () => Promise<unknown>, text: string) {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      await action()
      await remote.reload()
      setSuccess(text)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <PageTitle
        title="Experiências que ajudam a escolher"
        description="Avaliações de atletas vinculados, com espaço para resposta do profissional."
      />
      <Notice error={error} success={success} />
      <State {...remote} retry={remote.reload} />
      {remote.data && (
        <div className="exp-review-summary live-panel">
          <Star size={28} />
          <strong>{Number(remote.data.average || 0).toFixed(1)}</strong>
          <span>{remote.data.count} avaliação(ões) publicada(s)</span>
        </div>
      )}
      {user?.role === 'athlete' && (
        <form
          className="live-panel live-form"
          onSubmit={(e) => {
            e.preventDefault()
            void perform(async () => {
              await api(
                editing ? '/reviews/' + editing : '/reviews',
                json(
                  editing ? 'PUT' : 'POST',
                  editing
                    ? { rating: form.rating, text: form.text }
                    : {
                        ...form,
                        contractId: form.contractId || eligible[0]?.id,
                      },
                ),
              )
              setEditing(null)
              setForm({ contractId: '', rating: 5, text: '' })
            }, 'Avaliação salva.')
          }}
        >
          <h3>
            {editing ? 'Editar sua avaliação' : 'Compartilhe sua experiência'}
          </h3>
          <p>
            Novas avaliações exigem vínculo elegível e o período mínimo definido
            pela plataforma. Cada ciclo de vínculo possui uma avaliação.
          </p>
          <label>
            Treinador
            <select
              required
              disabled={!!editing}
              value={form.contractId || eligible[0]?.id || ''}
              onChange={(e) =>
                setForm((v) => ({ ...v, contractId: e.target.value }))
              }
            >
              {!choices.length && (
                <option value="">Nenhum vínculo ativo</option>
              )}
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.coachName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Nota
            <select
              value={form.rating}
              onChange={(e) =>
                setForm((v) => ({ ...v, rating: Number(e.target.value) }))
              }
            >
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} estrela(s)
                </option>
              ))}
            </select>
          </label>
          <label>
            Sua experiência
            <textarea
              required
              minLength={5}
              maxLength={2000}
              rows={4}
              value={form.text}
              onChange={(e) => setForm((v) => ({ ...v, text: e.target.value }))}
            />
          </label>
          <div className="live-actions">
            <button
              className="button button--dark"
              disabled={busy || (!editing && !eligible.length)}
            >
              <Star size={16} />{' '}
              {editing ? 'Salvar edição' : 'Publicar avaliação'}
            </button>
            {editing && (
              <button
                type="button"
                className="button button--outline"
                onClick={() => {
                  setEditing(null)
                  setForm({ contractId: '', rating: 5, text: '' })
                }}
              >
                Cancelar edição
              </button>
            )}
          </div>
        </form>
      )}
      <div className="live-stack">
        {remote.data?.reviews.map((r) => (
          <article className="live-panel exp-review" key={r.id}>
            <div className="live-panel-heading">
              <div>
                <h3>{r.coachName}</h3>
                <p>
                  {r.athleteName} · {dateTime(r.createdAt)}
                </p>
              </div>
              <span
                aria-label={`${r.rating} de 5 estrelas`}
                className="exp-stars"
              >
                {'★'.repeat(r.rating)}
                {'☆'.repeat(5 - r.rating)}
              </span>
            </div>
            <p className="exp-policy">{r.text}</p>
            {r.reply && (
              <div className="exp-feedback">
                <strong>Resposta do treinador</strong>
                <p>{r.reply}</p>
              </div>
            )}
            <div className="live-actions">
              {r.athleteId === user?.id && (
                <button
                  className="button button--outline"
                  onClick={() => {
                    setEditing(r.id)
                    setForm({
                      contractId: r.contractId,
                      rating: r.rating,
                      text: r.text,
                    })
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                  }}
                >
                  Editar avaliação
                </button>
              )}
              <button
                className="button button--outline"
                onClick={() => {
                  setReport(report === r.id ? null : r.id)
                  setReason('')
                }}
              >
                Denunciar conteúdo
              </button>
            </div>
            {user?.id === r.coachId && (
              <form
                className="live-form exp-inline-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  void perform(
                    () =>
                      api(
                        '/reviews/' + r.id + '/reply',
                        json('POST', { text: reply[r.id] || '' }),
                      ),
                    'Resposta publicada.',
                  )
                }}
              >
                <label>
                  Sua resposta
                  <textarea
                    required
                    minLength={5}
                    maxLength={2000}
                    value={reply[r.id] || ''}
                    onChange={(e) =>
                      setReply((v) => ({ ...v, [r.id]: e.target.value }))
                    }
                  />
                </label>
                <button className="button button--outline" disabled={busy}>
                  Responder avaliação
                </button>
              </form>
            )}
            {report === r.id && (
              <form
                className="live-form exp-inline-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  void perform(async () => {
                    await api(
                      '/reviews/' + r.id + '/report',
                      json('POST', { reason }),
                    )
                    setReport(null)
                  }, 'Denúncia enviada para análise.')
                }}
              >
                <label>
                  Motivo da denúncia
                  <textarea
                    required
                    minLength={5}
                    maxLength={1000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button className="button button--outline" disabled={busy}>
                  Enviar denúncia
                </button>
              </form>
            )}
          </article>
        ))}
        {remote.data && !remote.data.reviews.length && (
          <Empty>Ainda não há avaliações publicadas.</Empty>
        )}
      </div>
    </>
  )
}
