import { createRoot } from 'react-dom/client'
import { App } from './App.js'

async function bootstrap(): Promise<void> {
  const fixtureMode = import.meta.env.VITE_APC_FIXTURE === '1'
  if (!window.apc && fixtureMode) {
    const { installFixtureBridge } = await import('./qa/fixture-bridge.js')
    installFixtureBridge()
  }
  if (!window.apc) throw new Error('APC bridge is unavailable: preload or an explicit QA fixture is required')
  createRoot(document.getElementById('root')!).render(<App />)
}

void bootstrap()
