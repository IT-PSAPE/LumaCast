import { CAMERA_RESOLUTION_OPTIONS, type CameraFrameRatePreset, type CameraResolutionPreset } from '../shared/desktop-api';

export function cameraCaptureConstraints(
  deviceId?: string,
  resolution: CameraResolutionPreset = 'device-default',
  frameRate?: CameraFrameRatePreset,
): MediaStreamConstraints {
  const selectedResolution = CAMERA_RESOLUTION_OPTIONS.find((option) => option.value === resolution);
  const video: MediaTrackConstraints = {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };
  if (selectedResolution && selectedResolution.value !== 'device-default') {
    const [width, height] = selectedResolution.value.split('x').map(Number);
    video.width = { ideal: width };
    video.height = { ideal: height };
  }
  if (frameRate !== undefined) video.frameRate = { ideal: frameRate };
  return { audio: false, video };
}
