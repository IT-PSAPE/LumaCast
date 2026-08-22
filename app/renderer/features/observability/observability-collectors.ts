import { useEffect, useRef } from 'react';
import { useWorkbench } from '../../contexts/workbench-context';
import { recordObsEvent, useMetricsStore, type AudioHealthSnapshot, type RendererMemorySnapshot, type VideoQualitySample } from './metrics-store';
import { getActiveNdiAudioContext } from '../playback/ndi-audio-capture';

const SYSTEM_METRICS_INTERVAL_MS = 2000;
const RENDERER_MEMORY_INTERVAL_MS = 1000;
const VIDEO_QUALITY_INTERVAL_MS = 1000;
const AUDIO_HEALTH_INTERVAL_MS = 250;
const CANVAS_RENDER_SAMPLE_WINDOW = 60;
const CANVAS_RENDER_GAP_EVENT_THRESHOLD_MS = 50;
const CANVAS_RENDER_EVENT_DEBOUNCE_MS = 1000;
const LONG_TASK_EVENT_THRESHOLD_MS = 50;

interface PerformanceMemoryShim {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

// Polls main-process system metrics over IPC from the always-on app-shell
// observability runtime.
export function useSystemMetricsCollector(active: boolean): void {
  const setSystemMetrics = useMetricsStore((s) => s.setSystemMetrics);
  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    async function poll() {
      try {
        const snapshot = await window.castApi.obsGetSystemMetrics();
        if (!cancelled) setSystemMetrics(snapshot);
      } catch (error) {
        console.error('[obs] system metrics poll failed', error);
      }
    }
    void poll();
    const id = window.setInterval(poll, SYSTEM_METRICS_INTERVAL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [active, setSystemMetrics]);
}

export function useRendererMemoryCollector(active: boolean): void {
  const setRendererMemory = useMetricsStore((s) => s.setRendererMemory);
  useEffect(() => {
    if (!active) return undefined;
    function sample() {
      // performance.memory is a non-standard Chromium extension. It's
      // present in Electron but not in lib.dom.d.ts, so the cast is local.
      const mem = (performance as unknown as { memory?: PerformanceMemoryShim }).memory;
      if (!mem) {
        setRendererMemory(null);
        return;
      }
      const snapshot: RendererMemorySnapshot = {
        capturedAtMs: Date.now(),
        jsHeapSizeBytes: mem.usedJSHeapSize,
        totalJSHeapSizeBytes: mem.totalJSHeapSize,
        jsHeapLimitBytes: mem.jsHeapSizeLimit,
      };
      setRendererMemory(snapshot);
    }
    sample();
    const id = window.setInterval(sample, RENDERER_MEMORY_INTERVAL_MS);
    return () => { window.clearInterval(id); };
  }, [active, setRendererMemory]);
}

interface VideoSampleCarry {
  lastTotalDecoded: number;
  lastSampledAt: number;
}

// Walks the document for HTMLVideoElements and reports their playback
// quality (drops, decoded fps). Cheap — just `document.querySelectorAll` +
// a couple of property reads per element per second.
export function useVideoQualityCollector(active: boolean): void {
  const setVideoQualities = useMetricsStore((s) => s.setVideoQualities);
  const carryRef = useRef<Map<string, VideoSampleCarry>>(new Map());
  const videoElementKeysRef = useRef<WeakMap<HTMLVideoElement, string>>(new WeakMap());
  const videoElementKeySeqRef = useRef(0);
  useEffect(() => {
    if (!active) return undefined;
    const carry = carryRef.current;
    const videoElementKeys = videoElementKeysRef.current;
    function getVideoElementKey(video: HTMLVideoElement): string {
      let key = videoElementKeys.get(video);
      if (key) return key;
      videoElementKeySeqRef.current += 1;
      key = `video-${videoElementKeySeqRef.current}`;
      videoElementKeys.set(video, key);
      return key;
    }
    function sample() {
      const elements = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
      const now = Date.now();
      const samples: VideoQualitySample[] = [];
      const liveKeys = new Set<string>();
      for (const el of elements) {
        const src = el.currentSrc || el.src;
        const elementKey = getVideoElementKey(el);
        liveKeys.add(elementKey);
        const quality = typeof el.getVideoPlaybackQuality === 'function'
          ? el.getVideoPlaybackQuality()
          : null;
        const totalDecoded = quality?.totalVideoFrames ?? 0;
        const dropped = quality?.droppedVideoFrames ?? 0;
        const previous = carry.get(elementKey);
        let decodedFps = 0;
        if (previous) {
          const elapsedSec = Math.max(0.001, (now - previous.lastSampledAt) / 1000);
          decodedFps = Math.max(0, (totalDecoded - previous.lastTotalDecoded) / elapsedSec);
        }
        carry.set(elementKey, { lastTotalDecoded: totalDecoded, lastSampledAt: now });

        const label = labelForVideoSrc(src, elementKey);
        samples.push({
          capturedAtMs: now,
          elementKey,
          src,
          label,
          droppedVideoFrames: dropped,
          totalVideoFrames: totalDecoded,
          decodedFps,
          isPlaying: !el.paused && !el.ended && el.readyState >= 2,
          hasAudio: 'mozHasAudio' in el ? Boolean((el as unknown as { mozHasAudio: boolean }).mozHasAudio) : true,
          readyState: el.readyState,
          currentTimeSeconds: el.currentTime,
          durationSeconds: Number.isFinite(el.duration) ? el.duration : 0,
        });
      }
      // Drop carry entries for elements that have left the DOM.
      for (const key of carry.keys()) {
        if (!liveKeys.has(key)) carry.delete(key);
      }
      setVideoQualities(samples);
    }
    sample();
    const id = window.setInterval(sample, VIDEO_QUALITY_INTERVAL_MS);
    return () => { window.clearInterval(id); };
  }, [active, setVideoQualities]);
}

function labelForVideoSrc(src: string, fallbackLabel: string): string {
  if (!src) return fallbackLabel;
  try {
    const url = new URL(src, window.location.href);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? fallbackLabel;
  } catch {
    return src || fallbackLabel;
  }
}

export function useAudioHealthCollector(active: boolean): void {
  const setAudioHealth = useMetricsStore((s) => s.setAudioHealth);
  const lastClipAtRef = useRef(0);
  useEffect(() => {
    if (!active) return undefined;
    const buffer = new Float32Array(1024);
    let underrunCount = 0;
    function sample() {
      const handle = getActiveNdiAudioContext();
      if (!handle) {
        setAudioHealth(null);
        return;
      }
      const { ctx, analyser } = handle;
      analyser.getFloatTimeDomainData(buffer);
      let peak = 0;
      let sumSquares = 0;
      let allZero = true;
      for (let i = 0; i < buffer.length; i++) {
        const v = buffer[i];
        if (v !== 0) allZero = false;
        const abs = Math.abs(v);
        if (abs > peak) peak = abs;
        sumSquares += v * v;
      }
      // All-zero frames while the AudioContext is running often indicate
      // an underrun (no upstream samples reached the analyser).
      if (allZero && ctx.state === 'running') {
        underrunCount += 1;
      }
      const rms = Math.sqrt(sumSquares / buffer.length);
      const clipping = peak >= 0.999;
      if (clipping) lastClipAtRef.current = Date.now();
      const snapshot: AudioHealthSnapshot = {
        contextState: ctx.state,
        baseLatencyMs: (ctx.baseLatency ?? 0) * 1000,
        outputLatencyMs: (ctx.outputLatency ?? 0) * 1000,
        sampleRate: ctx.sampleRate,
        peakLevel: peak,
        rmsLevel: rms,
        clippingDetected: Date.now() - lastClipAtRef.current < 2000,
        underrunCount,
      };
      setAudioHealth(snapshot);
    }
    sample();
    const id = window.setInterval(sample, AUDIO_HEALTH_INTERVAL_MS);
    return () => { window.clearInterval(id); };
  }, [active, setAudioHealth]);
}

// Measures the renderer's rAF cadence — proxy for "is the UI smooth".
// Not a perfect substitute for compositor-level frame stats but cheap and
// good enough to spot stalls.
export function useCanvasRenderCollector(active: boolean): void {
  const setCanvasRender = useMetricsStore((s) => s.setCanvasRender);
  const { state: { workbenchMode, drawerTab } } = useWorkbench();
  const workbenchModeRef = useRef(workbenchMode);
  workbenchModeRef.current = workbenchMode;
  const drawerTabRef = useRef(drawerTab);
  drawerTabRef.current = drawerTab;
  useEffect(() => {
    if (!active) return undefined;
    let rafId: number | null = null;
    let lastTimestamp = 0;
    const samples: number[] = [];
    let lastEmitAt = 0;
    let overBudgetFrameCount = 0;
    let lastGapEventAt = 0;
    let lastLongTaskEventAt = 0;

    function getRenderContext() {
      const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
      return {
        mountedCanvasCount: document.querySelectorAll('canvas').length,
        mountedVideoCount: videos.length,
        playingVideoCount: videos.filter((video) => !video.paused && !video.ended && video.readyState >= 2).length,
        visibilityState: document.visibilityState,
        workbenchMode: workbenchModeRef.current,
        drawerTab: drawerTabRef.current,
      };
    }

    const longTaskStats = {
      count: 0,
      totalMs: 0,
      lastMs: 0,
      worstMs: 0,
    };
    const longTaskObserver = typeof PerformanceObserver === 'function'
      ? new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (document.visibilityState !== 'visible') continue;
            longTaskStats.count += 1;
            longTaskStats.totalMs += entry.duration;
            longTaskStats.lastMs = entry.duration;
            longTaskStats.worstMs = Math.max(longTaskStats.worstMs, entry.duration);
            const now = Date.now();
            if (
              document.visibilityState === 'visible'
              && entry.duration >= LONG_TASK_EVENT_THRESHOLD_MS
              && now - lastLongTaskEventAt >= CANVAS_RENDER_EVENT_DEBOUNCE_MS
            ) {
              lastLongTaskEventAt = now;
              recordObsEvent(
                'system',
                'Renderer long task threshold exceeded',
                {
                  durationMs: entry.duration,
                  ...getRenderContext(),
                },
                'warn',
              );
            }
          }
        })
      : null;

    try {
      longTaskObserver?.observe({ entryTypes: ['longtask'] });
    } catch {
      longTaskObserver?.disconnect();
    }

    function tick(timestamp: number) {
      if (document.visibilityState !== 'visible') {
        lastTimestamp = 0;
        rafId = requestAnimationFrame(tick);
        return;
      }
      if (lastTimestamp > 0) {
        const interval = timestamp - lastTimestamp;
        if (samples.length >= CANVAS_RENDER_SAMPLE_WINDOW) samples.shift();
        samples.push(interval);
        if (interval > 25) {
          overBudgetFrameCount += 1;
        }
        const now = Date.now();
        if (interval >= CANVAS_RENDER_GAP_EVENT_THRESHOLD_MS && now - lastGapEventAt >= CANVAS_RENDER_EVENT_DEBOUNCE_MS) {
          lastGapEventAt = now;
          recordObsEvent(
            'system',
            'Renderer rAF gap threshold exceeded',
            {
              frameIntervalMs: interval,
              ...getRenderContext(),
            },
            'warn',
          );
        }
        if (now - lastEmitAt >= 500 && samples.length >= 2) {
          lastEmitAt = now;
          const sorted = samples.slice().sort((a, b) => a - b);
          const p50 = sorted[Math.floor(sorted.length * 0.5)];
          const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
          const context = getRenderContext();
          setCanvasRender({
            capturedAtMs: now,
            p50FrameIntervalMs: p50,
            p95FrameIntervalMs: p95,
            lastFrameIntervalMs: interval,
            overBudgetFrameCount,
            mountedCanvasCount: context.mountedCanvasCount,
            mountedVideoCount: context.mountedVideoCount,
            playingVideoCount: context.playingVideoCount,
            visibilityState: context.visibilityState,
            workbenchMode: context.workbenchMode,
            drawerTab: context.drawerTab,
            longTaskCount: longTaskStats.count,
            longTaskTotalMs: longTaskStats.totalMs,
            lastLongTaskMs: longTaskStats.lastMs,
            worstLongTaskMs: longTaskStats.worstMs,
          });
        }
      }
      lastTimestamp = timestamp;
      rafId = requestAnimationFrame(tick);
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        lastTimestamp = 0;
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      longTaskObserver?.disconnect();
    };
  }, [active, setCanvasRender]);
}
