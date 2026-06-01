import type { Project } from '@apc/shared'

type Props = {
  projects: Project[]
  selectedProjectId: string | null
  onSelect: (projectId: string) => void
}

function groupByStatus(projects: Project[]): Record<string, Project[]> {
  const groups: Record<string, Project[]> = {}
  for (const p of projects) {
    if (!groups[p.status]) groups[p.status] = []
    groups[p.status].push(p)
  }
  return groups
}

export function ProjectSidebar({ projects, selectedProjectId, onSelect }: Props) {
  const groups = groupByStatus(projects)

  return (
    <nav className="project-sidebar">
      <h2>Projects</h2>
      {Object.entries(groups).map(([status, projs]) => (
        <section key={status} className="project-sidebar__group">
          <h3 className="project-sidebar__group-title">{status}</h3>
          <ul className="project-sidebar__list">
            {projs.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={`project-sidebar__item${p.id === selectedProjectId ? ' project-sidebar__item--selected' : ''}`}
                  onClick={() => onSelect(p.id)}
                >
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  )
}
