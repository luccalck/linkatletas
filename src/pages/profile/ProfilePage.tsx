import { useAuth } from '../../context/AuthContext'
import { useRemote } from '../../hooks/useRemote'
import {
  type Profile,
  type ProfileInput,
  SPORTS,
  GOALS,
  LEVELS,
  SLOTS,
} from '../../../shared/contracts'
import { useState, useEffect } from 'react'
import { api, json } from '../../services/api'
import { message } from '../../utils/errors'
import { PageTitle } from '../../components/ui/PageTitle'
import { State, Notice } from '../../components/ui/Feedback'
import { Badge } from '../../components/ui/Badge'
import { Save } from 'lucide-react'
import { VerificationForm } from '../verification/VerificationForm'

function Choices({
  legend,
  values,
  selected,
  onChange,
}: {
  legend: string
  values: readonly string[]
  selected: string[]
  onChange: (v: string[]) => void
}) {
  return (
    <fieldset className="live-choices">
      <legend>{legend}</legend>
      <div>
        {values.map((value) => (
          <label
            key={value}
            className={selected.includes(value) ? 'selected' : ''}
          >
            <input
              type="checkbox"
              checked={selected.includes(value)}
              onChange={() =>
                onChange(
                  selected.includes(value)
                    ? selected.filter((v) => v !== value)
                    : [...selected, value],
                )
              }
            />
            {value}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function ProfilePage() {
  const { user } = useAuth()
  const remote = useRemote<{ profile: Profile }>('/profiles/me')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  useEffect(() => {
    if (remote.data) setProfile(remote.data.profile)
  }, [remote.data])
  function set<K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) {
    setProfile((p) => (p ? { ...p, [key]: value } : p))
    setSuccess('')
  }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!profile) return
    setBusy(true)
    setError('')
    setSuccess('')
    const {
      name,
      city,
      bio,
      sports,
      goals,
      levels,
      availability,
      mode,
      budget,
      price,
    } = profile
    try {
      const data = await api<{ profile: Profile }>(
        '/profiles/me',
        json('PUT', {
          name,
          city,
          bio,
          sports,
          goals,
          levels,
          availability,
          mode,
          budget,
          price,
        }),
      )
      setProfile(data.profile)
      setSuccess('Perfil salvo com sucesso.')
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <PageTitle
        title={
          user?.role === 'coach'
            ? 'Seu perfil profissional'
            : 'Um perfil que combina com você'
        }
        description="Seus objetivos e sua disponibilidade ajudam a construir conexões mais relevantes."
      />
      <State {...remote} retry={remote.reload} />
      {profile && !remote.error && (
        <div className="live-stack">
          <form className="live-panel live-form" onSubmit={save}>
            <div className="live-panel-heading">
              <div>
                <h3>Informações do perfil</h3>
                <p>{profile.email}</p>
              </div>
              {user?.role === 'coach' && (
                <Badge status={profile.verificationStatus} />
              )}
            </div>
            <div className="live-grid-2">
              <label>
                Nome completo
                <input
                  value={profile.name}
                  minLength={2}
                  maxLength={100}
                  required
                  onChange={(e) => set('name', e.target.value)}
                />
              </label>
              <label>
                Cidade
                <input
                  value={profile.city}
                  maxLength={100}
                  onChange={(e) => set('city', e.target.value)}
                />
              </label>
            </div>
            <label>
              Sobre você
              <textarea
                value={profile.bio}
                maxLength={2000}
                rows={3}
                onChange={(e) => set('bio', e.target.value)}
              />
            </label>
            <Choices
              legend="Modalidades"
              values={SPORTS}
              selected={profile.sports}
              onChange={(v) => set('sports', v)}
            />
            <Choices
              legend="Objetivos"
              values={GOALS}
              selected={profile.goals}
              onChange={(v) => set('goals', v)}
            />
            <Choices
              legend={
                user?.role === 'coach' ? 'Níveis que atende' : 'Seu nível'
              }
              values={LEVELS}
              selected={profile.levels}
              onChange={(v) => set('levels', v)}
            />
            <Choices
              legend="Disponibilidade"
              values={SLOTS}
              selected={profile.availability}
              onChange={(v) => set('availability', v)}
            />
            <div className="live-grid-2">
              <label>
                Formato de atendimento
                <select
                  value={profile.mode}
                  onChange={(e) =>
                    set('mode', e.target.value as Profile['mode'])
                  }
                >
                  <option value="online">Online</option>
                  <option value="presencial">Presencial</option>
                  <option value="hibrido">Híbrido</option>
                </select>
              </label>
              {user?.role === 'coach' ? (
                <label>
                  Preço mensal (R$)
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    step="0.01"
                    value={profile.price}
                    onChange={(e) => set('price', Number(e.target.value))}
                  />
                </label>
              ) : (
                <label>
                  Orçamento mensal (R$)
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    step="0.01"
                    value={profile.budget}
                    onChange={(e) => set('budget', Number(e.target.value))}
                  />
                </label>
              )}
            </div>
            <Notice error={error} success={success} />
            <button className="button button--dark" disabled={busy}>
              <Save size={17} />
              {busy ? 'Salvando…' : 'Salvar perfil'}
            </button>
          </form>
          {user?.role === 'coach' && (
            <VerificationForm
              onChange={remote.reload}
              profile={remote.data?.profile || profile}
            />
          )}
        </div>
      )}
    </>
  )
}
