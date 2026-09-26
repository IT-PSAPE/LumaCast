import { describe, expect, it } from 'vitest';
import {
  EXPORT_CONTAINERS,
  defaultExportSettings,
  estimateBitrate,
  exportFileName,
  isCompatible,
  type AudioExportSettings,
  type ImageExportSettings,
  type VideoExportSettings,
} from '../../../../apps/chord/shared/export-presets';
import { createEmptyProject } from '../../../../apps/chord/shared/project-schema';

const NOW = '2026-01-01T00:00:00.000Z';

describe('EXPORT_CONTAINERS', () => {
  it('lists mp4, mov, webm, and mkv with their allowed codec pairs', () => {
    const ids = EXPORT_CONTAINERS.map((c) => c.id);
    expect(ids).toEqual(['mp4', 'mov', 'webm', 'mkv']);
  });

  it('mp4 allows avc/hevc/av1 video and aac/opus audio', () => {
    const mp4 = EXPORT_CONTAINERS.find((c) => c.id === 'mp4')!;
    expect(mp4.videoCodecs.sort()).toEqual(['av1', 'avc', 'hevc'].sort());
    expect(mp4.audioCodecs.sort()).toEqual(['aac', 'opus'].sort());
    expect(mp4.extension).toBe('mp4');
  });

  it('mov allows only avc/hevc video and aac audio', () => {
    const mov = EXPORT_CONTAINERS.find((c) => c.id === 'mov')!;
    expect(mov.videoCodecs.sort()).toEqual(['avc', 'hevc'].sort());
    expect(mov.audioCodecs).toEqual(['aac']);
  });

  it('webm allows only vp9/av1 video and opus audio', () => {
    const webm = EXPORT_CONTAINERS.find((c) => c.id === 'webm')!;
    expect(webm.videoCodecs.sort()).toEqual(['av1', 'vp9'].sort());
    expect(webm.audioCodecs).toEqual(['opus']);
  });

  it('mkv allows every video and audio codec', () => {
    const mkv = EXPORT_CONTAINERS.find((c) => c.id === 'mkv')!;
    expect(mkv.videoCodecs.sort()).toEqual(['av1', 'avc', 'hevc', 'vp9'].sort());
    expect(mkv.audioCodecs.sort()).toEqual(['aac', 'opus'].sort());
  });
});

describe('isCompatible', () => {
  it('accepts a combination listed for its container', () => {
    expect(isCompatible('mp4', 'avc', 'aac')).toBe(true);
    expect(isCompatible('webm', 'vp9', 'opus')).toBe(true);
  });

  it('rejects a video codec not supported by the container', () => {
    expect(isCompatible('mov', 'vp9', 'aac')).toBe(false);
    expect(isCompatible('webm', 'avc', 'opus')).toBe(false);
  });

  it('rejects an audio codec not supported by the container', () => {
    expect(isCompatible('mov', 'avc', 'opus')).toBe(false);
  });

  it('rejects an unknown container', () => {
    expect(isCompatible('avi' as never, 'avc', 'aac')).toBe(false);
  });
});

describe('defaultExportSettings', () => {
  it('defaults to mp4/avc/aac at the composition size, fps, and high quality', () => {
    const project = createEmptyProject(NOW, 'p1');
    const settings = defaultExportSettings(project);
    expect(settings).toEqual({
      kind: 'video',
      container: 'mp4',
      videoCodec: 'avc',
      audioCodec: 'aac',
      width: 1920,
      height: 1080,
      fps: 30,
      quality: 'high',
      includeAudio: true,
    });
  });

  it('follows a non-default composition size/fps', () => {
    const project = createEmptyProject(NOW, 'p1');
    project.composition.width = 1080;
    project.composition.height = 1920;
    project.composition.fps = 60;
    const settings = defaultExportSettings(project);
    expect(settings.width).toBe(1080);
    expect(settings.height).toBe(1920);
    expect(settings.fps).toBe(60);
  });
});

describe('exportFileName', () => {
  it('uses the container extension for video settings', () => {
    const settings: VideoExportSettings = {
      kind: 'video',
      container: 'webm',
      videoCodec: 'vp9',
      audioCodec: 'opus',
      width: 1920,
      height: 1080,
      fps: 30,
      quality: 'high',
      includeAudio: true,
    };
    expect(exportFileName('My Song', settings)).toBe('My Song.webm');
  });

  it('uses the audio format as the extension for audio-only settings', () => {
    const settings: AudioExportSettings = { kind: 'audio', format: 'mp3', quality: 'medium' };
    expect(exportFileName('My Song', settings)).toBe('My Song.mp3');
  });

  it('uses png for image-frame settings', () => {
    const settings: ImageExportSettings = { kind: 'image', timeMs: 1000 };
    expect(exportFileName('My Song', settings)).toBe('My Song.png');
  });

  it('strips characters unsafe in file names', () => {
    const settings: ImageExportSettings = { kind: 'image', timeMs: 0 };
    expect(exportFileName('My/Song: "Live"?*<>|', settings)).toBe('My-Song- -Live-.png');
  });

  it('collapses internal whitespace and trims', () => {
    const settings: ImageExportSettings = { kind: 'image', timeMs: 0 };
    expect(exportFileName('  My   Song  ', settings)).toBe('My Song.png');
  });

  it('falls back to Untitled for an empty or whitespace-only title', () => {
    const settings: ImageExportSettings = { kind: 'image', timeMs: 0 };
    expect(exportFileName('', settings)).toBe('Untitled.png');
    expect(exportFileName('   ', settings)).toBe('Untitled.png');
  });

  it('still produces a valid file name for a title made only of unsafe characters', () => {
    const settings: ImageExportSettings = { kind: 'image', timeMs: 0 };
    expect(exportFileName('///', settings)).toBe('-.png');
  });
});

describe('estimateBitrate', () => {
  it('is about 12 Mbps for 1080p30 high quality', () => {
    expect(estimateBitrate(1920, 1080, 30, 'high')).toBe(12_000_000);
  });

  it('scales linearly with quality tier at the reference resolution/fps', () => {
    expect(estimateBitrate(1920, 1080, 30, 'low')).toBe(4_000_000);
    expect(estimateBitrate(1920, 1080, 30, 'medium')).toBe(8_000_000);
    expect(estimateBitrate(1920, 1080, 30, 'very-high')).toBe(20_000_000);
  });

  it('scales with pixel count for a larger frame at the same fps/quality', () => {
    const hd = estimateBitrate(1920, 1080, 30, 'high');
    const uhd = estimateBitrate(3840, 2160, 30, 'high');
    expect(uhd).toBeCloseTo(hd * 4, -3);
  });

  it('scales with fps at the same resolution/quality', () => {
    const at30 = estimateBitrate(1920, 1080, 30, 'high');
    const at60 = estimateBitrate(1920, 1080, 60, 'high');
    expect(at60).toBeCloseTo(at30 * 2, -3);
  });
});
