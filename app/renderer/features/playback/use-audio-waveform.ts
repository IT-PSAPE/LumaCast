import { useEffect, useState } from 'react';

// Keep only compact peaks; decoded PCM is released after each analysis.
const cache = new Map<string, number[]>();
export function sampleWaveform(channels: readonly Float32Array[], count = 600): number[] {
  const length = channels[0]?.length ?? 0;
  if (!length || count <= 0) return [];
  const bins = Math.min(count, length);
  const peaks = Array.from({ length: bins }, (_, bin) => {
    const start = Math.floor(bin * length / bins);
    const end = Math.floor((bin + 1) * length / bins);
    const stride = Math.max(1, Math.floor((end - start) / 256));
    let peak = 0;
    for (const channel of channels) {
      for (let i = start; i < end; i += stride) peak = Math.max(peak, Math.abs(channel[i] ?? 0));
    }
    return Number.isFinite(peak) ? peak : 0;
  });
  const maximum = Math.max(...peaks, 0.001);
  return peaks.map((peak) => peak / maximum);
}

export function useAudioWaveform(src: string | undefined) {
  const [state, setState] = useState<{ src?: string; peaks: number[]; status: 'loading' | 'ready' | 'unavailable' }>({ peaks: [], status: 'loading' });
  useEffect(() => {
    if (!src) return;
    const cached = cache.get(src);
    if (cached) { setState({ src, peaks: cached, status: 'ready' }); return; }
    let active = true;
    const abort = new AbortController();
    let context: AudioContext | undefined;
    setState({ src, peaks: [], status: 'loading' });
    void (async () => {
      try {
        const response = await fetch(src, { signal: abort.signal });
        if (!response.ok) throw new Error('Audio unavailable');
        const bytes = await response.arrayBuffer();
        if (!active) return;
        context = new AudioContext();
        const decoded = await context.decodeAudioData(bytes);
        if (!active) return;
        const channels = Array.from({ length: Math.min(decoded.numberOfChannels, 2) }, (_, index) => decoded.getChannelData(index));
        const peaks = sampleWaveform(channels);
        cache.set(src, peaks);
        if (cache.size > 4) cache.delete(cache.keys().next().value!);
        setState({ src, peaks, status: 'ready' });
      } catch {
        if (active) setState({ src, peaks: [], status: 'unavailable' });
      } finally {
        if (context && context.state !== 'closed') void context.close().catch(() => undefined);
      }
    })();
    return () => { active = false; abort.abort(); if (context && context.state !== 'closed') void context.close().catch(() => undefined); };
  }, [src]);
  return state.src === src ? state : { peaks: [], status: 'loading' as const };
}
