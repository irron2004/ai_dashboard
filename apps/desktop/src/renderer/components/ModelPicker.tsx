import type { AgentType } from '@apc/shared'

const ENGINES: AgentType[] = ['claude', 'codex', 'opencode']

type Props = {
  defaultEngine: AgentType
  onPick: (engine: AgentType) => void
}

export function ModelPicker({ defaultEngine, onPick }: Props) {
  return (
    <div className="model-picker">
      <h3>Select Model</h3>
      <ul className="model-picker__list">
        {ENGINES.map((engine) => (
          <li key={engine}>
            <button
              type="button"
              data-default={engine === defaultEngine ? 'true' : undefined}
              className={engine === defaultEngine ? 'model-picker__btn model-picker__btn--default' : 'model-picker__btn'}
              onClick={() => onPick(engine)}
            >
              {engine}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
