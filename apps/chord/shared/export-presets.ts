// Export container/codec compatibility, settings, and file-naming/bitrate
// helpers for the export dialog and the renderer-side encoder. Process-
// neutral: no Node builtins, no Electron, no encoder implementation.
import type { ChordProject, FrameRate } from './project';

export type ExportContainer = 'mp4' | 'mov' | 'webm' | 'mkv';
export type ExportVideoCodec = 'avc' | 'hevc' | 'vp9' | 'av1';
export type ExportAudioCodec = 'aac' | 'opus';
export type AudioOnlyFormat = 'm4a' | 'mp3' | 'wav';
export type ExportQuality = 'low' | 'medium' | 'high' | 'very-high';

export interface VideoExportSettings {
  kind: 'video';
  container: ExportContainer;
  videoCodec: ExportVideoCodec;
  audioCodec: ExportAudioCodec;
  width: number;
  height: number;
  fps: FrameRate;
  quality: ExportQuality;
  includeAudio: boolean;
}

export interface AudioExportSettings {
  kind: 'audio';
  format: AudioOnlyFormat;
  quality: ExportQuality;
}

export interface ImageExportSettings {
  kind: 'image';
  timeMs: number;
}

export type ExportSettings = VideoExportSettings | AudioExportSettings | ImageExportSettings;

export interface ExportContainerInfo {
  id: ExportContainer;
  label: string;
  extension: string;
  videoCodecs: ExportVideoCodec[];
  audioCodecs: ExportAudioCodec[];
}

export const EXPORT_CONTAINERS: readonly ExportContainerInfo[] = [
  { id: 'mp4', label: 'MP4', extension: 'mp4', videoCodecs: ['avc', 'hevc', 'av1'], audioCodecs: ['aac', 'opus'] },
  { id: 'mov', label: 'QuickTime (MOV)', extension: 'mov', videoCodecs: ['avc', 'hevc'], audioCodecs: ['aac'] },
  { id: 'webm', label: 'WebM', extension: 'webm', videoCodecs: ['vp9', 'av1'], audioCodecs: ['opus'] },
  {
    id: 'mkv',
    label: 'Matroska (MKV)',
    extension: 'mkv',
    videoCodecs: ['avc', 'hevc', 'vp9', 'av1'],
    audioCodecs: ['aac', 'opus'],
  },
];

export function findContainer(id: ExportContainer): ExportContainerInfo | undefined {
  return EXPORT_CONTAINERS.find((container) => container.id === id);
}

export function isCompatible(container: ExportContainer, videoCodec: ExportVideoCodec, audioCodec: ExportAudioCodec): boolean {
  const info = findContainer(container);
  if (!info) return false;
  return info.videoCodecs.includes(videoCodec) && info.audioCodecs.includes(audioCodec);
}

export function defaultExportSettings(project: ChordProject): VideoExportSettings {
  return {
    kind: 'video',
    container: 'mp4',
    videoCodec: 'avc',
    audioCodec: 'aac',
    width: project.composition.width,
    height: project.composition.height,
    fps: project.composition.fps,
    quality: 'high',
    includeAudio: true,
  };
}

function extensionFor(settings: ExportSettings): string {
  if (settings.kind === 'video') return findContainer(settings.container)?.extension ?? settings.container;
  if (settings.kind === 'audio') return settings.format;
  return 'png';
}

/** A safe file name (no path separators or reserved characters) for the given settings. */
export function exportFileName(title: string, settings: ExportSettings): string {
  const cleaned = title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const safeTitle = cleaned.length > 0 ? cleaned : 'Untitled';
  return `${safeTitle}.${extensionFor(settings)}`;
}

// Bits/s per pixel-per-second at each quality, calibrated so 1080p30 'high' ≈ 12 Mbps.
const REFERENCE_PIXELS_PER_SECOND = 1920 * 1080 * 30;
const QUALITY_BITS_PER_REFERENCE: Record<ExportQuality, number> = {
  low: 4_000_000,
  medium: 8_000_000,
  high: 12_000_000,
  'very-high': 20_000_000,
};

/** Estimated video bitrate in bits/s, scaled from the 1080p30 reference points above. */
export function estimateBitrate(width: number, height: number, fps: FrameRate, quality: ExportQuality): number {
  const pixelsPerSecond = width * height * fps;
  const bitsPerPixelSecond = QUALITY_BITS_PER_REFERENCE[quality] / REFERENCE_PIXELS_PER_SECOND;
  return Math.round(pixelsPerSecond * bitsPerPixelSecond);
}
