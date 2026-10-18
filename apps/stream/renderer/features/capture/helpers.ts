import { cameraCaptureConstraints } from '../../camera-capture-settings';
import type { StreamSource } from '../../../shared/desktop-api';

export type InputCaptureKind = 'camera' | 'microphone';

export interface InputDeviceOption {
  deviceId: string;
  label: string;
}

export interface BrowserSourceConfig {
  id: string;
  url: string;
  width: number;
  height: number;
}

export function inputCaptureConstraints(kind: InputCaptureKind, deviceId?: string, cameraSettings?: Pick<StreamSource, 'cameraResolution' | 'cameraFrameRate'>): MediaStreamConstraints {
  const selectedDevice = deviceId ? { deviceId: { exact: deviceId } } : {};
  if (kind === 'camera') return cameraCaptureConstraints(deviceId, cameraSettings?.cameraResolution, cameraSettings?.cameraFrameRate);
  return { video: false, audio: { ...selectedDevice, echoCancellation: false, noiseSuppression: false, autoGainControl: false } };
}

export function browserAudioCaptureConstraints(captureId: string): MediaStreamConstraints {
  return {
    video: false,
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: captureId, echoCancellation: false } },
  } as unknown as MediaStreamConstraints;
}

export async function listInputDevices(kind: InputCaptureKind): Promise<InputDeviceOption[]> {
  const type = kind === 'camera' ? 'videoinput' : 'audioinput';
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === type);
  return devices.map((device, index) => ({ deviceId: device.deviceId, label: device.label || `${kind === 'camera' ? 'Camera' : 'Microphone'} ${index + 1}` }));
}

export function monitoringDeviceError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Audio output permission was denied. Using System Default.';
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'The selected audio output is unavailable. Using System Default.';
  return 'Could not change the monitoring device. Using System Default.';
}

export function applyBrowserFrame(image: HTMLImageElement, frame: ArrayBuffer): void {
  const nextUrl = URL.createObjectURL(new Blob([frame], { type: 'image/jpeg' }));
  const previousUrl = image.dataset.browserFrameUrl;
  image.dataset.browserFrameUrl = nextUrl;
  image.src = nextUrl;
  if (previousUrl) URL.revokeObjectURL(previousUrl);
}
