import { defineWorkspace } from 'vitest/config'

// vitest ^2: 루트 packages/scripts 스위트와 apps/desktop 스위트를 한 `vitest run`에 묶는다.
// (예전엔 루트 include가 apps/**를 빠뜨려 apps/desktop 테스트가 회귀 검증에서 누락됐다 — SP1 회귀의 원인.)
export default defineWorkspace([
  './vitest.config.ts',
  './apps/desktop/vitest.config.ts',
])
