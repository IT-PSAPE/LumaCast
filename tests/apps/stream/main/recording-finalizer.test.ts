// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildRecordingMuxArguments } from '../../../../apps/stream/main/recording-finalizer';
import type { RecordingOutputSettings } from '../../../../apps/stream/shared/desktop-api';

const settings: RecordingOutputSettings = {
  container: 'mkv',
  frameRate: 30,
  videoBitrateKbps: 8000,
  audioBitrateKbps: 160,
  audioTracks: [1, 3, 6],
  rateControl: 'cbr',
  encoder: 'h264_mf',
  encoderQuality: 60,
  hardwareEncoding: false,
  keyframeIntervalSeconds: 2,
};

describe('Stream multitrack recording muxing', () => {
  it('maps each selected isolated audio input into the final file in track order', () => {
    const args = buildRecordingMuxArguments({
      videoPath: 'capture-video.webm',
      audioTracks: [
        { track: 1, path: 'capture-audio-1.webm' },
        { track: 3, path: 'capture-audio-3.webm' },
        { track: 6, path: 'capture-audio-6.webm' },
      ],
    }, 'recording.mkv', settings);

    expect(args).toEqual(expect.arrayContaining([
      '-i', 'capture-video.webm', '-i', 'capture-audio-1.webm', '-i', 'capture-audio-3.webm', '-i', 'capture-audio-6.webm',
      '-map', '0:v:0', '-map', '1:a:0', '-map', '2:a:0', '-map', '3:a:0',
      'title=Track 1', 'title=Track 3', 'title=Track 6', '-c', 'copy', '-f', 'matroska', 'recording.mkv',
    ]));
  });

  it('encodes each selected audio stream as AAC for MP4 output', () => {
    const args = buildRecordingMuxArguments({
      videoPath: 'capture-video.webm',
      audioTracks: [{ track: 2, path: 'capture-audio-2.webm' }],
    }, 'recording.mp4', { ...settings, container: 'mp4', audioTracks: [2] });

    expect(args).toContain('-map');
    expect(args).toContain('1:a:0');
    expect(args).toEqual(expect.arrayContaining(['-c:a', 'aac', '-b:a', '160k', '-f', 'mp4', 'recording.mp4']));
  });

  it('omits audio encoder settings when the recording has no selected audio tracks', () => {
    const args = buildRecordingMuxArguments({ videoPath: 'capture-video.webm', audioTracks: [] }, 'recording.mp4', { ...settings, container: 'mp4', audioTracks: [] });
    expect(args).not.toContain('-c:a');
    expect(args).toEqual(expect.arrayContaining(['-map', '0:v:0', '-f', 'mp4', 'recording.mp4']));
  });
});
