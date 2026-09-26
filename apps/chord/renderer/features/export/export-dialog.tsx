// Export dialog: video/audio/image settings, an estimated file size, and
// progress. Copy stays terse — the controls speak for themselves (see
// AGENTS.md's UI Copy rules).
import { useMemo, useState } from 'react';
import { Checkbox, Modal, ReacstButton, SegmentedControl, Select } from '@lumacast/ui';
import {
  EXPORT_CONTAINERS,
  defaultExportSettings,
  estimateBitrate,
  findContainer,
  type AudioOnlyFormat,
  type ExportAudioCodec,
  type ExportContainer,
  type ExportQuality,
  type ExportSettings,
  type ExportVideoCodec,
  type VideoExportSettings,
} from '../../../shared/export-presets';
import { COMPOSITION_PRESETS, FRAME_RATES, type FrameRate } from '../../../shared/project';
import { useChordStore } from '../../store';
import { resolveTimelineEndMs } from '../canvas/build-frame-scene';
import { estimateAudioBitrate } from './export-plan';
import { useExport } from './use-export';

type ExportKind = ExportSettings['kind'];

const QUALITIES: readonly ExportQuality[] = ['low', 'medium', 'high', 'very-high'];
const AUDIO_FORMATS: readonly AudioOnlyFormat[] = ['m4a', 'mp3', 'wav'];

const QUALITY_LABELS: Record<ExportQuality, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  'very-high': 'Very high',
};

const VIDEO_CODEC_LABELS: Record<ExportVideoCodec, string> = {
  avc: 'H.264 (AVC)',
  hevc: 'H.265 (HEVC)',
  vp9: 'VP9',
  av1: 'AV1',
};

const AUDIO_CODEC_LABELS: Record<ExportAudioCodec, string> = {
  aac: 'AAC',
  opus: 'Opus',
};

const RESOLUTION_PRESETS: ReadonlyArray<{ id: string; label: string; width: number; height: number }> = [
  { id: '720p', label: '720p', width: 1280, height: 720 },
  { id: '1080p', label: '1080p', width: 1920, height: 1080 },
  { id: '4k', label: '4K', width: 3840, height: 2160 },
];

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatEta(etaMs: number | null): string {
  if (etaMs === null) return '';
  const totalSeconds = Math.ceil(etaMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s left` : `${seconds}s left`;
}

function resolutionOptionId(settings: VideoExportSettings, compositionWidth: number, compositionHeight: number): string {
  if (settings.width === compositionWidth && settings.height === compositionHeight) return 'composition';
  return RESOLUTION_PRESETS.find((preset) => preset.width === settings.width && preset.height === settings.height)?.id ?? 'composition';
}

export interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ExportDialog({ open, onClose }: ExportDialogProps) {
  const project = useChordStore((state) => state.document.project);
  const timeMs = useChordStore((state) => state.playback.timeMs);
  const exportJob = useChordStore((state) => state.exportJob);
  const { start, cancel } = useExport();

  const [kind, setKind] = useState<ExportKind>('video');
  const [video, setVideo] = useState<VideoExportSettings>(() => defaultExportSettings(project));
  const [audioFormat, setAudioFormat] = useState<AudioOnlyFormat>('m4a');
  const [audioQuality, setAudioQuality] = useState<ExportQuality>('high');

  const containerInfo = findContainer(video.container);
  const isBusy = exportJob.status === 'preparing' || exportJob.status === 'rendering' || exportJob.status === 'finalizing';
  const isDone = exportJob.status === 'done' && exportJob.outputPath !== null;

  const settings: ExportSettings = useMemo(() => {
    if (kind === 'audio') return { kind: 'audio', format: audioFormat, quality: audioQuality };
    if (kind === 'image') return { kind: 'image', timeMs };
    return video;
  }, [kind, video, audioFormat, audioQuality, timeMs]);

  const estimatedBytes = useMemo(() => {
    const durationS = Math.max(0, resolveTimelineEndMs(project) / 1000);
    if (settings.kind === 'video') {
      const videoBits = estimateBitrate(settings.width, settings.height, settings.fps, settings.quality);
      const audioBits = settings.includeAudio ? estimateAudioBitrate(settings.quality) : 0;
      return ((videoBits + audioBits) / 8) * durationS;
    }
    if (settings.kind === 'audio') {
      return (estimateAudioBitrate(settings.quality) / 8) * durationS;
    }
    return 0;
  }, [settings, project]);

  function updateContainer(container: ExportContainer): void {
    const info = findContainer(container);
    setVideo((current) => ({
      ...current,
      container,
      videoCodec: info?.videoCodecs.includes(current.videoCodec) ? current.videoCodec : info?.videoCodecs[0] ?? current.videoCodec,
      audioCodec: info?.audioCodecs.includes(current.audioCodec) ? current.audioCodec : info?.audioCodecs[0] ?? current.audioCodec,
    }));
  }

  function updateResolution(id: string): void {
    if (id === 'composition') {
      setVideo((current) => ({ ...current, width: project.composition.width, height: project.composition.height }));
      return;
    }
    const preset = RESOLUTION_PRESETS.find((entry) => entry.id === id);
    if (preset) setVideo((current) => ({ ...current, width: preset.width, height: preset.height }));
  }

  function handleClose(): void {
    if (isBusy) cancel();
    onClose();
  }

  const showActions = !isBusy;

  return (
    <Modal open={open} onClose={handleClose} title="Export">
      <div className="flex flex-col gap-4 p-4">
        <SegmentedControl
          value={kind}
          onValueChange={(value) => {
            if (typeof value === 'string') setKind(value as ExportKind);
          }}
          fill
          label="Export kind"
        >
          <SegmentedControl.Label value="video">Video</SegmentedControl.Label>
          <SegmentedControl.Label value="audio">Audio</SegmentedControl.Label>
          <SegmentedControl.Label value="image">Image</SegmentedControl.Label>
        </SegmentedControl>

        {kind === 'video' ? (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 label-xs text-secondary">
              Container
              <Select
                value={video.container}
                onValueChange={updateContainer}
                options={EXPORT_CONTAINERS.map((entry) => ({ value: entry.id, label: entry.label }))}
                label="Container"
                className="w-full"
              />
            </label>

            <label className="flex flex-col gap-1 label-xs text-secondary">
              Video codec
              <Select
                value={video.videoCodec}
                onValueChange={(videoCodec) => setVideo((current) => ({ ...current, videoCodec }))}
                options={(containerInfo?.videoCodecs ?? []).map((codec) => ({ value: codec, label: VIDEO_CODEC_LABELS[codec] }))}
                label="Video codec"
                className="w-full"
              />
            </label>

            <Checkbox
              checked={video.includeAudio}
              onCheckedChange={(includeAudio) => setVideo((current) => ({ ...current, includeAudio }))}
              label="Include audio"
            />

            {video.includeAudio ? (
              <label className="flex flex-col gap-1 label-xs text-secondary">
                Audio codec
                <Select
                  value={video.audioCodec}
                  onValueChange={(audioCodec) => setVideo((current) => ({ ...current, audioCodec }))}
                  options={(containerInfo?.audioCodecs ?? []).map((codec) => ({ value: codec, label: AUDIO_CODEC_LABELS[codec] }))}
                  label="Audio codec"
                  className="w-full"
                />
              </label>
            ) : null}

            <label className="flex flex-col gap-1 label-xs text-secondary">
              Resolution
              <Select
                value={resolutionOptionId(video, project.composition.width, project.composition.height)}
                onValueChange={updateResolution}
                options={[
                  {
                    value: 'composition',
                    label: `${COMPOSITION_PRESETS.find((preset) => preset.size.width === project.composition.width && preset.size.height === project.composition.height)?.label ?? 'Composition'} (${project.composition.width}×${project.composition.height})`,
                  },
                  ...RESOLUTION_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
                ]}
                label="Resolution"
                className="w-full"
              />
            </label>

            <label className="flex flex-col gap-1 label-xs text-secondary">
              Frame rate
              <Select
                value={String(video.fps)}
                onValueChange={(value) => setVideo((current) => ({ ...current, fps: Number(value) as FrameRate }))}
                options={FRAME_RATES.map((fps) => ({ value: String(fps), label: `${fps} fps` }))}
                label="Frame rate"
                className="w-full"
              />
            </label>

            <label className="flex flex-col gap-1 label-xs text-secondary">
              Quality
              <Select
                value={video.quality}
                onValueChange={(quality) => setVideo((current) => ({ ...current, quality }))}
                options={QUALITIES.map((quality) => ({ value: quality, label: QUALITY_LABELS[quality] }))}
                label="Quality"
                className="w-full"
              />
            </label>
          </div>
        ) : null}

        {kind === 'audio' ? (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 label-xs text-secondary">
              Format
              <Select
                value={audioFormat}
                onValueChange={setAudioFormat}
                options={AUDIO_FORMATS.map((format) => ({ value: format, label: format.toUpperCase() }))}
                label="Format"
                className="w-full"
              />
            </label>
            <label className="flex flex-col gap-1 label-xs text-secondary">
              Quality
              <Select
                value={audioQuality}
                onValueChange={setAudioQuality}
                options={QUALITIES.map((quality) => ({ value: quality, label: QUALITY_LABELS[quality] }))}
                label="Quality"
                className="w-full"
              />
            </label>
          </div>
        ) : null}

        {kind === 'image' ? <div className="label-xs text-secondary">{`At ${(timeMs / 1000).toFixed(2)}s`}</div> : null}

        {kind !== 'image' ? (
          <div className="label-xs text-tertiary">{`Estimated size: ${formatBytes(estimatedBytes)}`}</div>
        ) : null}

        {isBusy ? (
          <div className="flex flex-col gap-2">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-tertiary/40">
              <div className="h-full bg-brand transition-all" style={{ width: `${exportJob.percent}%` }} />
            </div>
            <div className="flex items-center justify-between label-xs text-secondary">
              <span>{`${exportJob.status} · ${exportJob.percent}%`}</span>
              <span>{formatEta(exportJob.etaMs)}</span>
            </div>
            <ReacstButton variant="danger" onClick={() => cancel()}>Cancel</ReacstButton>
          </div>
        ) : isDone ? (
          <div className="flex items-center gap-2">
            <ReacstButton onClick={() => { const path = exportJob.outputPath; if (path) void window.lumachord?.revealPath(path); }}>
              Show in Finder
            </ReacstButton>
            <ReacstButton variant="ghost" onClick={onClose}>Close</ReacstButton>
          </div>
        ) : null}

        {showActions && !isDone ? (
          <ReacstButton variant="take" onClick={() => { void start(settings); }}>Export</ReacstButton>
        ) : null}

        {exportJob.status === 'failed' && exportJob.error ? (
          <div className="label-xs text-error">{exportJob.error}</div>
        ) : null}
      </div>
    </Modal>
  );
}
