import { KhKernelLintReportSchema, type KhKernelLintReport } from '@apc/shared'

/** kernel CLI는 issue를 `  - <issue>` 줄로 출력하고 issue가 있으면 exit 1 (kernel/__main__.py). */
export function parseLintOutput(stdout: string, exitCode: number): KhKernelLintReport {
  const issues = stdout
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s+(.*\S)\s*$/)?.[1])
    .filter((x): x is string => !!x)
  return KhKernelLintReportSchema.parse({
    ok: exitCode === 0 && issues.length === 0,
    exit_code: exitCode,
    issues,
  })
}
