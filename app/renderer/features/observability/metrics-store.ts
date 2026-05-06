import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { SystemMetricsSnapshot } from '@core/types';

// Ring-buffered domain events for the observability timeline. Events are
// also logged to the console so the main-process file logger captures them
// for post-mortem reproduction; this store only holds the recent tail for
// in-app display.

export type ObsEventCategory =
  | 'ndi'
  | 'layer'
  | 'overlay'
  | 'playback'
  | 'slide'
  | 'system'
  | 'audio'
  | 'video'
  | 'error';

export type ObsEventLevel = 'info' | 'warn' | 'error';

export interface ObsEvent {
  id: number;
  capturedAtMs: number;
  category: ObsEventCategory;
  level: ObsEventLevel;
  message: string;
  details?: Record<string, unknown>;
}

export interface VideoQualitySample {
  capturedAtMs: number;
  src: string;
  // Best-effort label — uses src basename or a counter when unknown.
  label: string;
  droppedVideoFrames: number;
  totalVideoFrames: number;
  // Browser-internal rolling decoded fps if available, otherwise our own
  // recent decode count divided by the elapsed sample interval.
  decodedFps: number;
  isPlaying: boolean;
  hasAudio: boolean;
  currentTimeSeconds: number;
  durationSeconds: number;
}

export interface AudioHealthSnapshot {
  contextState: AudioContextState | null;
  baseLatencyMs: number;
  outputLatencyMs: number;
  sampleRate: number;
  peakLevel: number;
  rmsLevel: number;
  clippingDetected: boolean;
  underrunCount: number;
}

export interface CanvasRenderSnapshot {
  capturedAtMs: number;
  // Rolling p50/p95 of inter-frame intervals from the renderer rAF loop —
  // measured by the observability page itself when active.
  p50FrameIntervalMs: number;
  p95FrameIntervalMs: number;
  lastFrameIntervalMs: number;
  // Konva stage layer count if available — useful for spotting regressions
  // where unexpected layers are mounted.
  layerCount: number;
}

export interface RendererMemorySnapshot {
  capturedAtMs: number;
  jsHeapSizeBytes: number;
  totalJSHeapSizeBytes: number;
  jsHeapLimitBytes: number;
}

const EVENT_RING_LIMIT = 200;
let eventIdSeq = 0;

interface MetricsStoreState {
  events: ObsEvent[];
  videoQualities: Record<string, VideoQualitySample>;
  audioHealth: AudioHealthSnapshot | null;
  canvasRender: CanvasRenderSnapshot | null;
  rendererMemory: RendererMemorySnapshot | null;
  systemMetrics: SystemMetricsSnapshot | null;

  recordEvent: (
    category: ObsEventCategory,
    message: string,
    details?: Record<string, unknown>,
    level?: ObsEventLevel,
  ) => void;
  clearEvents: () => void;
  setVideoQualities: (entries: VideoQualitySample[]) => void;
  setAudioHealth: (snapshot: AudioHealthSnapshot | null) => void;
  setCanvasRender: (snapshot: CanvasRenderSnapshot | null) => void;
  setRendererMemory: (snapshot: RendererMemorySnapshot | null) => void;
  setSystemMetrics: (snapshot: SystemMetricsSnapshot | null) => void;
}

export const useMetricsStore = create<MetricsStoreState>()((set) => ({
  events: [],
  videoQualities: {},
  audioHealth: null,
  canvasRender: null,
  rendererMemory: null,
  systemMetrics: null,

  recordEvent: (category, message, details, level = 'info') => {
    const event: ObsEvent = {
      id: ++eventIdSeq,
      capturedAtMs: Date.now(),
      category,
      level,
      message,
      details,
    };
    set((state) => {
      const next = state.events.length >= EVENT_RING_LIMIT
        ? state.events.slice(1)
        : state.events.slice();
      next.push(event);
      return { events: next };
    });
    // Also push to the file logger via console — main process bridges
    // renderer console-messages into session-*.log.
    const detailsText = details ? ` ${JSON.stringify(details)}` : '';
    const line = `[obs] ${category} :: ${message}${detailsText}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  },
  clearEvents: () => set({ events: [] }),
  setVideoQualities: (entries) => set(() => {
    const map: Record<string, VideoQualitySample> = {};
    for (const entry of entries) map[entry.src] = entry;
    return { videoQualities: map };
  }),
  setAudioHealth: (snapshot) => set({ audioHealth: snapshot }),
  setCanvasRender: (snapshot) => set({ canvasRender: snapshot }),
  setRendererMemory: (snapshot) => set({ rendererMemory: snapshot }),
  setSystemMetrics: (snapshot) => set({ systemMetrics: snapshot }),
}));

export { useShallow };

// Convenience non-React entry — call from any code path (effects, callbacks,
// IPC handlers) that doesn't already pull the store into scope.
export function recordObsEvent(
  category: ObsEventCategory,
  message: string,
  details?: Record<string, unknown>,
  level?: ObsEventLevel,
): void {
  useMetricsStore.getState().recordEvent(category, message, details, level);
}
