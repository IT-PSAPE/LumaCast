import {
  createDefaultTextStyle,
  type AudioFilters,
  type ChromaKeyFilter,
  type MediaKind,
  type SourceCrop,
  type SourceFilters,
  type SourceKind,
  type StreamProject,
  type StreamSource,
} from '../../../shared/desktop-api';
import type { StreamPlatform } from '../../../shared/platform-capabilities';

export const DEFAULT_SOURCE_FILTERS: SourceFilters = { brightness: 100, contrast: 100, saturation: 100, opacity: 100, blur: 0 };

export const DEFAULT_AUDIO_FILTERS: AudioFilters = {
  gainDb: 0,
  noiseSuppression: false,
  noiseGate: false,
  noiseGateOpenThresholdDb: -26,
  noiseGateCloseThresholdDb: -32,
  noiseGateAttackMs: 10,
  noiseGateHoldMs: 150,
  noiseGateReleaseMs: 250,
  expander: false,
  expanderThresholdDb: -40,
  expanderRatio: 2,
  expanderAttackMs: 10,
  expanderReleaseMs: 150,
  compressor: false,
  compressorThresholdDb: -18,
  compressorRatio: 4,
  limiter: false,
};

export const DEFAULT_CHROMA_KEY: ChromaKeyFilter = { enabled: false, keyColor: '#00ff00', similarity: 35, smoothness: 15 };
export const DEFAULT_SOURCE_CROP: SourceCrop = { top: 0, right: 0, bottom: 0, left: 0 };

/** The platform used for brand-new default text styles — falls back to win32 labels outside a streamApi-bearing window (e.g. in tests). */
export function hostPlatform(): StreamPlatform {
  return typeof window !== 'undefined' && window.streamApi ? window.streamApi.platform : 'win32';
}

export function defaultTransform(kind: SourceKind, output: StreamProject['output'], mediaKind?: MediaKind) {
  if (kind === 'camera') return { x: Math.round(output.baseWidth * 0.72), y: Math.round(output.baseHeight * 0.68), width: Math.round(output.baseWidth * 0.25), height: Math.round(output.baseHeight * 0.25) };
  if (kind === 'text') return { x: Math.round(output.baseWidth * 0.08), y: Math.round(output.baseHeight * 0.08), width: Math.round(output.baseWidth * 0.84), height: Math.round(output.baseHeight * 0.25) };
  if (kind === 'microphone' || kind === 'desktop-audio' || kind === 'application-audio' || (kind === 'media' && mediaKind === 'audio')) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: 0, y: 0, width: output.baseWidth, height: output.baseHeight };
}

export function createSource(kind: SourceKind, output: StreamProject['output'], name?: string, extra: Partial<StreamSource> = {}): StreamSource {
  const labels: Record<SourceKind, string> = {
    display: 'Display Capture', window: 'Window Capture', camera: 'Video Capture Device',
    microphone: 'Audio Input Capture', 'desktop-audio': 'Audio Output Capture', 'application-audio': 'Application Audio Capture', image: 'Image', slideshow: 'Image Slideshow', media: 'Media Source', browser: 'Browser Source', text: 'Text', color: 'Color Source',
    group: 'Group', scene: 'Scene',
  };
  return {
    id: crypto.randomUUID(),
    name: name ?? labels[kind],
    kind,
    visible: true,
    locked: false,
    muted: false,
    volume: 1,
    balance: 0,
    audioMonitoring: 'off',
    audioTracks: [1],
    transform: defaultTransform(kind, output, extra.mediaKind),
    ...(kind === 'text' ? { text: 'Text', color: '#ffffff', textStyle: createDefaultTextStyle(hostPlatform()) } : {}),
    ...(kind === 'color' ? { color: '#17191f' } : {}),
    ...(kind === 'browser' ? { browserAudioEnabled: false } : {}),
    ...extra,
  };
}

export function cloneSceneSource(source: StreamSource): StreamSource {
  return {
    ...source,
    id: crypto.randomUUID(),
    transform: { ...source.transform },
    ...(source.crop ? { crop: { ...source.crop } } : {}),
    ...(source.filters ? { filters: { ...source.filters } } : {}),
    ...(source.chromaKey ? { chromaKey: { ...source.chromaKey } } : {}),
    ...(source.audioFilters ? { audioFilters: { ...source.audioFilters } } : {}),
    ...(source.slideshowImages ? { slideshowImages: source.slideshowImages.map((image) => ({ ...image })) } : {}),
    ...(source.children ? { children: source.children.map(cloneSceneSource) } : {}),
    audioTracks: [...(source.audioTracks ?? [1])],
  };
}
