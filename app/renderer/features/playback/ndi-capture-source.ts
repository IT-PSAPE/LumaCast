import type { NdiOutputName } from '@core/types';
import { setCaptureSurface, useCaptureSurface } from '../../rendering/capture-surface-registry';

// Thin NDI-flavored facade over the shared, feature-agnostic capture-surface
// registry. The canvas feature's SceneStage publishes its live stage canvas
// under an NdiOutputName key without importing this (or any other playback)
// module; this file is the only place that attaches NDI meaning to that key.

export function setNdiCaptureSource(name: NdiOutputName, canvas: HTMLCanvasElement | null): void {
  setCaptureSurface(name, canvas);
}

export function useNdiCaptureSource(name: NdiOutputName): HTMLCanvasElement | null {
  return useCaptureSurface(name);
}
