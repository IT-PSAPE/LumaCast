import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

const mocks = vi.hoisted(() => {
  const stageCanvas = document.createElement('canvas');
  const setPixelRatio = vi.fn();
  const stage = {
    batchDraw: vi.fn(),
    getLayers: () => [{
      getCanvas: () => ({
        getPixelRatio: () => 1,
        setPixelRatio,
      }),
      getNativeCanvasElement: () => stageCanvas,
    }],
  };
  const outputConfigs = {
    audience: { senderName: 'Audience', withAlpha: false },
    stage: { senderName: 'Stage', withAlpha: false },
  };
  const releaseListeners = new Set<(release: { name: string; attemptId?: string; accepted: boolean; reason: string; releasedAtMs: number }) => void>();
  const sendNdiFrame = vi.fn();
  const createImageBitmap = vi.fn(async () => ({ close: vi.fn() }));
  const rafCallbacks = new Map<number, FrameRequestCallback>();
  let nextRafId = 0;

  const workerInstances: MockWorker[] = [];

  class MockWorker {
    onmessage: ((event: MessageEvent<Record<string, unknown>>) => void) | null = null;

    constructor() {
      workerInstances.push(this);
    }

    postMessage = vi.fn((request: Record<string, unknown>) => {
      if (request.type === 'attach-transport' || request.type === 'reset-transport') return;
      queueMicrotask(() => {
        if (request.type === 'capture') {
          this.emit({
            type: 'readback-complete',
            requestId: request.requestId,
            width: 1920,
            height: 1080,
            readbackDurationMs: 2,
          });
        } else if (request.type === 'submit-frame') {
          this.emit({
            type: 'captured',
            requestId: request.requestId,
            buffer: new ArrayBuffer(16),
            width: 1920,
            height: 1080,
            telemetry: request.telemetry,
          });
        }
      });
    });

    emit(data: Record<string, unknown>) {
      this.onmessage?.({ data } as MessageEvent<Record<string, unknown>>);
    }

    terminate = vi.fn();
  }

  function requestAnimationFrame(callback: FrameRequestCallback): number {
    nextRafId += 1;
    rafCallbacks.set(nextRafId, callback);
    return nextRafId;
  }

  function cancelAnimationFrame(id: number): void {
    rafCallbacks.delete(id);
  }

  return {
    MockWorker,
    cancelAnimationFrame,
    createImageBitmap,
    emitRelease(release: { name: string; attemptId?: string; accepted: boolean; reason: string; releasedAtMs: number }) {
      act(() => {
        for (const listener of releaseListeners) listener(release);
      });
    },
    flushRaf(timestamp: number) {
      act(() => {
        const callbacks = Array.from(rafCallbacks.values());
        rafCallbacks.clear();
        callbacks.forEach((callback) => callback(timestamp));
      });
    },
    outputConfigs,
    registerReleaseListener(listener: (release: { name: string; attemptId?: string; accepted: boolean; reason: string; releasedAtMs: number }) => void) {
      releaseListeners.add(listener);
      return () => { releaseListeners.delete(listener); };
    },
    requestAnimationFrame,
    reset() {
      releaseListeners.clear();
      rafCallbacks.clear();
      nextRafId = 0;
      sendNdiFrame.mockReset();
      createImageBitmap.mockClear();
      setPixelRatio.mockClear();
      stage.batchDraw.mockClear();
      workerInstances.length = 0;
    },
    sendNdiFrame,
    setPixelRatio,
    stage,
    stageCanvas,
    workerInstances,
  };
});

vi.mock('react-konva', async () => {
  const ReactModule = await import('react');
  const h = ReactModule.createElement;
  const Stage = ReactModule.forwardRef<unknown, { children?: React.ReactNode }>(({ children }, ref) => {
    if (typeof ref === 'function') ref(mocks.stage);
    else if (ref && typeof ref === 'object') (ref as { current: unknown }).current = mocks.stage;
    return h('div', { 'data-testid': 'stage' }, children);
  });
  const Layer = ({ children }: { children?: React.ReactNode }) => h('div', null, children);
  const Group = ({ children }: { children?: React.ReactNode }) => h('div', null, children);
  return { Stage, Layer, Group };
});

vi.mock('../../contexts/app-context', () => ({
  useNdi: () => ({
    state: { outputConfigs: mocks.outputConfigs },
  }),
}));

vi.mock('@lumacast/canvas', () => ({
  SceneNodeShape: () => null,
  SceneSlideBackground: ({
    background,
    onMediaLoad,
  }: {
    background: { type: string } | null | undefined;
    onMediaLoad?: () => void;
  }) => (
    background ? <button data-testid="background-load" onClick={() => onMediaLoad?.()} /> : null
  ),
  needsOpaqueBackdrop: () => false,
  renderSceneNodeContent: (
    _node: unknown,
    _surface: string,
    options?: { onMediaLoad?: () => void },
  ) => (
    <button data-testid="node-load" onClick={() => options?.onMediaLoad?.()} />
  ),
  useBinding: () => ({
    currentSlideText: '',
    nextSlideText: '',
    slideNotes: '',
    talkScriptCurrent: '',
    talkScriptProgress: '',
    armedAtMs: null,
  }),
}));

vi.mock('@lumacast/composition', () => ({
  traverseSceneNodes: (nodes: Array<{ id: string }>) => nodes.map((node) => ({
    node,
    frame: {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      scaleX: 1,
      scaleY: 1,
      offsetX: 0,
      offsetY: 0,
    },
  })),
}));

vi.mock('./ndi-capture-source', () => ({
  useNdiCaptureSource: () => null,
}));

vi.mock('./ndi-readback-worker?worker', () => ({
  default: mocks.MockWorker,
}));

import {
  allocateNdiCaptureAttemptId,
  createEmptyFrameDropReasons,
  doesReleaseMatchAttempt,
  NdiFrameCapture,
  pinFallbackCaptureStagePixelRatio,
  sceneHasVideoPlayback,
  shouldScheduleCorrectiveRetry,
} from './ndi-frame-capture';

async function flushCapture(timestamp: number): Promise<void> {
  await act(async () => {
    mocks.flushRaf(timestamp);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function attemptCounter(attemptId: string): number {
  const suffix = attemptId.split(':').at(-1) ?? '';
  return Number.parseInt(suffix, 10);
}

function createScene(overrides: Partial<{
  slideId: string;
  background: { type: 'image' | 'video'; src: string; fit: 'cover' | 'contain' };
  nodes: Array<{ id: string; element: { type: string; updatedAt: string; payload?: Record<string, unknown> }; visual: { visible: boolean } }>;
}> = {}) {
  return {
    width: 1920,
    height: 1080,
    slide: {
      id: overrides.slideId ?? 'slide-1',
      background: overrides.background ?? null,
    },
    nodes: overrides.nodes ?? [],
  } as const;
}

beforeEach(() => {
  vi.stubGlobal('createImageBitmap', mocks.createImageBitmap);
  vi.stubGlobal('requestAnimationFrame', mocks.requestAnimationFrame);
  vi.stubGlobal('cancelAnimationFrame', mocks.cancelAnimationFrame);
  const castApiStub = {
    requestNdiFrameTransport: vi.fn(),
    sendNdiFrame: mocks.sendNdiFrame,
    onNdiFrameReleased: mocks.registerReleaseListener,
  };
  window.castApi = castApiStub as unknown as typeof window.castApi;
});

afterEach(() => {
  cleanup();
  mocks.reset();
  vi.unstubAllGlobals();
});

describe('ndi-frame-capture fallback pixel ratio', () => {
  it('pins the offscreen fallback stage to pixel ratio 1', () => {
    const setPixelRatio = vi.fn();
    const stage = {
      batchDraw: vi.fn(),
      getLayers: () => [{
        getCanvas: () => ({
          getPixelRatio: () => 2,
          setPixelRatio,
        }),
      }],
    };

    pinFallbackCaptureStagePixelRatio(stage as never);

    expect(setPixelRatio).toHaveBeenCalledWith(1);
    expect(stage.batchDraw).toHaveBeenCalledTimes(1);
  });

  it('does not redraw when the fallback stage is already pixel ratio 1', () => {
    const setPixelRatio = vi.fn();
    const stage = {
      batchDraw: vi.fn(),
      getLayers: () => [{
        getCanvas: () => ({
          getPixelRatio: () => 1,
          setPixelRatio,
        }),
      }],
    };

    pinFallbackCaptureStagePixelRatio(stage as never);

    expect(setPixelRatio).not.toHaveBeenCalled();
    expect(stage.batchDraw).not.toHaveBeenCalled();
  });
});

describe('ndi-frame-capture helpers', () => {
  it('starts every drop-reason bucket at zero', () => {
    expect(createEmptyFrameDropReasons()).toEqual({
      backpressure: 0,
      ackTimeout: 0,
      captureFailed: 0,
      bitmapFailed: 0,
      invalidPayload: 0,
      outputDisabled: 0,
      senderUnavailable: 0,
      nativeSendFailed: 0,
    });
  });

  it('schedules a corrective retry only for native send failures', () => {
    expect(shouldScheduleCorrectiveRetry({
      name: 'audience',
      accepted: false,
      reason: 'nativeSendFailed',
      releasedAtMs: 1,
    })).toBe(true);

    expect(shouldScheduleCorrectiveRetry({
      name: 'audience',
      accepted: false,
      reason: 'invalidPayload',
      releasedAtMs: 1,
    })).toBe(false);
  });

  it('only frees the in-flight slot for the matching frame attempt', () => {
    expect(doesReleaseMatchAttempt({
      name: 'audience',
      attemptId: 'session:7',
      accepted: true,
      reason: 'sent',
      releasedAtMs: 1,
    }, { attemptId: 'session:7' })).toBe(true);

    expect(doesReleaseMatchAttempt({
      name: 'audience',
      attemptId: 'session:6',
      accepted: true,
      reason: 'sent',
      releasedAtMs: 1,
    }, { attemptId: 'session:7' })).toBe(false);
  });

  it('treats slide background video as active video playback', () => {
    expect(sceneHasVideoPlayback(createScene({
      background: { type: 'video', src: 'asset://background.mp4', fit: 'cover' },
    }) as never)).toBe(true);
  });

  it('allocates capture attempt ids monotonically across calls', () => {
    const first = allocateNdiCaptureAttemptId();
    const second = allocateNdiCaptureAttemptId();
    expect(second).toBeGreaterThan(first);
  });
});

describe('NdiFrameCapture integration', () => {
  it('requests a direct transport and transfers only a trusted matching port to its worker', () => {
    const requestNdiFrameTransport = vi.mocked(window.castApi.requestNdiFrameTransport);
    render(
      <NdiFrameCapture
        senderName="audience"
        scene={createScene() as never}
        outputScopeKey="entry:playlist-1"
        enabled
      />,
    );
    expect(requestNdiFrameTransport).toHaveBeenCalledWith('audience');

    const worker = mocks.workerInstances[0]!;
    const foreignPort = { close: vi.fn() } as unknown as MessagePort;
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'lumacast:ndi-frame-transport-port', version: 1, name: 'audience' },
      origin: 'https://foreign.invalid',
      source: window,
      ports: [foreignPort],
    }));
    expect(worker.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'attach-transport' }),
      expect.anything(),
    );
    expect(foreignPort.close).toHaveBeenCalledTimes(1);

    const otherOutputPort = { close: vi.fn() } as unknown as MessagePort;
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'lumacast:ndi-frame-transport-port', version: 1, name: 'stage' },
      origin: window.location.origin,
      source: window,
      ports: [otherOutputPort],
    }));
    expect(otherOutputPort.close).not.toHaveBeenCalled();

    const port = { close: vi.fn() } as unknown as MessagePort;
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'lumacast:ndi-frame-transport-port', version: 1, name: 'audience' },
      origin: window.location.origin,
      source: window,
      ports: [port],
    }));
    expect(worker.postMessage).toHaveBeenCalledWith(
      { type: 'attach-transport', name: 'audience', port },
      [port],
    );
  });

  it('requests a replacement transport when the worker reports fallback', () => {
    vi.useFakeTimers();
    const requestNdiFrameTransport = vi.mocked(window.castApi.requestNdiFrameTransport);
    render(
      <NdiFrameCapture
        senderName="audience"
        scene={createScene() as never}
        outputScopeKey="entry:playlist-1"
        enabled
      />,
    );
    const worker = mocks.workerInstances[0]!;
    expect(requestNdiFrameTransport).toHaveBeenCalledTimes(1);

    act(() => {
      worker.emit({ type: 'transport-fallback', name: 'audience' });
    });

    expect(requestNdiFrameTransport).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(500));
    expect(requestNdiFrameTransport).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(1_000));
    expect(requestNdiFrameTransport).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('resets and replaces the direct transport when a frame release times out', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const requestNdiFrameTransport = vi.mocked(window.castApi.requestNdiFrameTransport);
    render(
      <NdiFrameCapture
        senderName="audience"
        scene={createScene() as never}
        outputScopeKey="entry:playlist-1"
        enabled
      />,
    );
    const worker = mocks.workerInstances[0]!;
    const port = { close: vi.fn() } as unknown as MessagePort;
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'lumacast:ndi-frame-transport-port', version: 1, name: 'audience' },
      origin: window.location.origin,
      source: window,
      ports: [port],
    }));
    act(() => worker.emit({ type: 'transport-ready', name: 'audience' }));
    await flushCapture(40);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    now.mockReturnValue(300);
    await flushCapture(80);

    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'reset-transport' });
    act(() => vi.advanceTimersByTime(500));
    expect(requestNdiFrameTransport).toHaveBeenCalledTimes(2);
    now.mockRestore();
    vi.useRealTimers();
  });

  it('keeps the one-slot backpressure boundary across effect restarts and ignores stale releases', async () => {
    const firstScene = createScene();
    const secondScene = createScene({
      nodes: [{
        id: 'node-1',
        element: { type: 'shape', updatedAt: 'updated-1' },
        visual: { visible: true },
      }],
    });

    const view = render(
      <NdiFrameCapture
        senderName="audience"
        scene={firstScene as never}
        surface="ndi-show"
        outputScopeKey="entry:playlist-1"
        enabled
      />,
    );

    await flushCapture(40);
    expect(mocks.sendNdiFrame).toHaveBeenCalledTimes(1);
    const firstTelemetry = mocks.sendNdiFrame.mock.calls[0]?.[4];
    const firstAttemptId = firstTelemetry.attemptId as string;

    view.rerender(
      <NdiFrameCapture
        senderName="audience"
        scene={secondScene as never}
        surface="ndi-show"
        outputScopeKey="entry:playlist-1"
        enabled
      />,
    );

    await flushCapture(80);
    expect(mocks.sendNdiFrame).toHaveBeenCalledTimes(1);

    mocks.emitRelease({
      name: 'audience',
      attemptId: `stale-session:${attemptCounter(firstAttemptId)}`,
      accepted: true,
      reason: 'sent',
      releasedAtMs: Date.now(),
    });
    await flushCapture(120);
    expect(mocks.sendNdiFrame).toHaveBeenCalledTimes(1);

    mocks.emitRelease({
      name: 'audience',
      attemptId: firstAttemptId,
      accepted: true,
      reason: 'sent',
      releasedAtMs: Date.now(),
    });
    await flushCapture(160);

    expect(mocks.sendNdiFrame).toHaveBeenCalledTimes(2);
    expect(mocks.sendNdiFrame.mock.calls[1]?.[4].attemptId).not.toBe(firstAttemptId);
  });

  it('keeps attempt ids monotonic across remounts', async () => {
    const first = render(
      <NdiFrameCapture
        senderName="audience"
        scene={createScene() as never}
        surface="ndi-show"
        outputScopeKey="entry:playlist-1"
        enabled
      />,
    );
    await flushCapture(40);
    const firstAttemptId = mocks.sendNdiFrame.mock.calls[0]?.[4].attemptId as string;
    first.unmount();

    render(
      <NdiFrameCapture
        senderName="audience"
        scene={createScene({ slideId: 'slide-2' }) as never}
        surface="ndi-show"
        outputScopeKey="entry:playlist-2"
        enabled
      />,
    );
    await flushCapture(80);
    const secondAttemptId = mocks.sendNdiFrame.mock.calls[1]?.[4].attemptId as string;

    expect(secondAttemptId).not.toBe(firstAttemptId);
    expect(attemptCounter(secondAttemptId)).toBeGreaterThan(attemptCounter(firstAttemptId));
  });

  it('retains a corrective background-media retry that becomes ready during an in-flight capture', async () => {
    const view = render(
      <NdiFrameCapture
        senderName="audience"
        scene={createScene({
          background: { type: 'image', src: 'asset://background.png', fit: 'cover' },
        }) as never}
        surface="ndi-show"
        outputScopeKey="entry:playlist-1"
        enabled
      />,
    );

    await flushCapture(40);
    const firstAttemptId = mocks.sendNdiFrame.mock.calls[0]?.[4].attemptId as string;

    fireEvent.click(view.getByTestId('background-load'));
    mocks.emitRelease({
      name: 'audience',
      attemptId: firstAttemptId,
      accepted: true,
      reason: 'sent',
      releasedAtMs: Date.now(),
    });

    await flushCapture(80);

    expect(mocks.sendNdiFrame).toHaveBeenCalledTimes(2);
    expect(mocks.sendNdiFrame.mock.calls[1]?.[4].correctiveFrameRetries).toBe(1);
  });

  it('counts only renderer-owned release reasons and leaves native send failures to engine ownership', async () => {
    render(
      <NdiFrameCapture
        senderName="audience"
        scene={createScene() as never}
        surface="ndi-show"
        outputScopeKey="entry:playlist-1"
        enabled
      />,
    );

    await flushCapture(40);
    const firstAttemptId = mocks.sendNdiFrame.mock.calls[0]?.[4].attemptId as string;
    mocks.emitRelease({
      name: 'audience',
      attemptId: firstAttemptId,
      accepted: false,
      reason: 'nativeSendFailed',
      releasedAtMs: Date.now(),
    });

    await flushCapture(80);
    expect(mocks.sendNdiFrame).toHaveBeenCalledTimes(2);
    expect(mocks.sendNdiFrame.mock.calls[1]?.[4].dropReasons.nativeSendFailed).toBe(0);
    expect(mocks.sendNdiFrame.mock.calls[1]?.[4].correctiveFrameRetries).toBe(1);

    const secondAttemptId = mocks.sendNdiFrame.mock.calls[1]?.[4].attemptId as string;
    mocks.emitRelease({
      name: 'audience',
      attemptId: secondAttemptId,
      accepted: false,
      reason: 'outputDisabled',
      releasedAtMs: Date.now(),
    });

    await flushCapture(120);
    expect(mocks.sendNdiFrame).toHaveBeenCalledTimes(3);
    expect(mocks.sendNdiFrame.mock.calls[2]?.[4].dropReasons.outputDisabled).toBe(1);
    expect(mocks.sendNdiFrame.mock.calls[2]?.[4].dropReasons.nativeSendFailed).toBe(0);
  });
});
