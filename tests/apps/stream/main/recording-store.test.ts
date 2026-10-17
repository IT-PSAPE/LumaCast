// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { RecordingOutputSettings } from '../../../../apps/stream/shared/desktop-api';

import { RecordingStore } from '../../../../apps/stream/main/recording-store';

const recordingSettings: RecordingOutputSettings = {
  container: 'mp4', frameRate: 30, videoBitrateKbps: 8000, audioBitrateKbps: 160, audioTracks: [1],
  rateControl: 'cbr', encoder: 'h264_mf', encoderQuality: 60, hardwareEncoding: false, keyframeIntervalSeconds: 2,
};

function store(): RecordingStore {
  return new RecordingStore(() => null, 'videos');
}

describe('RecordingStore frame-rate validation', () => {
  it.each([1, 59.94, 240])('accepts %s FPS', async (frameRate) => {
    await expect(store().open({ ...recordingSettings, frameRate })).rejects.toThrow('The Stream window is not available.');
  });

  it.each([0, 0.99, 240.01, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid frame rates (%s)', async (frameRate) => {
    await expect(store().open({ ...recordingSettings, frameRate })).rejects.toThrow(/outside the supported range/);
  });
});
