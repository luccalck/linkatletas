import { useAuth } from '../../context/AuthContext'
import { useRemote } from '../../hooks/useRemote'
import { type MediaItem, uploadFile } from '../../services/media'
import { useState, type FormEvent } from 'react'
import { message } from '../../utils/errors'
import { FileUp, Trash2 } from 'lucide-react'
import { State, Notice } from '../ui/Feedback'
import { api, json } from '../../services/api'
import { Link } from 'react-router-dom'

export function MediaPanel({
  resourceId,
  purpose,
  allowUpload = true,
}: {
  resourceId: string
  purpose: 'instruction' | 'performance' | 'message' | 'verification'
  allowUpload?: boolean
}) {
  const { user } = useAuth()
  const remote = useRemote<{ media: MediaItem[] }>(
    '/media?resourceId=' + resourceId,
  )
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  async function perform(action: () => Promise<unknown>, successText: string) {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      await action()
      await remote.reload()
      setSuccess(successText)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!file) return
    const form = e.currentTarget
    await perform(async () => {
      await uploadFile(file, purpose, resourceId)
      setFile(null)
      form.reset()
    }, 'Arquivo enviado com sucesso.')
  }
  return (
    <section className="exp-media">
      <h4>
        <FileUp size={18} /> Arquivos e correções
      </h4>
      <p className="live-muted">
        Arquivos privados compartilhados com as pessoas deste vínculo. Imagens e
        PDF até 10 MiB; vídeos até 50 MiB.
      </p>
      <State {...remote} retry={remote.reload} />
      <Notice error={error} success={success} />
      {remote.data?.media.map((m) => (
        <article className="exp-media-item" key={m.id}>
          <div className="live-panel-heading">
            <a
              className="live-link"
              href={'/api/media/' + m.id + '/content'}
              target="_blank"
              rel="noreferrer"
            >
              {m.name}
            </a>
            <small>{(m.size / 1024 / 1024).toFixed(2)} MiB</small>
          </div>
          {m.mimeType.startsWith('video/') && (
            <video
              controls
              preload="none"
              src={'/api/media/' + m.id + '/content'}
              aria-label={'Vídeo ' + m.name}
            />
          )}
          {m.feedback?.map((f) => (
            <div className="exp-feedback" key={f.id}>
              <strong>{f.authorName || 'Feedback'}</strong>
              <p>{f.text}</p>
            </div>
          ))}
          {allowUpload &&
            user?.role === 'coach' &&
            m.purpose === 'performance' && (
              <form
                className="live-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  void perform(async () => {
                    await api(
                      '/media/' + m.id + '/feedback',
                      json('POST', { text: text[m.id] }),
                    )
                    setText((v) => ({ ...v, [m.id]: '' }))
                  }, 'Correção registrada.')
                }}
              >
                <label>
                  Comentário sobre {m.name}
                  <textarea
                    required
                    minLength={2}
                    maxLength={2000}
                    rows={2}
                    value={text[m.id] || ''}
                    onChange={(e) =>
                      setText((v) => ({ ...v, [m.id]: e.target.value }))
                    }
                  />
                </label>
                <div className="live-actions">
                  <button className="button button--outline" disabled={busy}>
                    Enviar correção técnica
                  </button>
                </div>
              </form>
            )}
          {m.ownerId === user?.id && (
            <button
              type="button"
              className="button button--outline"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Excluir este arquivo privado?'))
                  void perform(
                    () => api('/media/' + m.id, { method: 'DELETE' }),
                    'Arquivo excluído.',
                  )
              }}
            >
              <Trash2 size={16} /> Excluir arquivo
            </button>
          )}
        </article>
      ))}
      {remote.data && !remote.data.media.length && (
        <p className="live-muted">Nenhum arquivo enviado para este recurso.</p>
      )}
      {allowUpload && (
        <form onSubmit={upload} className="live-form exp-upload">
          <label>
            Arquivo privado
            <input
              type="file"
              required
              accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4,video/webm"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          {purpose === 'performance' && (
            <p className="live-muted">
              Autorize a coleta de performance em{' '}
              <Link
                to={
                  user?.role === 'coach'
                    ? '/treinador/privacidade'
                    : '/atleta/privacidade'
                }
              >
                Privacidade
              </Link>{' '}
              antes de enviar seu vídeo.
            </p>
          )}
          <button className="button button--outline" disabled={busy || !file}>
            <FileUp size={16} /> {busy ? 'Enviando…' : 'Enviar arquivo'}
          </button>
        </form>
      )}
    </section>
  )
}
