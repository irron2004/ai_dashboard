import type { Task } from '@apc/shared'

export type Axis = { min: number; max: number }

/** Build the timeline axis. Prefer [start, target]; otherwise span the dueDates.
 *  Returns null when fewer than two distinct millisecond values exist (no meaningful range). */
export function timelineAxis(start: string | undefined, target: string | undefined, dueDates: string[]): Axis | null {
  const points = [start, target, ...dueDates]
    .filter((d): d is string => !!d)
    .map((d) => Date.parse(d))
    .filter((ms) => !Number.isNaN(ms))
  const distinct = Array.from(new Set(points))
  if (distinct.length < 2) return null
  if (start && target) {
    const a = Date.parse(start); const b = Date.parse(target)
    if (!Number.isNaN(a) && !Number.isNaN(b) && a !== b) return { min: Math.min(a, b), max: Math.max(a, b) }
  }
  return { min: Math.min(...distinct), max: Math.max(...distinct) }
}

/** Position of a date on the axis as a clamped 0–100 percentage. */
export function datePct(date: string, axis: Axis): number {
  const ms = Date.parse(date)
  if (Number.isNaN(ms)) return 0
  const pct = ((ms - axis.min) / (axis.max - axis.min)) * 100
  return Math.max(0, Math.min(100, pct))
}

type Props = { start?: string; target?: string; tasks: Task[] }

export function TimelineStrip({ start, target, tasks }: Props) {
  const dued = tasks.filter((t) => !!t.dueDate)
  const axis = timelineAxis(start, target, dued.map((t) => t.dueDate as string))
  if (!axis) return <p className="pm-timeline__empty">일정 정보 없음</p>

  return (
    <div className="pm-timeline">
      <div className="pm-timeline__track">
        {dued.map((task) => (
          <span
            key={task.id}
            className="pm-timeline__marker"
            title={task.title}
            aria-label={`${task.title} due ${task.dueDate}`}
            style={{ left: `${datePct(task.dueDate as string, axis)}%` }}
          />
        ))}
      </div>
      <div className="pm-timeline__labels">
        {start && <span>{start}</span>}
        {target && <span style={{ marginLeft: 'auto' }}>{target}</span>}
      </div>
    </div>
  )
}
