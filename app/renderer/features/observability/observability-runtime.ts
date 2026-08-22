import {
  useAudioHealthCollector,
  useCanvasRenderCollector,
  useRendererMemoryCollector,
  useSystemMetricsCollector,
  useVideoQualityCollector,
} from './observability-collectors';

export function useObservabilityRuntime(): void {
  useSystemMetricsCollector(true);
  useRendererMemoryCollector(true);
  useVideoQualityCollector(true);
  useAudioHealthCollector(true);
  useCanvasRenderCollector(true);
}
