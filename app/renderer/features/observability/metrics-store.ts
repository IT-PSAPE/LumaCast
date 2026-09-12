import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { SystemMetricsSnapshot } from '@lumacast/protocol';

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
  elementKey: string;
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
  readyState: number;
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
  // Rolling p50/p95 of inter-frame intervals from the renderer rAF loop.
  p50FrameIntervalMs: number;
  p95FrameIntervalMs: number;
  lastFrameIntervalMs: number;
  overBudgetFrameCount: number;
  mountedCanvasCount: number;
  mountedVideoCount: number;
  playingVideoCount: number;
  visibilityState: DocumentVisibilityState;
  workbenchMode: string;
  drawerTab: string;
  longTaskCount: number;
  longTaskTotalMs: number;
  lastLongTaskMs: number;
  worstLongTaskMs: number;
}

export interface RendererMemorySnapshot {
  capturedAtMs: number;
  jsHeapSizeBytes: number;
  totalJSHeapSizeBytes: number;
  jsHeapLimitBytes: number;
}

const EVENT_RING_LIMIT = 200;
const MIRROR_TO_LOGS_STORAGE_KEY = 'obs-mirror-events-to-logs';
let eventIdSeq = 0;

function readMirrorEventsToConsole(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(MIRROR_TO_LOGS_STORAGE_KEY) === '1';
}

interface MetricsStoreState {
  events: ObsEvent[];
  videoQualities: Record<string, VideoQualitySample>;
  audioHealth: AudioHealthSnapshot | null;
  canvasRender: CanvasRenderSnapshot | null;
  rendererMemory: RendererMemorySnapshot | null;
  systemMetrics: SystemMetricsSnapshot | null;
  mirrorEventsToConsole: boolean;

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
  setMirrorEventsToConsole: (enabled: boolean) => void;
}

export const useMetricsStore = create<MetricsStoreState>()((set, get) => ({
  events: [],
  videoQualities: {},
  audioHealth: null,
  canvasRender: null,
  rendererMemory: null,
  systemMetrics: null,
  mirrorEventsToConsole: readMirrorEventsToConsole(),

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
    if (!get().mirrorEventsToConsole) return;
    const detailsText = details ? ` ${JSON.stringify(details)}` : '';
    const line = `[obs] ${category} :: ${message}${detailsText}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  },
  clearEvents: () => set({ events: [] }),
  setVideoQualities: (entries) => set(() => {
    const map: Record<string, VideoQualitySample> = {};
    for (const entry of entries) map[entry.elementKey] = entry;
    return { videoQualities: map };
  }),
  setAudioHealth: (snapshot) => set({ audioHealth: snapshot }),
  setCanvasRender: (snapshot) => set({ canvasRender: snapshot }),
  setRendererMemory: (snapshot) => set({ rendererMemory: snapshot }),
  setSystemMetrics: (snapshot) => set({ systemMetrics: snapshot }),
  setMirrorEventsToConsole: (enabled) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(MIRROR_TO_LOGS_STORAGE_KEY, enabled ? '1' : '0');
    }
    set({ mirrorEventsToConsole: enabled });
  },
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
