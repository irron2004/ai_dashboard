export const DEV_HARNESS_LOG_MAX_CHARS = 256 * 1024
export const DEV_HARNESS_LOG_TRIM_NOTICE = '…[older output trimmed]…\n'

/** Keeps a bounded tail so long-running live logs cannot grow the renderer string and DOM forever. */
export function appendBoundedLog(
  previous: string,
  chunk: string,
  maxChars = DEV_HARNESS_LOG_MAX_CHARS,
): string {
  if (!chunk) return previous
  const combined = previous + chunk
  if (combined.length <= maxChars) return combined
  if (maxChars <= DEV_HARNESS_LOG_TRIM_NOTICE.length) return combined.slice(-Math.max(0, maxChars))
  return DEV_HARNESS_LOG_TRIM_NOTICE
    + combined.slice(-(maxChars - DEV_HARNESS_LOG_TRIM_NOTICE.length))
}
