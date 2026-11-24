import type { AppUser, Role } from '../../shared/contracts'
import {
  createContext,
  type ReactNode,
  useState,
  useEffect,
  useContext,
} from 'react'
import { api, json } from '../services/api'

interface AuthContextValue {
  user: AppUser | null
  loading: boolean
  error: string
  login: (email: string, password: string, role?: Role) => Promise<AppUser>
  register: (
    name: string,
    email: string,
    password: string,
    role: 'athlete' | 'coach',
  ) => Promise<AppUser>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  updateName: (name: string) => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export const homeFor = (role: Role) =>
  role === 'admin' ? '/admin' : role === 'coach' ? '/treinador' : '/atleta'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  async function refresh() {
    setLoading(true)
    setError('')
    try {
      const data = await api<{ user: AppUser | null }>('/auth/session')
      setUser(data.user)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao recuperar sessão.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    localStorage.removeItem('linkatletas.session')
    void refresh()
  }, [])
  async function login(email: string, password: string) {
    const data = await api<{ user: AppUser }>(
      '/auth/login',
      json('POST', { email, password }),
    )
    setUser(data.user)
    setError('')
    return data.user
  }
  async function register(
    name: string,
    email: string,
    password: string,
    role: 'athlete' | 'coach',
  ) {
    const data = await api<{ user: AppUser }>(
      '/auth/register',
      json('POST', { name, email, password, role }),
    )
    setUser(data.user)
    setError('')
    return data.user
  }
  async function logout() {
    await api('/auth/logout', json('POST', {}))
    setUser(null)
  }
  function updateName(name: string) {
    setUser((current) => (current ? { ...current, name } : null))
  }
  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        login,
        register,
        logout,
        refresh,
        updateName,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('AuthProvider ausente')
  return value
}
