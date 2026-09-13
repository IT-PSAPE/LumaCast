import { useEffect, useState } from 'react';

type WaveformState = { src?: string; peaks: number[]; status: 'loading' | 'ready' | 'unavailable' };

interface WaveformEntry {
  state: WaveformState;
  controller: AbortController;
  listeners: Set<() => void>;
}

const CACHE_LIMIT = 4;
// Jobs are keyed above the transport component lifecycle. Leaving the Audio
// tab only removes its subscriber; analysis finishes once and is reused when
// the tab returns. Entries still have a bounded LRU lifetime.
const entries = new Map<string, WaveformEntry>();

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

function notify(entry: WaveformEntry) {
  for (const listener of entry.listeners) listener();
}

function touch(src: string, entry: WaveformEntry) {
  entries.delete(src);
  entries.set(src, entry);
}

function trimEntries() {
  while (entries.size > CACHE_LIMIT) {
    const candidate = Array.from(entries.entries()).find(([, entry]) => entry.listeners.size === 0);
    if (!candidate) return;
    const [src, entry] = candidate;
    entries.delete(src);
    entry.controller.abort();
  }
}

function ensureEntry(src: string): WaveformEntry {
  const existing = entries.get(src);
  if (existing) {
    touch(src, existing);
    return existing;
  }

  const entry: WaveformEntry = {
    state: { src, peaks: [], status: 'loading' },
    controller: new AbortController(),
    listeners: new Set(),
  };
  entries.set(src, entry);

  void (async () => {
    try {
      const response = await fetch(src, { signal: entry.controller.signal });
      if (!response.ok) throw new Error('Audio unavailable');
      const bytes = await response.arrayBuffer();
      if (entry.controller.signal.aborted) return;
      // OfflineAudioContext decodes without opening or reconfiguring the live
      // audio device used by playback and NDI capture.
      const context = new OfflineAudioContext(1, 1, 44_100);
      const decoded = await context.decodeAudioData(bytes);
      if (entry.controller.signal.aborted) return;
      const channels = Array.from(
        { length: Math.min(decoded.numberOfChannels, 2) },
        (_, index) => decoded.getChannelData(index),
      );
      entry.state = { src, peaks: sampleWaveform(channels), status: 'ready' };
      touch(src, entry);
      trimEntries();
      notify(entry);
    } catch {
      if (entry.controller.signal.aborted) return;
      entry.state = { src, peaks: [], status: 'unavailable' };
      notify(entry);
      // Failed analysis can be retried the next time the source is selected.
      if (entries.get(src) === entry) entries.delete(src);
    }
  })();

  return entry;
}

export function useAudioWaveform(src: string | undefined) {
  const [state, setState] = useState<WaveformState>({ peaks: [], status: 'loading' });
  useEffect(() => {
    if (!src) return;
    const entry = ensureEntry(src);
    setState(entry.state);
    const handleChange = () => setState(entry.state);
    entry.listeners.add(handleChange);
    trimEntries();
    return () => {
      entry.listeners.delete(handleChange);
      trimEntries();
    };
  }, [src]);
  return state.src === src ? state : { peaks: [], status: 'loading' as const };
}
