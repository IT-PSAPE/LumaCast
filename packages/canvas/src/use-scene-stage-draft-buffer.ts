import { useCallback, useEffect, useRef } from 'react';
import type { Id } from '@lumacast/kernel';
import type { SlideElement } from '@lumacast/composition';

interface UseSceneStageDraftBufferInput {
  setDraftElements: React.Dispatch<React.SetStateAction<Record<Id, Partial<SlideElement>>>>;
}

export function useSceneStageDraftBuffer({ setDraftElements }: UseSceneStageDraftBufferInput) {
  const pendingRef = useRef<Record<Id, Partial<SlideElement>>>({});
  const rafRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = {};
    rafRef.current = null;
    const ids = Object.keys(pending);
    if (ids.length === 0) return;
    setDraftElements((current) => {
      const next = { ...current };
      for (const id of ids) {
        next[id] = { ...(next[id] ?? {}), ...(pending[id] ?? {}) };
      }
      return next;
    });
  }, [setDraftElements]);

  const schedule = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      flush();
    });
  }, [flush]);

  const applyDraftPatch = useCallback((id: Id, patch: Partial<SlideElement>) => {
    pendingRef.current[id] = { ...(pendingRef.current[id] ?? {}), ...patch };
    schedule();
  }, [schedule]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return { applyDraftPatch, flushDraftBuffer: flush };
}
