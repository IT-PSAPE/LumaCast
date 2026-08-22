import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import type { NdiDiagnostics } from '@lumacast/protocol';
import { createDefaultNdiOutputConfigs } from '@lumacast/protocol';
import { AppProvider, useAppStore, useCast, useNdi, useNdiLiveState } from './app-context';

const { recordObsEvent, matchMediaMock, defaultMediaQuery } = vi.hoisted(() => {
  const mediaQuery = {
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const matcher = vi.fn(() => mediaQuery);
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    writable: true,
    value: matcher,
  });
  return {
    recordObsEvent: vi.fn(),
    matchMediaMock: matcher,
    defaultMediaQuery: mediaQuery,
  };
});

vi.mock('../features/observability/metrics-store', () => ({
  recordObsEvent,
}));

const baselineState = useAppStore.getState();

function createDiagnostics({
  audienceSenderName = null,
  stageSenderName = null,
  audienceConnectionCount = audienceSenderName ? 1 : 0,
  stageConnectionCount = stageSenderName ? 1 : 0,
  audienceFramesSent = audienceSenderName ? 1 : 0,
  stageFramesSent = stageSenderName ? 1 : 0,
  lastError = null,
}: {
  audienceSenderName?: string | null;
  stageSenderName?: string | null;
  audienceConnectionCount?: number | null;
  stageConnectionCount?: number | null;
  audienceFramesSent?: number;
  stageFramesSent?: number;
  lastError?: string | null;
} = {}): NdiDiagnostics {
  return {
    outputState: { audience: false, stage: false },
    outputConfig: { senderName: 'Audience', withAlpha: false },
    outputConfigs: createDefaultNdiOutputConfigs(),
    runtimeLoaded: true,
    runtimePath: '/ndi/runtime',
    activeSender: null,
    senders: {
      audience: audienceSenderName
        ? {
            senderName: audienceSenderName,
            width: 1920,
            height: 1080,
            withAlpha: false,
            asyncVideoSend: false,
            connectionCount: audienceConnectionCount,
            tally: null,
            startedAtMs: 1,
            performance: {
              framesCaptured: 0,
              framesSent: audienceFramesSent,
              framesReplayed: 0,
              framesRejected: 0,
              skippedCaptures: 0,
              framesDroppedBackpressure: 0,
              correctiveFrameRetries: 0,
              frameDrops: {
                backpressure: 0,
                ackTimeout: 0,
                captureFailed: 0,
                bitmapFailed: 0,
                invalidPayload: 0,
                outputDisabled: 0,
                senderUnavailable: 0,
                nativeSendFailed: 0,
              },
              bytesReceived: 0,
              cacheCopyBytes: 0,
              avgCaptureDurationMs: 0,
              avgReadbackDurationMs: 0,
              avgSendDurationMs: 0,
              p50SendDurationMs: 0,
              p95SendDurationMs: 0,
              p99SendDurationMs: 0,
              sendIntervalJitterMs: 0,
              lastFrameBytes: 0,
              minFrameBytes: 0,
              maxFrameBytes: 0,
              blackoutFramesSent: 0,
              pipeline: {
                frameAgeAtNativeSend: { p50: 0, p95: 0, lastMs: 0, count: 0 },
                signatureToNativeSend: { p50: 0, p95: 0, lastMs: 0, count: 0 },
                activateToNativeSend: { p50: 0, p95: 0, lastMs: 0, count: 0 },
                takeToNativeSend: { p50: 0, p95: 0, lastMs: 0, count: 0 },
                takeReasonToNativeSend: {
                  sequential: { p50: 0, p95: 0, lastMs: 0, count: 0 },
                  jump: { p50: 0, p95: 0, lastMs: 0, count: 0 },
                  crossItem: { p50: 0, p95: 0, lastMs: 0, count: 0 },
                  macro: { p50: 0, p95: 0, lastMs: 0, count: 0 },
                },
                captureToRendererSend: { p50: 0, p95: 0, lastMs: 0, count: 0 },
                rendererToMainIpc: { p50: 0, p95: 0, lastMs: 0, count: 0 },
                mainHandler: { p50: 0, p95: 0, lastMs: 0, count: 0 },
                mainToHostIpc: { p50: 0, p95: 0, lastMs: 0, count: 0 },
                directWorkerToHostIpc: { p50: 0, p95: 0, lastMs: 0, count: 0 },
                hostToNative: { p50: 0, p95: 0, lastMs: 0, count: 0 },
              },
            },
            audio: {
              audioFramesReceived: 0,
              audioFramesSent: 0,
              audioFramesRejected: 0,
              audioSamplesSent: 0,
              audioSilenceFramesSent: 0,
              lastSampleRate: 48000,
              lastChannels: 2,
            },
          }
        : null,
      stage: stageSenderName
        ? {
            senderName: stageSenderName,
            width: 1920,
            height: 1080,
            withAlpha: false,
            asyncVideoSend: false,
            connectionCount: stageConnectionCount,
            tally: null,
            startedAtMs: 1,
            performance: {
              framesCaptured: 0,
              framesSent: stageFramesSent,
              framesReplayed: 0,
              framesRejected: 0,
              skippedCaptures: 0,
              framesDroppedBackpressure: 0,
              correctiveFrameRetries: 0,
              frameDrops: {
                backpressure: 0,
                ackTimeout: 0,
                captureFailed: 0,
                bitmapFailed: 0,
                invalidPayload: 0,
                outputDisabled: 0,
                senderUnavailable: 0,
                nativeSendFailed: 0,
              },
              bytesReceived: 0,
              cacheCopyBytes: 0,
              avgCaptureDurationMs: 0,
              avgReadbackDurationMs: 0,
              avgSendDurationMs: 0,
              p50SendDurationMs: 0,
              p95SendDurationMs: 0,
              p99SendDurationMs: 0,
              sendIntervalJitterMs: 0,
              lastFrameBytes: 0,
              minFrameBytes: 0,
              maxFrameBytes: 0,
              blackoutFramesSent: 0,
              pipeline: {
                frameAgeAtNativeSend: { p50: 0, p95: 0, lastMs: 0, count: 0 },
                signatureToNativeSend: { p50: 0, p95: 0, lastMs: 0, count: 0 },
                activateToNativeSend: { p50: 0, p95: 0, lastMs: 0, count: 0 },
                takeToNativeSend: { p50: 0, p95: 0, lastMs: 0, count: 0 },
                takeReasonToNativeSend: {
                  sequential: { p50: 0, p95: 0, lastMs: 0, count: 0 },
                  jump: { p50: 0, p95: 0, lastMs: 0, count: 0 },
                  crossItem: { p50: 0, p95: 0, lastMs: 0, count: 0 },
                  macro: { p50: 0, p95: 0, lastMs: 0, count: 0 },
                },
                captureToRendererSend: { p50: 0, p95: 0, lastMs: 0, count: 0 },
                rendererToMainIpc: { p50: 0, p95: 0, lastMs: 0, count: 0 },
                mainHandler: { p50: 0, p95: 0, lastMs: 0, count: 0 },
                mainToHostIpc: { p50: 0, p95: 0, lastMs: 0, count: 0 },
                directWorkerToHostIpc: { p50: 0, p95: 0, lastMs: 0, count: 0 },
                hostToNative: { p50: 0, p95: 0, lastMs: 0, count: 0 },
              },
            },
            audio: {
              audioFramesReceived: 0,
              audioFramesSent: 0,
              audioFramesRejected: 0,
              audioSamplesSent: 0,
              audioSilenceFramesSent: 0,
              lastSampleRate: 48000,
              lastChannels: 2,
            },
          }
        : null,
    },
    availabilityDrops: {
      audience: { outputDisabled: 0, senderUnavailable: 0 },
      stage: { outputDisabled: 0, senderUnavailable: 0 },
    },
    sourceStatus: 'idle',
    lastError,
  };
}

describe('app-context selectors', () => {
  beforeEach(() => {
    cleanup();
    recordObsEvent.mockReset();
    matchMediaMock.mockImplementation(() => defaultMediaQuery);
    useAppStore.setState(baselineState, true);
  });

  afterEach(() => {
    cleanup();
    useAppStore.setState(baselineState, true);
  });

  it('keeps useCast cold when only status text changes', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useCast();
    });

    act(() => {
      useAppStore.setState({ statusText: 'Saving…' });
    });

    expect(renders).toBe(1);

    act(() => {
      useAppStore.setState({ canUndo: true });
    });

    expect(renders).toBe(2);
    expect(result.current.canUndo).toBe(true);
  });

  it('keeps useNdi cold when only diagnostics change', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useNdi();
    });

    act(() => {
      useAppStore.setState({ ndiDiagnostics: createDiagnostics({ audienceSenderName: 'Audience' }) });
    });

    expect(renders).toBe(1);

    act(() => {
      useAppStore.setState({ ndiOutputState: { audience: true, stage: false } });
    });

    expect(renders).toBe(2);
    expect(result.current.state.outputState.audience).toBe(true);
  });

  it('keeps derived NDI live state stable when only sender counters change', () => {
    useAppStore.setState({
      ndiDiagnostics: createDiagnostics({ audienceSenderName: 'Audience', audienceFramesSent: 1 }),
    });

    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useNdiLiveState();
    });

    act(() => {
      useAppStore.setState({
        ndiDiagnostics: createDiagnostics({ audienceSenderName: 'Audience', audienceFramesSent: 2 }),
      });
    });

    expect(renders).toBe(1);
    expect(result.current.audienceLive).toBe(true);

    act(() => {
      useAppStore.setState({
        ndiDiagnostics: createDiagnostics({ audienceSenderName: 'Audience', audienceFramesSent: 0 }),
      });
    });

    expect(renders).toBe(2);
    expect(result.current.audienceLive).toBe(false);
  });
});

describe('AppProvider observability synthesis', () => {
  it('records every sender-name and lastError transition while diagnostics stream', async () => {
    const onNdiDiagnosticsChanged = vi.fn();
    const onNdiOutputStateChanged = vi.fn();
    const onMediaDerivativeProgress = vi.fn();
    const onPersistenceProgress = vi.fn();
    const diagnostics = createDiagnostics();

    Object.defineProperty(window, 'castApi', {
      writable: true,
      value: {
        getSnapshot: vi.fn(() => Promise.resolve(null)),
        getNdiDiagnostics: vi.fn(() => Promise.resolve(diagnostics)),
        getNdiOutputConfigs: vi.fn(() => Promise.resolve(createDefaultNdiOutputConfigs())),
        getNdiOutputState: vi.fn(() => Promise.resolve({ audience: false, stage: false })),
        onNdiOutputStateChanged: vi.fn((listener: (state: { audience: boolean; stage: boolean }) => void) => {
          onNdiOutputStateChanged.mockImplementation(listener);
          return () => {};
        }),
        onNdiDiagnosticsChanged: vi.fn((listener: (next: NdiDiagnostics) => void) => {
          onNdiDiagnosticsChanged.mockImplementation(listener);
          return () => {};
        }),
        onMediaDerivativeProgress: vi.fn((listener: (progress: { statusText: string | null }) => void) => {
          onMediaDerivativeProgress.mockImplementation(listener);
          return () => {};
        }),
        onPersistenceProgress: vi.fn((listener: (progress: import('@lumacast/protocol').PersistenceProgress) => void) => {
          onPersistenceProgress.mockImplementation(listener);
          return () => {};
        }),
      },
    });

    render(<AppProvider><div /></AppProvider>);

    await waitFor(() => {
      expect(window.castApi.onNdiDiagnosticsChanged).toHaveBeenCalled();
      expect(window.castApi.onNdiOutputStateChanged).toHaveBeenCalled();
      expect(window.castApi.onMediaDerivativeProgress).toHaveBeenCalled();
      expect(window.castApi.onPersistenceProgress).toHaveBeenCalled();
    });

    act(() => {
      onNdiDiagnosticsChanged(createDiagnostics({ audienceSenderName: 'Audience A' }));
      onNdiDiagnosticsChanged(createDiagnostics({ audienceSenderName: 'Audience B', lastError: 'boom' }));
      onNdiDiagnosticsChanged(createDiagnostics({ lastError: null }));
      onNdiDiagnosticsChanged(createDiagnostics({ stageSenderName: 'Stage A', lastError: 'boom 2' }));
    });

    expect(recordObsEvent.mock.calls).toEqual([
      ['ndi', 'Sender created', { output: 'audience', senderName: 'Audience A' }],
      ['ndi', 'Sender renamed', { output: 'audience', from: 'Audience A', to: 'Audience B' }],
      ['error', 'NDI error', { error: 'boom' }, 'error'],
      ['ndi', 'Sender destroyed', { output: 'audience', senderName: 'Audience B' }],
      ['ndi', 'Sender created', { output: 'stage', senderName: 'Stage A' }],
      ['error', 'NDI error', { error: 'boom 2' }, 'error'],
    ]);
  });

  it('clears only derivative-owned status text when media derivative progress goes idle', async () => {
    const onMediaDerivativeProgress = vi.fn();
    const onPersistenceProgress = vi.fn();

    Object.defineProperty(window, 'castApi', {
      writable: true,
      value: {
        getSnapshot: vi.fn(() => Promise.resolve(null)),
        getNdiDiagnostics: vi.fn(() => Promise.resolve(createDiagnostics())),
        getNdiOutputConfigs: vi.fn(() => Promise.resolve(createDefaultNdiOutputConfigs())),
        getNdiOutputState: vi.fn(() => Promise.resolve({ audience: false, stage: false })),
        onNdiOutputStateChanged: vi.fn(() => () => {}),
        onNdiDiagnosticsChanged: vi.fn(() => () => {}),
        onMediaDerivativeProgress: vi.fn((listener: (progress: { statusText: string | null }) => void) => {
          onMediaDerivativeProgress.mockImplementation(listener);
          return () => {};
        }),
        onPersistenceProgress: vi.fn((listener: (progress: import('@lumacast/protocol').PersistenceProgress) => void) => {
          onPersistenceProgress.mockImplementation(listener);
          return () => {};
        }),
      },
    });

    render(<AppProvider><div /></AppProvider>);

    await waitFor(() => {
      expect(window.castApi.onMediaDerivativeProgress).toHaveBeenCalled();
      expect(window.castApi.onPersistenceProgress).toHaveBeenCalled();
    });

    act(() => {
      onMediaDerivativeProgress({ statusText: 'Generating media thumbnails 0/3' });
    });
    expect(useAppStore.getState().statusText).toBe('Generating media thumbnails 0/3');

    act(() => {
      onMediaDerivativeProgress({ statusText: null });
    });
    expect(useAppStore.getState().statusText).toBe('Ready');

    act(() => {
      useAppStore.getState().setStatusText('Saving…');
      onMediaDerivativeProgress({ statusText: null });
    });
    expect(useAppStore.getState().statusText).toBe('Saving…');
  });

  it('applies media-derivative progress patches immediately so metadata is not dropped while thumbnails continue', async () => {
    const onMediaDerivativeProgress = vi.fn();

    Object.defineProperty(window, 'castApi', {
      writable: true,
      value: {
        getSnapshot: vi.fn(() => Promise.resolve({
          presentations: [],
          lyrics: [],
          talks: [],
          slides: [],
          talkScriptBlocks: [],
          slideElements: [],
          mediaAssets: [{
            id: 'asset-1',
            name: 'Asset',
            type: 'image',
            src: 'cast-media://asset-1',
            width: null,
            height: null,
            duration: null,
            codec: null,
            order: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          }],
          overlays: [],
          presentationThemes: [],
          lyricThemes: [],
          talkThemes: [],
          overlayThemes: [],
          stages: [],
          playlists: [],
          playlistEntries: [],
          cues: [],
          macros: [],
          triggerBindings: [],
        })),
        getNdiDiagnostics: vi.fn(() => Promise.resolve(createDiagnostics())),
        getNdiOutputConfigs: vi.fn(() => Promise.resolve(createDefaultNdiOutputConfigs())),
        getNdiOutputState: vi.fn(() => Promise.resolve({ audience: false, stage: false })),
        onNdiOutputStateChanged: vi.fn(() => () => {}),
        onNdiDiagnosticsChanged: vi.fn(() => () => {}),
        onMediaDerivativeProgress: vi.fn((listener: (progress: { statusText: string | null; patch?: import('@lumacast/protocol').SnapshotPatch }) => void) => {
          onMediaDerivativeProgress.mockImplementation(listener);
          return () => {};
        }),
        onPersistenceProgress: vi.fn(() => () => {}),
      },
    });

    render(<AppProvider><div /></AppProvider>);

    await waitFor(() => {
      expect(useAppStore.getState().snapshot?.mediaAssets[0]?.id).toBe('asset-1');
      expect(window.castApi.onMediaDerivativeProgress).toHaveBeenCalled();
    });

    act(() => {
      onMediaDerivativeProgress({
        statusText: 'Generating media thumbnails 0/1',
        patch: {
          version: 1,
          deletes: {},
          upserts: {
            mediaAssets: [{
              id: 'asset-1',
              name: 'Asset',
              type: 'image',
              src: 'cast-media://asset-1',
              width: 1920,
              height: 1080,
              duration: null,
              codec: null,
              order: 0,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            }],
          },
        },
      });
    });

    await waitFor(() => {
      expect(useAppStore.getState().snapshot?.mediaAssets[0]?.width).toBe(1920);
      expect(useAppStore.getState().snapshot?.mediaAssets[0]?.height).toBe(1080);
      expect(useAppStore.getState().statusText).toBe('Generating media thumbnails 0/1');
    });
  });
});
