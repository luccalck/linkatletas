import { useRemote } from '../../hooks/useRemote'
import type { Verification } from '../../../shared/contracts'
import { useState } from 'react'
import { api, json } from '../../services/api'
import { message } from '../../utils/errors'
import { PageTitle } from '../../components/ui/PageTitle'
import { Notice, State, Empty } from '../../components/ui/Feedback'
import { Badge } from '../../components/ui/Badge'

export function AdminPage() {
  const remote = useRemote<{ verifications: Verification[] }>(
    '/admin/verifications',
  )
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [expirations, setExpirations] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  async function review(id: string, status: 'approved' | 'rejected') {
    setBusy(id)
    setError('')
    setSuccess('')
    if ((reasons[id] || '').trim().length < 5) {
      setError(
        'Informe uma justificativa de pelo menos 5 caracteres para registrar a análise.',
      )
      setBusy('')
      return
    }
    try {
      await api(
        '/admin/verifications/' + id,
        json('PATCH', {
          status,
          reason: reasons[id] || '',
          ...(status === 'approved' && expirations[id]
            ? {
                expiresAt: new Date(
                  expirations[id] + 'T23:59:59',
                ).toISOString(),
              }
            : {}),
        }),
      )
      setSuccess(
        status === 'approved'
          ? 'Profissional aprovado.'
          : 'Solicitação recusada com justificativa.',
      )
      await remote.reload()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy('')
    }
  }
  async function suspend(
    v: Verification,
    status: 'suspended' | 'rejected',
  ) {
    if ((reasons[v.id] || '').trim().length < 5) {
      setError('Informe uma justificativa de pelo menos 5 caracteres.')
      return
    }
    if (
      !window.confirm(
        status === 'suspended'
          ? 'Suspender este profissional e remover seu perfil da descoberta?'
          : 'Revogar a aprovação deste profissional?',
      )
    )
      return
    setBusy(v.id)
    setError('')
    setSuccess('')
    try {
      await api(
        '/admin/coaches/' + v.coachId + '/verification',
        json('PATCH', { status, reason: reasons[v.id] }),
      )
      await remote.reload()
      setSuccess('Decisão profissional registrada com auditoria.')
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy('')
    }
  }
  return (
    <>
      <PageTitle
        title="Confiança começa com verificação"
        description="Revise o registro e a evidência profissional antes de aprovar o treinador."
      />
      <Notice error={error} success={success} />
      <State {...remote} retry={remote.reload} />
      <div className="live-stack">
        {remote.data && !remote.data.verifications.length && (
          <Empty>Nenhum registro para analisar no momento.</Empty>
        )}
        {remote.data?.verifications.map((v) => (
          <article className="live-panel" key={v.id}>
            <div className="live-panel-heading">
              <div>
                <h3>{v.coachName}</h3>
                <p>CREF {v.cref}</p>
                {v.qualification && <p>Formação: {v.qualification}</p>}
              </div>
              <Badge status={v.currentStatus || v.status} />
            </div>
            <p className="live-muted">
              Resultado desta solicitacao: <Badge status={v.status} />
            </p>
            <p className="live-evidence">{v.evidence}</p>
            {v.currentReason && v.currentReason !== v.reason && (
              <p>Situacao atual: {v.currentReason}</p>
            )}
            {v.documentId && (
              <a
                className="button button--outline"
                href={'/api/media/' + v.documentId + '/content'}
                target="_blank"
                rel="noreferrer"
              >
                Conferir documento privado
              </a>
            )}
            {v.expiresAt && (
              <p className="live-muted">
                Validade: {new Date(v.expiresAt).toLocaleDateString('pt-BR')} ·
                Origem{' '}
                {v.source === 'manual'
                  ? 'conferência manual'
                  : v.source || 'manual'}
              </p>
            )}
            {v.status === 'pending' ? (
              <>
                <label className="live-field">
                  Justificativa da análise
                  <textarea
                    value={reasons[v.id] || ''}
                    onChange={(e) =>
                      setReasons({ ...reasons, [v.id]: e.target.value })
                    }
                    maxLength={1000}
                    placeholder="Obrigatória para aprovar ou recusar (mínimo 5 caracteres)."
                  />
                </label>
                <label className="live-field">
                  Validade da aprovação (opcional)
                  <input
                    type="date"
                    value={expirations[v.id] || ''}
                    min={new Date().toLocaleDateString('en-CA')}
                    onChange={(e) =>
                      setExpirations((value) => ({
                        ...value,
                        [v.id]: e.target.value,
                      }))
                    }
                  />
                </label>
                <div className="live-actions">
                  <button
                    className="button button--dark"
                    disabled={!!busy}
                    onClick={() => review(v.id, 'approved')}
                  >
                    Aprovar
                  </button>
                  <button
                    className="button button--outline"
                    disabled={!!busy}
                    onClick={() => review(v.id, 'rejected')}
                  >
                    Recusar
                  </button>
                </div>
              </>
            ) : (
              <p>{v.reason || 'Registro aprovado.'}</p>
            )}
            {v.status === 'approved' &&
              (!v.currentStatus ||
                ['approved', 'suspended', 'expired'].includes(v.currentStatus)) && (
                <div className="live-form exp-inline-form">
                  <label>
                    Justificativa da suspensão ou revogação
                    <textarea
                      minLength={5}
                      maxLength={1000}
                      value={reasons[v.id] || ''}
                      onChange={(e) =>
                        setReasons((value) => ({
                          ...value,
                          [v.id]: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <div className="live-actions">
                    <button
                      className="button button--outline"
                      disabled={!!busy || v.currentStatus === 'suspended'}
                      onClick={() => void suspend(v, 'suspended')}
                    >
                      Suspender profissional
                    </button>
                    <button
                      className="button button--outline"
                      disabled={!!busy}
                      onClick={() => void suspend(v, 'rejected')}
                    >
                      Revogar aprovação
                    </button>
                  </div>
                </div>
            )}
          </article>
        ))}
      </div>
    </>
  )
}
