import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import {
  createDefaultProject,
  createDefaultStreamServiceSettings,
  type StreamAPI,
  type StreamProject,
  type StreamRuntimeStatus,
  type StreamServiceSettings,
} from '../../../../apps/stream/shared/desktop-api';
import type { AudioMixerEngine } from '../../../../apps/stream/renderer/audio-mixer';
import { useStreaming } from '../../../../apps/stream/renderer/features/streaming/use-streaming';

const zoomPortMocks = vi.hoisted(() => ({
  waitForZoomMediaPort: vi.fn(),
  discardZoomMediaPort: vi.fn(),
}));

vi.mock('../../../../apps/stream/renderer/features/streaming/zoom-media-port', () => zoomPortMocks);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeTrack {
  stop = vi.fn();
  clone = vi.fn(() => new FakeTrack(this.kind));
  constructor(readonly kind: 'audio' | 'video' = 'audio') {}
}

class FakeMediaStream {
  constructor(private readonly tracks: FakeTrack[]) {}
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === 'video'); }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === 'audio'); }
}

class FakeMediaRecorder extends EventTarget {
  static isTypeSupported = vi.fn(() => true);
  state: RecordingState = 'inactive';

  constructor(_stream: MediaStream, _options?: MediaRecorderOptions) { super(); }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.dispatchEvent(new Event('stop'));
  }
}

function installStreamingMediaFakes() {
  vi.stubGlobal('MediaStream', FakeMediaStream);
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  zoomPortMocks.waitForZoomMediaPort.mockImplementation(async () => ({
    onmessage: null,
    start: vi.fn(),
    close: vi.fn(),
    postMessage: vi.fn(),
  } as unknown as MessagePort));
}

function makeSettings(overrides: Partial<StreamServiceSettings> = {}): StreamServiceSettings {
  const defaults = createDefaultStreamServiceSettings();
  return {
    ...defaults,
    ...overrides,
    youtube: { ...defaults.youtube, ...overrides.youtube },
    zoom: { ...defaults.zoom, ...overrides.zoom },
  };
}

function renderStreaming({
  settings = createDefaultStreamServiceSettings(),
  startYouTubeStreaming = vi.fn().mockResolvedValue('youtube-session'),
  startZoomStreaming = vi.fn().mockResolvedValue('zoom-session'),
  resume = vi.fn().mockResolvedValue(undefined),
}: {
  settings?: StreamServiceSettings;
  startYouTubeStreaming?: ReturnType<typeof vi.fn>;
  startZoomStreaming?: ReturnType<typeof vi.fn>;
  resume?: ReturnType<typeof vi.fn>;
} = {}) {
  installStreamingMediaFakes();
  let onStatus: ((status: StreamRuntimeStatus) => void) | undefined;
  const api = {
    loadStreamServiceSettings: vi.fn().mockResolvedValue(settings),
    saveStreamServiceSettings: vi.fn().mockResolvedValue(undefined),
    onStreamStatus: vi.fn((listener: (status: StreamRuntimeStatus) => void) => {
      onStatus = listener;
      return () => { onStatus = undefined; };
    }),
    startStreaming: vi.fn().mockResolvedValue('manual-session'),
    startYouTubeStreaming,
    startZoomStreaming,
    writeStreamingChunk: vi.fn().mockResolvedValue(undefined),
    stopStreaming: vi.fn().mockResolvedValue(undefined),
    stopZoomStreaming: vi.fn().mockResolvedValue(undefined),
  } as unknown as StreamAPI;
  const project: StreamProject = createDefaultProject('darwin');
  const videoTrack = new FakeTrack('video');
  const canvas = { captureStream: vi.fn(() => new FakeMediaStream([videoTrack])) } as unknown as HTMLCanvasElement;
  const mixer = {
    resume,
    destinationFor: vi.fn(() => ({ stream: new FakeMediaStream([new FakeTrack()]) })),
  } as unknown as AudioMixerEngine;
  const setActionError = vi.fn();
  const result = renderHook(() => useStreaming({
    api,
    project,
    programCanvasRef: { current: canvas },
    ensureMixer: () => mixer,
    setActionError,
  }));
  return { ...result, api, canvas, mixer, setActionError, emitStatus: (status: StreamRuntimeStatus) => onStatus?.(status) };
}

describe('useStreaming selected destinations', () => {
  it('waits for the central start action, then starts selected YouTube and Zoom in parallel without adding manual RTMP', async () => {
    const { result, api } = renderStreaming({
      settings: makeSettings({
        service: 'twitch',
        streamKey: 'saved-manual-key',
        youtube: { ...createDefaultStreamServiceSettings().youtube, broadcastId: 'broadcast-1' },
        zoom: { ...createDefaultStreamServiceSettings().zoom, selectedMeetingId: 'meeting-1' },
      }),
    });
    await waitFor(() => expect(result.current.streamServiceSettings.youtube.broadcastId).toBe('broadcast-1'));

    expect(api.startYouTubeStreaming).not.toHaveBeenCalled();
    expect(api.startZoomStreaming).not.toHaveBeenCalled();
    expect(api.startStreaming).not.toHaveBeenCalled();

    act(() => result.current.startSelectedDestinations());

    await waitFor(() => {
      expect(api.startYouTubeStreaming).toHaveBeenCalledWith('broadcast-1', expect.objectContaining({ width: expect.any(Number) }));
      expect(api.startZoomStreaming).toHaveBeenCalledWith('meeting-1', expect.objectContaining({ width: expect.any(Number) }));
    });
    expect(api.startStreaming).not.toHaveBeenCalled();
    expect(result.current.outputStatuses.youtube?.state).toBe('connecting');
    expect(result.current.outputStatuses.zoom?.state).toBe('connecting');
  });

  it('does not let one provider start failure block the other selected destination', async () => {
    const { result, api } = renderStreaming({
      settings: makeSettings({
        youtube: { ...createDefaultStreamServiceSettings().youtube, broadcastId: 'broadcast-1' },
        zoom: { ...createDefaultStreamServiceSettings().zoom, selectedMeetingId: 'meeting-1' },
      }),
      startYouTubeStreaming: vi.fn().mockRejectedValue(new Error("Error invoking remote method 'stream:start-youtube-streaming': HTTP 403 /private/provider/path")),
    });
    await waitFor(() => expect(result.current.streamServiceSettings.zoom.selectedMeetingId).toBe('meeting-1'));

    act(() => result.current.startSelectedDestinations());

    await waitFor(() => {
      expect(result.current.outputStatuses.youtube?.state).toBe('error');
      expect(api.startZoomStreaming).toHaveBeenCalledWith('meeting-1', expect.any(Object));
      expect(result.current.activeOutputIds).toContain('zoom');
    });
    expect(result.current.outputStatuses.youtube?.message).toBe('YouTube output could not start. Check the stream details and try again.');
    expect(result.current.outputStatuses.zoom?.state).toBe('connecting');
    expect(result.current.outputStatuses.youtube?.message).not.toMatch(/private|HTTP 403|remote method/);
  });

  it('opens the existing manual stream dialog when no provider destination is selected', async () => {
    const { result, api } = renderStreaming({ settings: makeSettings({ streamKey: 'saved-manual-key' }) });
    await waitFor(() => expect(result.current.streamServiceSettings.streamKey).toBe('saved-manual-key'));

    act(() => result.current.startSelectedDestinations());

    expect(result.current.streamDialogOpen).toBe(true);
    expect(api.startYouTubeStreaming).not.toHaveBeenCalled();
    expect(api.startZoomStreaming).not.toHaveBeenCalled();
    expect(api.startStreaming).not.toHaveBeenCalled();
  });

  it('guards duplicate starts while connecting and refuses a new batch while live', async () => {
    const resume = vi.fn();
    const resumeGate = deferred<void>();
    resume.mockReturnValue(resumeGate.promise);
    const { result, api, emitStatus } = renderStreaming({
      settings: makeSettings({
        youtube: { ...createDefaultStreamServiceSettings().youtube, broadcastId: 'broadcast-1' },
        zoom: { ...createDefaultStreamServiceSettings().zoom, selectedMeetingId: 'meeting-1' },
      }),
      resume,
    });
    await waitFor(() => expect(result.current.streamServiceSettings.youtube.broadcastId).toBe('broadcast-1'));

    act(() => result.current.startSelectedDestinations());
    expect(result.current.activeOutputIds).toEqual(expect.arrayContaining(['youtube', 'zoom']));
    act(() => result.current.startSelectedDestinations());
    expect(resume).toHaveBeenCalledTimes(2);

    await act(async () => { resumeGate.resolve(undefined); await resumeGate.promise; });
    await waitFor(() => {
      expect(api.startYouTubeStreaming).toHaveBeenCalledTimes(1);
      expect(api.startZoomStreaming).toHaveBeenCalledTimes(1);
    });
    act(() => emitStatus({ outputId: 'youtube', state: 'live' }));
    act(() => result.current.startSelectedDestinations());
    expect(api.startYouTubeStreaming).toHaveBeenCalledTimes(1);
    expect(api.startZoomStreaming).toHaveBeenCalledTimes(1);
  });

  it('cancels only the selected connecting destination', async () => {
    const zoomStart = deferred<string>();
    const { result, api } = renderStreaming({
      settings: makeSettings({
        youtube: { ...createDefaultStreamServiceSettings().youtube, broadcastId: 'broadcast-1' },
        zoom: { ...createDefaultStreamServiceSettings().zoom, selectedMeetingId: 'meeting-1' },
      }),
      startZoomStreaming: vi.fn(() => zoomStart.promise),
    });
    await waitFor(() => expect(result.current.streamServiceSettings.zoom.selectedMeetingId).toBe('meeting-1'));

    act(() => result.current.startSelectedDestinations());
    await waitFor(() => expect(api.startZoomStreaming).toHaveBeenCalledOnce());
    act(() => result.current.stopStreaming('zoom'));
    await act(async () => { zoomStart.resolve('zoom-session'); await zoomStart.promise; });

    await waitFor(() => expect(api.stopZoomStreaming).toHaveBeenCalledWith('zoom-session'));
    expect(api.stopStreaming).not.toHaveBeenCalled();
    expect(result.current.outputStatuses.zoom?.state).toBe('stopped');
    expect(result.current.outputStatuses.youtube?.state).toBe('connecting');
    expect(result.current.activeOutputIds).toContain('youtube');
    expect(result.current.activeOutputIds).not.toContain('zoom');
  });
});
