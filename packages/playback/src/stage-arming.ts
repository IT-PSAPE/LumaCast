import type { Id } from '@lumacast/kernel';

// A stage is "armed" (has a confidence timestamp) exactly while a stage
// selection is present; the timestamp resets whenever the selection changes,
// including back to null.
export function resolveStageArmedAt(currentStageId: Id | null, now: number): number | null {
  return currentStageId ? now : null;
}
