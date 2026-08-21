import {
  useAudioHealthCollector,
  useCanvasRenderCollector,
  useRendererMemoryCollector,
  useSystemMetricsCollector,
  useVideoQualityCollector,
} from './observability-collectors';
import { NdiOutputsSection } from './ndi-outputs-section';
import { SourcePlaybackSection } from './source-playback-section';
import { AudioHealthSection } from './audio-health-section';
import { CanvasRenderSection } from './canvas-render-section';
import { MemorySection } from './memory-section';
import { ImageCacheSection } from './image-cache-section';
import { EventTimelineSection } from './event-timeline-section';
import { LogViewerSection } from './log-viewer-section';

export function ObservabilityPanel() {
  // Mount the live collectors only while this panel is open. They're
  // cheap, but no point sampling memory/audio when the user isn't looking.
  useSystemMetricsCollector(true);
  useRendererMemoryCollector(true);
  useVideoQualityCollector(true);
  useAudioHealthCollector(true);
  useCanvasRenderCollector(true);

  return (
    <div className="flex flex-col gap-8">
      <NdiOutputsSection />
      <SourcePlaybackSection />
      <AudioHealthSection />
      <CanvasRenderSection />
      <MemorySection />
      <ImageCacheSection />
      <EventTimelineSection />
      <LogViewerSection />
    </div>
  );
}
