export type Role = 'athlete' | 'coach' | 'admin'
export type Mode = 'online' | 'presencial' | 'hibrido'
export type VerificationStatus =
  'unsubmitted' | 'pending' | 'approved' | 'rejected' | 'suspended' | 'expired'
export type ContractStatus =
  'pending' | 'active' | 'rejected' | 'cancelled' | 'suspended'
export const SPORTS = [
  'Corrida',
  'Musculação',
  'Natação',
  'Ciclismo',
  'Triatlo',
] as const
export const LEVELS = ['Iniciante', 'Intermediário', 'Avançado'] as const
export const SLOTS = [
  'Segunda manhã',
  'Segunda noite',
  'Terça manhã',
  'Terça noite',
  'Quarta manhã',
  'Quarta noite',
  'Quinta manhã',
  'Quinta noite',
  'Sexta manhã',
  'Sexta noite',
  'Sábado manhã',
  'Domingo manhã',
] as const
export const GOALS = [
  'Condicionamento',
  'Performance',
  'Emagrecimento',
  'Força',
  'Competição',
] as const
export interface AppUser {
  id: string
  name: string
  email: string
  role: Role
}
export interface ProfileInput {
  name: string
  city: string
  bio: string
  sports: string[]
  goals: string[]
  levels: string[]
  availability: string[]
  mode: Mode
  budget: number
  price: number
}
export interface Profile extends ProfileInput {
  userId: string
  role: Role
  email: string
  cref: string
  qualification?: string
  verificationStatus: VerificationStatus
  verificationReason: string
  verificationExpiresAt?: string | null
}
export interface CoachCard extends Omit<Profile, 'email' | 'budget' | 'role'> {
  score: number
  reasons: string[]
}
export interface Verification {
  id: string
  coachId: string
  coachName: string
  cref: string
  qualification?: string
  evidence: string
  status: 'pending' | 'approved' | 'rejected'
  reason: string
  submittedAt: string
  reviewedAt: string | null
  reviewerId: string | null
  documentId?: string | null
  expiresAt?: string | null
  source?: string
  currentStatus?: VerificationStatus
  currentReason?: string
}
export interface Contract {
  id: string
  athleteId: string
  coachId: string
  athleteName: string
  coachName: string
  status: ContractStatus
  createdAt: string
  decidedAt: string | null
}
export interface ExerciseBlock {
  name: string
  instructions: string
  sets?: number
  repetitions?: number
  loadKg?: number
  durationMinutes?: number
  distanceKm?: number
  videoUrl?: string
}
export interface WorkoutInput {
  contractId: string
  title: string
  sport: string
  scheduledDate: string
  instructions: string
  status: 'draft' | 'published'
  blocks: ExerciseBlock[]
}
export interface ExecutionInput {
  completedBlocks: number[]
  effort: number
  notes: string
  metrics: Record<string, number>
}
export interface Execution extends ExecutionInput {
  id: string
  updatedAt: string
}
export interface Workout extends WorkoutInput {
  id: string
  coachId: string
  athleteId: string
  coachName: string
  athleteName: string
  createdAt: string
  execution: Execution | null
}
export interface MetricType {
  sport: string
  key: string
  label: string
  unit: string
  min: number
  max: number
}
export interface Dashboard {
  contracts: Contract[]
  workouts: Workout[]
}
export interface ApiErrorBody {
  code: string
  message: string
  fields?: Record<string, string[]>
}
