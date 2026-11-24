import type {
  Workout,
  MetricType,
  ExerciseBlock,
} from '../../../shared/contracts'
import { useAuth } from '../../context/AuthContext'
import { useRemote } from '../../hooks/useRemote'
import { MediaPanel } from '../media/MediaPanel'
import { State } from '../ui/Feedback'

export function WorkoutDetails({
  workout: w,
  allowWrite,
}: {
  workout: Workout
  allowWrite: boolean
}) {
  const { user } = useAuth()
  const catalog = useRemote<{ metrics: MetricType[] }>(
    '/metrics?sport=' + encodeURIComponent(w.sport),
  )
  return (
    <div className="live-workout-detail">
      <p>{w.instructions || 'Siga as orientações de cada bloco.'}</p>
      {w.blocks.map((b, i) => (
        <div className="live-exercise" key={i}>
          <span>{String(i + 1).padStart(2, '0')}</span>
          <div>
            <strong>{b.name}</strong>
            <p>{b.instructions}</p>
            <BlockMeta block={b} />
            {b.videoUrl && (
              <p style={{ overflowWrap: 'anywhere' }}>
                Referencia externa (texto): {b.videoUrl}
              </p>
            )}
          </div>
        </div>
      ))}
      <State {...catalog} retry={catalog.reload} />
      {w.execution && (
        <section className="live-execution-summary">
          <h4>Execução do atleta</h4>
          <p>
            {w.execution.completedBlocks.length} de {w.blocks.length} blocos
            realizados · Esforço percebido: {w.execution.effort}/10
          </p>
          <p>{w.execution.notes || 'Sem observações.'}</p>
          <div className="live-tags">
            {Object.entries(w.execution.metrics).map(([key, value]) => {
              const metric = catalog.data?.metrics.find((m) => m.key === key)
              return (
                <span key={key}>
                  {metric?.label || key}: {value}
                  {metric ? ' ' + metric.unit : ''}
                </span>
              )
            })}
          </div>
          <small>
            Atualizado em{' '}
            {new Date(w.execution.updatedAt).toLocaleString('pt-BR')}
          </small>
        </section>
      )}
      <MediaPanel
        key={w.id}
        resourceId={w.id}
        purpose={user?.role === 'coach' ? 'instruction' : 'performance'}
        allowUpload={allowWrite}
      />
    </div>
  )
}

function BlockMeta({ block: b }: { block: ExerciseBlock }) {
  return (
    <div className="live-tags">
      {b.sets != null && <span>{b.sets} séries</span>}
      {b.repetitions != null && <span>{b.repetitions} repetições</span>}
      {b.loadKg != null && <span>{b.loadKg} kg</span>}
      {b.durationMinutes != null && <span>{b.durationMinutes} min</span>}
      {b.distanceKm != null && <span>{b.distanceKm} km</span>}
    </div>
  )
}
