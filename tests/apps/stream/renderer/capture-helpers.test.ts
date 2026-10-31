import { afterEach, describe, expect, it, vi } from 'vitest';
import { audioInputCaptureConstraints, explicitAudioInputDevices, getInputCaptureStream, pairedCameraAudioDeviceId } from '../../../../apps/stream/renderer/features/capture/helpers';

const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
afterEach(() => {
  if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
  else Reflect.deleteProperty(navigator, 'mediaDevices');
});

describe('camera audio input selection', () => {
  it('uses an explicit audio device constraint and never falls back to the default input', () => {
    expect(audioInputCaptureConstraints('audio-usb-1')).toEqual({
      video: false,
      audio: {
        deviceId: { exact: 'audio-usb-1' },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  });

  it('pairs a camera only when exactly one audio input shares its hardware group', () => {
    const camera = { deviceId: 'video-1', label: 'Webcam', groupId: 'usb-1' };
    expect(pairedCameraAudioDeviceId(camera, [
      { deviceId: 'audio-1', label: 'Webcam Microphone', groupId: 'usb-1' },
      { deviceId: 'audio-2', label: 'Desk Mic', groupId: 'usb-2' },
    ])).toBe('audio-1');
    expect(pairedCameraAudioDeviceId(camera, [])).toBeUndefined();
    expect(pairedCameraAudioDeviceId(camera, [
      { deviceId: 'audio-1', label: 'Webcam Microphone', groupId: 'usb-1' },
      { deviceId: 'audio-2', label: 'Alternate Webcam Microphone', groupId: 'usb-1' },
    ])).toBeUndefined();
    expect(pairedCameraAudioDeviceId({ deviceId: 'video-1', label: 'Webcam' }, [
      { deviceId: 'default', label: 'Default microphone' },
    ])).toBeUndefined();
    expect(explicitAudioInputDevices([
      { deviceId: 'default', label: 'Default microphone' },
      { deviceId: '', label: 'Unidentified input' },
      { deviceId: 'audio-1', label: 'USB microphone' },
    ])).toEqual([{ deviceId: 'audio-1', label: 'USB microphone' }]);
  });

  it('keeps the camera video stream when the explicitly selected audio input is denied', async () => {
    const videoTrack = { kind: 'video', stop: vi.fn() } as unknown as MediaStreamTrack;
    const videoStream = {
      getTracks: () => [videoTrack],
      getVideoTracks: () => [videoTrack],
      getAudioTracks: () => [],
    } as unknown as MediaStream;
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(videoStream)
      .mockRejectedValueOnce(new Error('Audio permission denied'));
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });

    const result = await getInputCaptureStream('camera', 'video-camera-1', undefined, true, 'audio-input-1');

    expect(result.stream).toBe(videoStream);
    expect(result.audioError).toEqual(new Error('Audio permission denied'));
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[1]?.[0]).toEqual(audioInputCaptureConstraints('audio-input-1'));
    expect(videoTrack.stop).not.toHaveBeenCalled();
  });

  it('does not request a default microphone when camera sound is enabled without a selected device', async () => {
    const videoTrack = { kind: 'video', stop: vi.fn() } as unknown as MediaStreamTrack;
    const videoStream = {
      getTracks: () => [videoTrack],
      getVideoTracks: () => [videoTrack],
      getAudioTracks: () => [],
    } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => videoStream);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });

    const result = await getInputCaptureStream('camera', 'video-camera-1', undefined, true, undefined);

    expect(result.stream).toBe(videoStream);
    expect(result.audioError).toBeInstanceOf(Error);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});
