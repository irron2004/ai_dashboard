/** Minimum height (px) the agent-terminal dock can be dragged down to. */
export const DOCK_MIN_H = 120
/** Default dock height (px) when expanded and never resized. */
export const DOCK_DEFAULT_H = 280
/** Space (px) kept above the dock so a drag can never swallow the toolbar + a usable main area. */
const DOCK_TOP_RESERVE = 160

/** Clamp a desired dock height to [DOCK_MIN_H, viewportH - reserve], rounded to a whole pixel. The upper
 *  bound never falls below the minimum, so even a tiny viewport still yields a usable (minimum) dock. */
export function clampDockHeight(desired: number, viewportH: number): number {
  const max = Math.max(DOCK_MIN_H, viewportH - DOCK_TOP_RESERVE)
  return Math.min(max, Math.max(DOCK_MIN_H, Math.round(desired)))
}
