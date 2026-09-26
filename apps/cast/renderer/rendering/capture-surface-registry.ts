import { useSyncExternalStore } from 'react';

// Generic named-canvas-surface registry. A render surface (e.g. an editor's
// off-screen Konva stage) publishes the live <canvas> element backing it
// under a plain string key; any consumer that needs read access to that
// element (e.g. an output capture pipeline) subscribes to the same key. Both
// sides depend only on this module, not on each other's feature — it carries
// no capture-format, output, or NDI-specific knowledge, so it belongs in
// shared rendering rather than either producer or consumer feature.
//
// Two policy-free consumers today: the canvas feature publishes a stage's
// canvas here (app/renderer/features/canvas/scene-stage.tsx) and the
// playback feature's NDI capture-source adapter reads it back
// (app/renderer/features/playback/ndi-capture-source.ts). Neither imports
// the other.

const surfaces = new Map<string, HTMLCanvasElement | null>();
const listeners = new Map<string, Set<() => void>>();

function emit(key: string) {
  const subscribers = listeners.get(key);
  if (!subscribers) return;
  for (const callback of subscribers) {
    callback();
  }
}

export function setCaptureSurface(key: string, canvas: HTMLCanvasElement | null): void {
  const current = surfaces.get(key) ?? null;
  if (current === canvas) return;
  surfaces.set(key, canvas);
  emit(key);
}

export function getCaptureSurface(key: string): HTMLCanvasElement | null {
  return surfaces.get(key) ?? null;
}

function subscribe(key: string, callback: () => void): () => void {
  const subscribers = listeners.get(key) ?? new Set<() => void>();
  subscribers.add(callback);
  listeners.set(key, subscribers);
  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0) {
      listeners.delete(key);
    }
  };
}

export function useCaptureSurface(key: string): HTMLCanvasElement | null {
  return useSyncExternalStore(
    (callback) => subscribe(key, callback),
    () => getCaptureSurface(key),
    () => null,
  );
}
