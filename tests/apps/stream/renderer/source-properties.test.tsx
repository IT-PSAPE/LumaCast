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

function playbackSources(): StreamSource[] {
  const transform = { x: 0, y: 0, width: 100, height: 100 };
  const common = { visible: true, muted: false, volume: 1, transform };
  return [
    mediaSource(),
    { id: 'browser-1', name: 'Browser', kind: 'browser', ...common, url: 'https://example.com' },
    { id: 'slideshow-1', name: 'Slideshow', kind: 'slideshow', ...common, slideshowImages: [{ assetId: '00000000-0000-4000-8000-000000000021', assetExtension: 'png', name: 'Slide' }] },
    { id: 'presentation-1', name: 'Presentation', kind: 'presentation', ...common, presentationSlides: [{ assetId: '00000000-0000-4000-8000-000000000022', assetExtension: 'png', name: 'Slide' }] },
  ];
}

function renderProperties(playbackInProgram: boolean, source: StreamSource = mediaSource()) {
  const onTogglePlayback = vi.fn();
  const onRestartPlayback = vi.fn();
  const onStopPlayback = vi.fn();
  const onUpdateCameraAudioSettings = vi.fn();
  const onToggleDesktopCaptureAudio = vi.fn();
  const onOpenCapturePicker = vi.fn();
  const onUpdateSource = vi.fn<SourcePropertiesProps['onUpdateSource']>();
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
    onUpdateSource,
    onUpdateTextStyle: noOp,
    onSwitchInputDevice: noOp,
    onUpdateCameraAudioSettings,
    onToggleDesktopCaptureAudio,
    onUpdateCameraCaptureSettings: noOp,
    onAddSystemAudioCapture: noOp,
    onOpenApplicationAudioPicker: noOp,
    onOpenCapturePicker,
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
  return { onTogglePlayback, onRestartPlayback, onStopPlayback, onUpdateCameraAudioSettings, onToggleDesktopCaptureAudio, onOpenCapturePicker, onUpdateSource, source };
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
    expect(screen.getByRole('checkbox', { name: 'Reset when entering Program' })).toBeInTheDocument();
  });

  it('keeps playback controls available for the Program resource', () => {
    const { onRestartPlayback } = renderProperties(true);

    expect(document.querySelector('.media-playback-scope')).toHaveTextContent('Program playback');
    const restart = screen.getByRole('button', { name: 'Restart' });
    expect(restart).toBeEnabled();
    fireEvent.click(restart);
    expect(onRestartPlayback).toHaveBeenCalledWith('media-1');
  });

  it.each(playbackSources())('defaults the Program reset option off and updates the selected $kind source', (source) => {
    const { onUpdateSource } = renderProperties(false, source);
    const reset = screen.getByRole('checkbox', { name: 'Reset when entering Program' });

    expect(reset).not.toBeChecked();
    fireEvent.click(reset);

    const [sourceId, update] = onUpdateSource.mock.calls[0]!;
    expect(sourceId).toBe(source.id);
    expect(update(source)).toEqual({ ...source, restartPlaybackWhenActive: true });
  });

  it.each(playbackSources())('reflects an explicit Program reset option on $kind sources', (source) => {
    source.restartPlaybackWhenActive = true;
    renderProperties(false, source);

    expect(screen.getByRole('checkbox', { name: 'Reset when entering Program' })).toBeChecked();
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

  it('shows window audio as unavailable and does not offer a way to rebind it', () => {
    const source: StreamSource = {
      id: 'window-1', name: 'Window', kind: 'window', visible: true, muted: false, volume: 1,
      transform: { x: 0, y: 0, width: 320, height: 240 }, captureAudioEnabled: false,
    };
    const handlers = renderProperties(false, source);
    const toggle = screen.getByRole('checkbox', { name: 'Capture audio' });
    expect(toggle).not.toBeChecked();
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Window-only audio is unavailable. Use a Browser source for isolated page audio.')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(handlers.onToggleDesktopCaptureAudio).not.toHaveBeenCalled();
    expect(handlers.onOpenCapturePicker).not.toHaveBeenCalled();
  });

  it('suppresses legacy application audio settings on window sources', () => {
    const source = {
      id: 'window-1', name: 'Window', kind: 'window', visible: true, muted: false, volume: 1,
      transform: { x: 0, y: 0, width: 320, height: 240 }, captureAudioEnabled: true,
      captureAudioMode: 'application', captureAudioApplicationPath: 'C:\\Program Files\\Editor\\Editor.exe',
    } as StreamSource;
    const handlers = renderProperties(false, source);

    expect(screen.getByRole('checkbox', { name: 'Capture audio' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Capture audio' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByText('Editor.exe')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change audio' })).not.toBeInTheDocument();
    expect(handlers.onToggleDesktopCaptureAudio).not.toHaveBeenCalled();
    expect(handlers.onOpenCapturePicker).not.toHaveBeenCalled();
  });

  it('suppresses legacy system audio settings on window sources', () => {
    const source = {
      id: 'window-1', name: 'Window', kind: 'window', visible: true, muted: false, volume: 1,
      transform: { x: 0, y: 0, width: 320, height: 240 }, captureAudioEnabled: true,
      captureAudioMode: 'system',
    } as StreamSource;
    renderProperties(false, source);

    expect(screen.getByRole('checkbox', { name: 'Capture audio' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Capture audio' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Window-only audio is unavailable. Use a Browser source for isolated page audio.')).toBeInTheDocument();
  });
});
