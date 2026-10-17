import { describe, expect, it } from 'vitest';
import { cameraCaptureConstraints } from '../../../../apps/stream/renderer/camera-capture-settings';

describe('camera capture settings', () => {
  it('uses the device default unless a resolution or frame rate is selected', () => {
    expect(cameraCaptureConstraints('camera-1')).toEqual({
      audio: false,
      video: { deviceId: { exact: 'camera-1' } },
    });
    expect(cameraCaptureConstraints()).toEqual({ audio: false, video: {} });
  });

  it('requests selected resolution and frame rate as ideals so unsupported modes can fall back', () => {
    expect(cameraCaptureConstraints('camera-1', '1920x1080', 60)).toEqual({
      audio: false,
      video: {
        deviceId: { exact: 'camera-1' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 60 },
      },
    });
  });

  it('can request a frame rate while leaving resolution to the device', () => {
    expect(cameraCaptureConstraints(undefined, 'device-default', 30)).toEqual({
      audio: false,
      video: { frameRate: { ideal: 30 } },
    });
  });
});
