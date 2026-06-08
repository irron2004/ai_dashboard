import type { Task, TaskStatus } from '@apc/shared'

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'To Do' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'review', label: 'Review' },
  { status: 'done', label: 'Done' },
]

type Props = { tasks: Task[] }

export function TaskBoard({ tasks }: Props) {
  return (
    <div className="pm-board">
      {COLUMNS.map(({ status, label }) => {
        const items = tasks.filter((t) => t.status === status)
        return (
          <div key={status} className="pm-board__col" data-testid={`col-${status}`}>
            <h3 className="pm-board__col-title">{label} <span className="pm-board__count">{items.length}</span></h3>
            {items.length === 0 ? (
              <p className="pm-board__empty">—</p>
            ) : (
              items.map((task) => (
                <div key={task.id} className="pm-board__card">
                  <span className="pm-board__card-title">{task.title}</span>
                  <span className="pm-board__card-meta">
                    <span className={`pm-board__priority pm-board__priority--${task.priority}`}>{task.priority}</span>
                    {task.dueDate && <span className="pm-board__due">{task.dueDate}</span>}
                  </span>
                </div>
              ))
            )}
          </div>
        )
      })}
    </div>
  )
}
