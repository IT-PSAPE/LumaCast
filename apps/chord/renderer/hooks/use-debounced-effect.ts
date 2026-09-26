// Runs `effect` `delayMs` after the last time any of `deps` changed —
// `App.tsx` uses this to push `setDocumentState` at most a few times a
// second while the user types, rather than on every keystroke.
import { useEffect, type DependencyList } from 'react';

export function useDebouncedEffect(effect: () => void, deps: DependencyList, delayMs: number): void {
  useEffect(() => {
    const timer = window.setTimeout(effect, delayMs);
    return () => window.clearTimeout(timer);
    // `effect` is intentionally excluded: callers pass an inline closure that
    // captures `deps`, so keying off `deps` (which the caller controls) is
    // exactly the intended re-run condition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, delayMs]);
}
