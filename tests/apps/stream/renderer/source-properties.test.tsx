import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SourceProperties, type SourcePropertiesProps } from '../../../../apps/stream/renderer/docks/source-properties';
import type { StreamProject, StreamSource } from '../../../../apps/stream/shared/desktop-api';

afterEach(cleanup);

function mediaSource(): StreamSource {
  return {
    id: 'media-1',
    name: 'Clip',
    kind: 'media',
    mediaKind: 'audio',
    visible: true,
    muted: false,
    volume: 1,
    transform: { x: 0, y: 0, width: 100, height: 100 },
  };
}

function renderProperties(playbackInProgram: boolean, source: StreamSource = mediaSource()) {
  const onTogglePlayback = vi.fn();
  const onRestartPlayback = vi.fn();
  const onStopPlayback = vi.fn();
  const onUpdateCameraAudioSettings = vi.fn();
  const onToggleDesktopCaptureAudio = vi.fn();
  const noOp = vi.fn();
  const props: SourcePropertiesProps = {
    source,
    project: { scenes: [] } as unknown as StreamProject,
    activeSceneId: 'scene-1',
    referenceableScenes: [],
    platform: 'win32',
    working: false,
    desktopAudioMode: 'unavailable',
    inputDeviceOptions: { camera: [], microphone: [{ deviceId: 'mic-1', label: 'Webcam Microphone' }] },
    runtimesSnapshot: new Map(),
    mediaElements: new Map([['media-1', {} as HTMLMediaElement]]),
    mediaPlaybackStates: { 'media-1': { paused: false, ended: false } },
    playbackInProgram,
    textStyle: null,
    filters: { brightness: 100, contrast: 100, saturation: 100, opacity: 100, blur: 0 },
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    chromaKey: { enabled: false, keyColor: '#00ff00', similarity: 0, smoothness: 0 },
    hasAudioMeter: false,
    onRemove: noOp,
    onUpdateSource: noOp,
    onUpdateTextStyle: noOp,
    onSwitchInputDevice: noOp,
    onUpdateCameraAudioSettings,
    onToggleDesktopCaptureAudio,
    onUpdateCameraCaptureSettings: noOp,
    onAddSystemAudioCapture: noOp,
    onOpenApplicationAudioPicker: noOp,
    onOpenCapturePicker: noOp,
    onUpdateCaptureCursorMode: noOp,
    onUpdateSourceTransform: noOp,
    onFitSource: noOp,
    onCenterSource: noOp,
    onResetTransform: noOp,
    onTogglePlayback,
    onRestartPlayback,
    onStopPlayback,
    onMoveSlideshowImage: noOp,
    onRemoveSlideshowImage: noOp,
    onAddSlideshowImage: noOp,
    onUpdateBrowserAudio: noOp,
    onUpdateSourceSettings: noOp,
    onUpdateSourceMonitoring: noOp,
    onUpdateSourceAudioTrack: noOp,
    onUpdateSourceAudioFilters: noOp,
    onUpdateSourceFilters: noOp,
    onUpdateSourceCrop: noOp,
    onUpdateSourceChromaKey: noOp,
  };
  render(<SourceProperties {...props} />);
  return { onTogglePlayback, onRestartPlayback, onStopPlayback, onUpdateCameraAudioSettings, onToggleDesktopCaptureAudio, source };
}

describe('SourceProperties media playback', () => {
  it('disables on-air playback controls for a Preview-only resource', () => {
    const handlers = renderProperties(false);

    expect(document.querySelector('.media-playback-scope')).toHaveTextContent('Starts in Program');
    const controls = ['Pause', 'Restart', 'Stop'].map((name) => screen.getByRole('button', { name }));
    expect(controls.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    expect(handlers.onTogglePlayback).not.toHaveBeenCalled();
    expect(handlers.onRestartPlayback).not.toHaveBeenCalled();
    expect(handlers.onStopPlayback).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: 'Restart when entering Program' })).toBeInTheDocument();
  });

  it('keeps playback controls available for the Program resource', () => {
    const { onRestartPlayback } = renderProperties(true);

    expect(document.querySelector('.media-playback-scope')).toHaveTextContent('Program playback');
    const restart = screen.getByRole('button', { name: 'Restart' });
    expect(restart).toBeEnabled();
    fireEvent.click(restart);
    expect(onRestartPlayback).toHaveBeenCalledWith('media-1');
  });
});

describe('SourceProperties camera audio', () => {
  it('exposes an explicit audio input and updates the audio toggle without choosing a default microphone', () => {
    const source: StreamSource = {
      id: 'camera-1', name: 'Webcam', kind: 'camera', visible: true, muted: false, volume: 1,
      transform: { x: 0, y: 0, width: 320, height: 240 }, captureAudioEnabled: true,
    };
    const handlers = renderProperties(false, source);
    expect(screen.getByRole('combobox', { name: 'Audio input' })).toBeInTheDocument();
    expect(screen.getByText('Select an audio input')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Capture audio' }));
    expect(handlers.onUpdateCameraAudioSettings).toHaveBeenCalledWith(source, { captureAudioEnabled: false, audioDeviceId: undefined });
  });

  it('shows a truthful system-audio toggle for a window source', () => {
    const source: StreamSource = {
      id: 'window-1', name: 'Window', kind: 'window', visible: true, muted: false, volume: 1,
      transform: { x: 0, y: 0, width: 320, height: 240 },
    };
    const handlers = renderProperties(false, source);
    const toggle = screen.getByRole('checkbox', { name: 'Capture system audio' });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(handlers.onToggleDesktopCaptureAudio).toHaveBeenCalledWith(source, false);
  });
});
