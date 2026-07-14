import { useMemo } from 'react'
import type { HarnessRunArtifact } from '../harness-utils.js'

type Discovery = {
  project_id?: string
  summary?: string
  repos?: Array<{ path?: string; kind?: string }>
  canonical_docs?: Array<{ path?: string; role?: string }>
  topics?: string[]
}
type IntentDoc = { path?: string; intent?: string; confidence?: string; reason?: string }
type FolderClassification = { path?: string; description?: string; source?: 'user' | 'agent' }
type FolderUnit = {
  id?: string
  label?: string
  memberPaths?: string[]
  role?: string
  docSourceIds?: string[]
  estChars?: number
  splitOf?: string
  folderClassifications?: FolderClassification[]
}
type FolderPlan = {
  units?: FolderUnit[]
  unplacedSourceIds?: string[]
  projectContext?: {
    projectCharacter?: string
    folderClassifications?: Array<{ path?: string; description?: string }>
  }
}

const artifact = <T,>(artifacts: HarnessRunArtifact[], name: string): T | undefined =>
  artifacts.find((entry) => entry.name === name)?.data as T | undefined

function inferredIntent(paths: string[], documents: IntentDoc[]): string | null {
  const normalized = paths.map((path) => path.replace(/\\/g, '/').replace(/^\(root\)$/, ''))
  const matches = documents.filter((doc) => {
    const path = (doc.path ?? '').replace(/\\/g, '/')
    return normalized.some((folder) => folder === '' || path.includes(`/${folder}/`) || path.endsWith(`/${folder}`))
  })
  const counts = new Map<string, number>()
  for (const doc of matches) if (doc.intent) counts.set(doc.intent, (counts.get(doc.intent) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

export function ProjectStructureView({ artifacts }: { artifacts: HarnessRunArtifact[] }) {
  const discovery = artifact<Discovery>(artifacts, 'project-discovery-report')
  const intent = artifact<{ documents?: IntentDoc[] }>(artifacts, 'document-intent-report')
  const plan = artifact<FolderPlan>(artifacts, 'folder-plan')
  const documents = intent?.documents ?? []
  const units = plan?.units ?? []
  const intentCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const doc of documents) {
      const key = doc.intent ?? 'unknown'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts].sort((a, b) => b[1] - a[1])
  }, [documents])
  const maxIntentCount = Math.max(1, ...intentCounts.map(([, count]) => count))

  if (!discovery && !plan && !intent) {
    return <div className="wikigen__placeholder">구조 분석 결과가 없습니다 — 전체 문서 모드로 실행하세요.</div>
  }

  return (
    <div className="project-structure">
      <section className="project-structure__overview">
        <div className="project-structure__root" aria-label="프로젝트 구조 루트">
          <span className="project-structure__root-icon">◇</span>
          <div>
            <h3>{discovery?.project_id || 'Project'}</h3>
            <p>{discovery?.summary || 'project-discovery가 저장소 구조를 분석했습니다.'}</p>
          </div>
        </div>
        <div className="project-structure__character">
          <span>프로젝트 성격</span>
          <strong>{plan?.projectContext?.projectCharacter || '사용자 입력 없음 · agent 추론'}</strong>
        </div>
        {(discovery?.topics?.length ?? 0) > 0 && (
          <div className="project-structure__topics" aria-label="주요 토픽">
            {discovery!.topics!.map((topic) => <span key={topic}>{topic}</span>)}
          </div>
        )}
      </section>

      <section className="project-structure__map" aria-label="분석된 폴더 구조">
        <header>
          <div>
            <h3>폴더별 문서 구조</h3>
            <p>{units.length}개 작업 단위 · {documents.length}개 문서 분류</p>
          </div>
          <div className="project-structure__legend"><span>● 사용자</span><span>○ AI 자동</span></div>
        </header>
        {units.length === 0 ? (
          <div className="project-structure__empty">분석된 문서 폴더가 없습니다.</div>
        ) : (
          <div className="project-structure__branches">
            {units.map((unit, index) => {
              const classifications = unit.folderClassifications ?? (unit.memberPaths ?? []).map((path) => ({ path, description: '', source: 'agent' as const }))
              const autoIntent = inferredIntent(unit.memberPaths ?? [], documents)
              return (
                <article className="project-structure__folder" key={unit.id ?? `${unit.label}:${index}`}>
                  <div className="project-structure__folder-head">
                    <span className="project-structure__folder-icon">▱</span>
                    <div>
                      <h4>{unit.label || '(root)'}</h4>
                      <p>{unit.docSourceIds?.length ?? 0}개 문서{unit.splitOf ? ` · ${unit.splitOf} 분할` : ''}</p>
                    </div>
                    <span className={`project-structure__role project-structure__role--${unit.role ?? 'reference'}`}>{unit.role ?? 'reference'}</span>
                  </div>
                  <ul>
                    {classifications.map((item, itemIndex) => {
                      const manual = item.source === 'user' && Boolean(item.description)
                      return (
                        <li key={`${item.path}:${itemIndex}`}>
                          <span className={manual ? 'project-structure__origin project-structure__origin--user' : 'project-structure__origin'}>{manual ? '●' : '○'}</span>
                          <code>{item.path || '(root)'}/</code>
                          <span>{manual ? item.description : (autoIntent ? `AI: ${autoIntent}` : 'AI가 문서 근거로 분류')}</span>
                        </li>
                      )
                    })}
                  </ul>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <div className="project-structure__details">
        <section>
          <h3>문서 의도 분포</h3>
          {intentCounts.length === 0 ? <p className="project-structure__muted">분류된 문서 없음</p> : intentCounts.map(([name, count]) => (
            <div className="project-structure__bar" key={name}>
              <span>{name}</span>
              <i><b style={{ width: `${Math.max(8, count / maxIntentCount * 100)}%` }} /></i>
              <strong>{count}</strong>
            </div>
          ))}
        </section>
        <section>
          <h3>Canonical 문서</h3>
          {(discovery?.canonical_docs?.length ?? 0) === 0 ? <p className="project-structure__muted">발견된 canonical 문서 없음</p> : (
            <ul className="project-structure__canonical">
              {discovery!.canonical_docs!.map((doc, index) => (
                <li key={`${doc.path}:${index}`}><code>{doc.path}</code><span>{doc.role ?? 'canonical'}</span></li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
