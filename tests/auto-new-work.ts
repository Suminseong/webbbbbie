import type { createEngine, LifeState } from "@webbbbbie/engine";

/** Explicit headless policy; product advance itself never skips the form. */
export function settleWork(
  engine: ReturnType<typeof createEngine>,
  state: LifeState,
) {
  const waiting = engine.getPendingNewWork(state);
  if (!waiting) return state;
  const result = engine.confirmNewWork(state, waiting.id, waiting.defaultPlan);
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}
