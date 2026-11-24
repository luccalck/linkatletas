import type { Profile, Verification } from '../../../shared/contracts'
import { useAuth } from '../../context/AuthContext'
import { useRemote } from '../../hooks/useRemote'
import { useEffect, useState } from 'react'
import { uploadFile } from '../../services/media'
import { api, json } from '../../services/api'
import { message } from '../../utils/errors'
import { ShieldCheck } from 'lucide-react'
import { State, Notice } from '../../components/ui/Feedback'
import { Badge } from '../../components/ui/Badge'

export function VerificationForm({
  onChange,
  profile,
}: {
  onChange: () => unknown
  profile: Profile
}) {
  const { user } = useAuth()
  const remote = useRemote<{ verifications: Verification[] }>(
    '/verifications',
  )
  const [cref, setCref] = useState(profile.cref)
  useEffect(() => {
    setCref(profile.cref)
  }, [profile.cref])
  const [evidence, setEvidence] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [documentId, setDocumentId] = useState<string | null>(null)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      let document = documentId
      if (file && !document && user) {
        document = (await uploadFile(file, 'verification', user.id)).media.id
        setDocumentId(document)
      }
      await api(
        '/verifications',
        json('POST', {
          cref,
          evidence,
          ...(document ? { documentId: document } : {}),
        }),
      )
      setSuccess('Credenciais enviadas. Aguarde a análise do administrador.')
      await remote.reload()
      onChange()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  const pending = remote.data?.verifications.some((v) => v.status === 'pending')
  const approved = profile.verificationStatus === 'approved'
  return (
    <section className="live-panel">
      <div className="live-panel-heading">
        <div>
          <h3>
            <ShieldCheck size={21} /> Verificação profissional
          </h3>
          <p>Seu perfil aparece na busca após a aprovação manual do CREF.</p>
        </div>
      </div>
      <div className="live-form live-grid-2">
        <label>Nome do profissional<input value={profile.name} readOnly /></label>
        <label>CREF cadastrado<input value={profile.cref || 'Não informado'} readOnly /></label>
      </div>
      <State {...remote} retry={remote.reload} />
      {remote.data?.verifications.map((v) => (
        <article className="live-row" key={v.id}>
          <div>
            <strong>{v.cref}</strong>
            <p>{v.reason || 'Solicitação enviada para análise.'}</p>
            {v.expiresAt && (
              <small>
                Validade: {new Date(v.expiresAt).toLocaleDateString('pt-BR')}
              </small>
            )}
            {v.documentId && (
              <a
                className="live-link"
                href={'/api/media/' + v.documentId + '/content'}
                target="_blank"
                rel="noreferrer"
              >
                Abrir documento privado
              </a>
            )}
          </div>
          <Badge status={v.status} />
        </article>
      ))}
      {!approved && (
        <form onSubmit={submit} className="live-form">
          <label>
            CREF
            <input
              value={cref}
              placeholder="Ex.: 012345-G/SC"
              required
              minLength={4}
              maxLength={50}
              onChange={(e) => setCref(e.target.value)}
            />
          </label>
          <label>
            Evidência profissional
            <textarea
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              required
              minLength={10}
              maxLength={2000}
              placeholder="Informe o link público de consulta ao registro e informações para verificação."
              rows={3}
            />
          </label>
          <p className="live-muted">
            Complete seu perfil antes de enviar. Use apenas informações
            profissionais. A evidência é revisada pelo administrador.
          </p>
          <label>
            Documento profissional privado (opcional)
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null)
                setDocumentId(null)
              }}
            />
          </label>
          <Notice error={error} success={success} />
          <button className="button button--dark" disabled={busy || pending}>
            {pending
              ? 'Análise em andamento'
              : busy
                ? 'Enviando…'
                : 'Enviar para análise'}
          </button>
        </form>
      )}
    </section>
  )
}
