import { cameraCaptureConstraints } from '../../camera-capture-settings';
import type { StreamSource } from '../../../shared/desktop-api';

export type InputCaptureKind = 'camera' | 'microphone';

export interface InputDeviceOption {
  deviceId: string;
  label: string;
  groupId?: string;
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

export function audioInputCaptureConstraints(deviceId: string): MediaStreamConstraints {
  return {
    video: false,
    audio: { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  };
}

/** Selects audio only when the camera and one audio input share a unique hardware group. */
export function pairedCameraAudioDeviceId(camera: InputDeviceOption, audioInputs: readonly InputDeviceOption[]): string | undefined {
  if (!camera.groupId) return undefined;
  const matches = explicitAudioInputDevices(audioInputs).filter((device) => device.groupId === camera.groupId);
  return matches.length === 1 ? matches[0]?.deviceId : undefined;
}

export function explicitAudioInputDevices(audioInputs: readonly InputDeviceOption[]): InputDeviceOption[] {
  return audioInputs.filter((device) => device.deviceId !== '' && device.deviceId !== 'default');
}

export async function getInputCaptureStream(
  kind: InputCaptureKind,
  deviceId?: string,
  cameraSettings?: Pick<StreamSource, 'cameraResolution' | 'cameraFrameRate'>,
  captureAudioEnabled = false,
  audioDeviceId?: string,
): Promise<{ stream: MediaStream; audioError?: unknown }> {
  const videoOrInputStream = await navigator.mediaDevices.getUserMedia(inputCaptureConstraints(kind, deviceId, cameraSettings));
  if (kind !== 'camera' || !captureAudioEnabled) return { stream: videoOrInputStream };
  if (!audioDeviceId) return { stream: videoOrInputStream, audioError: new Error('Select an audio input to capture camera sound.') };

  try {
    const audioInputStream = await navigator.mediaDevices.getUserMedia(audioInputCaptureConstraints(audioDeviceId));
    const audioTracks = audioInputStream.getAudioTracks();
    if (audioTracks.length === 0) {
      audioInputStream.getTracks().forEach((track) => track.stop());
      return { stream: videoOrInputStream, audioError: new Error('The selected audio input did not provide an audio track.') };
    }
    return { stream: new MediaStream([...videoOrInputStream.getTracks(), ...audioTracks]) };
  } catch (audioError) {
    return { stream: videoOrInputStream, audioError };
  }
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
  return devices.map((device, index) => ({
    deviceId: device.deviceId,
    label: device.label || `${kind === 'camera' ? 'Camera' : 'Microphone'} ${index + 1}`,
    ...(device.groupId ? { groupId: device.groupId } : {}),
  }));
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
