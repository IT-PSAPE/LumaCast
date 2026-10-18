import { useEffect, useState } from 'react';
import type { StreamAPI, StreamRuntimeStats } from '../../../shared/desktop-api';

export interface UseRuntimeStatsParams {
  api: StreamAPI;
}

export interface UseRuntimeStatsResult {
  runtimeStats: StreamRuntimeStats | null;
}

/**
 * Polls `api.getRuntimeStats()` once a second while the window is visible
 * (paused in the background) for the status bar's CPU reading. Mirrors the
 * former inline App.tsx implementation exactly.
 */
export function useRuntimeStats(params: UseRuntimeStatsParams): UseRuntimeStatsResult {
  const { api } = params;
  const [runtimeStats, setRuntimeStats] = useState<StreamRuntimeStats | null>(null);

  useEffect(() => {
    let active = true;
    let timer: number | null = null;
    const poll = () => {
      void api.getRuntimeStats().then((stats) => { if (active) setRuntimeStats(stats); }).catch(() => undefined);
    };
    const start = () => {
      if (timer !== null) return;
      poll();
      timer = window.setInterval(poll, 1000);
    };
    const stop = () => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };
    const handleVisibility = () => { if (document.visibilityState === 'visible') start(); else stop(); };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      active = false;
      stop();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [api]);

  return { runtimeStats };
}
