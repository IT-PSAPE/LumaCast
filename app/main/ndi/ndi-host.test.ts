import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultNdiOutputConfigs } from '@lumacast/protocol';

const mocks = vi.hoisted(() => {
  const frameReleasedListener = { current: null as ((release: import('@lumacast/protocol').NdiFrameRelease) => void) | null };
  const service = {
    getOutputState: vi.fn(() => ({ audience: false, stage: false })),
    getOutputConfigs: vi.fn(() => createDefaultNdiOutputConfigs()),
    getDiagnostics: vi.fn(() => ({
      outputState: { audience: false, stage: false },
      outputConfig: createDefaultNdiOutputConfigs().audience,
      outputConfigs: createDefaultNdiOutputConfigs(),
      runtimeLoaded: false,
      runtimePath: null,
      activeSender: null,
      senders: { audience: null, stage: null },
      availabilityDrops: {
        audience: { outputDisabled: 0, senderUnavailable: 0 },
        stage: { outputDisabled: 0, senderUnavailable: 0 },
      },
      sourceStatus: 'idle' as const,
      lastError: null,
    })),
    onOutputStateChanged: vi.fn(),
    onDiagnosticsChanged: vi.fn(),
    onFrameReleased: vi.fn((listener: (release: import('@lumacast/protocol').NdiFrameRelease) => void) => {
      frameReleasedListener.current = listener;
      return vi.fn();
    }),
    setOutputEnabled: vi.fn(),
    updateOutputConfig: vi.fn(),
    receiveFrame: vi.fn(),
    receiveAudioFrame: vi.fn(),
    flushBlackoutAndDestroy: vi.fn(),
    destroy: vi.fn(),
  };
  return {
    service,
    frameReleasedListener,
    NdiService: vi.fn(function MockNdiService() {
      return service;
    }),
  };
});

vi.mock('@lumacast/engine', () => ({
  NdiService: mocks.NdiService,
}));

describe('ndi-host teardown acknowledgments', () => {
  const originalParentPort = (process as NodeJS.Process & { parentPort?: unknown }).parentPort;
  let onMessage: ((event: { data: unknown; ports?: unknown[] }) => void) | null = null;
  let postMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.frameReleasedListener.current = null;
    onMessage = null;
    postMessage = vi.fn();
    Object.defineProperty(process, 'parentPort', {
      configurable: true,
      value: {
        on: vi.fn((event: string, listener: (event: { data: unknown; ports?: unknown[] }) => void) => {
          if (event === 'message') onMessage = listener;
        }),
        postMessage,
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'parentPort', {
      configurable: true,
      value: originalParentPort,
    });
  });

  it('emits teardownComplete after destroy, even when already torn down', async () => {
    await import('./ndi-host');

    onMessage?.({ data: { type: 'init', outputConfigs: createDefaultNdiOutputConfigs() } });
    onMessage?.({ data: { type: 'destroy' } });
    onMessage?.({ data: { type: 'destroy' } });

    expect(mocks.service.destroy).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledWith({ type: 'teardownComplete' });
    expect(postMessage).toHaveBeenCalledTimes(3);
  });

  function createFramePort() {
    const listeners = new Map<string, (event?: unknown) => void>();
    return {
      listeners,
      on: vi.fn((event: string, listener: (event?: unknown) => void) => {
        listeners.set(event, listener);
      }),
      postMessage: vi.fn(),
      start: vi.fn(),
      close: vi.fn(),
    };
  }

  it('handshakes a direct port, validates a frame, and routes its release over that port', async () => {
    await import('./ndi-host');
    onMessage?.({ data: { type: 'init', outputConfigs: createDefaultNdiOutputConfigs() } });
    postMessage.mockClear();
    const port = createFramePort();
    onMessage?.({ data: { type: 'attachFramePort', name: 'audience' }, ports: [port] });

    port.listeners.get('message')?.({
      data: { type: 'handshake', version: 1, name: 'audience' },
    });
    expect(port.start).toHaveBeenCalledOnce();
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'ready', version: 1, name: 'audience' });

    mocks.service.receiveFrame.mockImplementationOnce((_name, _bytes, _width, _height, telemetry) => {
      const attemptId = (telemetry as { attemptId?: string } | undefined)?.attemptId;
      mocks.frameReleasedListener.current?.({
        name: 'audience',
        attemptId,
        accepted: true,
        reason: 'sent',
        releasedAtMs: 123,
      });
    });
    port.listeners.get('message')?.({
      data: {
        type: 'frame',
        name: 'audience',
        attemptId: 'session:1',
        buffer: new ArrayBuffer(1920 * 1080 * 4),
        width: 1920,
        height: 1080,
        telemetry: {
          attemptId: 'spoofed',
          captureDurationMs: 1,
          readbackDurationMs: 1,
          skippedCaptures: 0,
          framesDroppedBackpressure: 0,
          correctiveFrameRetries: 0,
        },
      },
    });

    expect(mocks.service.receiveFrame).toHaveBeenCalledWith(
      'audience',
      expect.any(Uint8Array),
      1920,
      1080,
      expect.objectContaining({ attemptId: 'session:1', hostReceivedAtMs: expect.any(Number) }),
    );
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'released',
      release: {
        name: 'audience',
        attemptId: 'session:1',
        accepted: true,
        reason: 'sent',
        releasedAtMs: 123,
      },
    });
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'frameReleased' }));
  });

  it('routes malformed direct frames through engine rejection accounting', async () => {
    await import('./ndi-host');
    onMessage?.({ data: { type: 'init', outputConfigs: createDefaultNdiOutputConfigs() } });
    const port = createFramePort();
    onMessage?.({ data: { type: 'attachFramePort', name: 'stage' }, ports: [port] });
    port.listeners.get('message')?.({ data: { type: 'handshake', version: 1, name: 'stage' } });
    mocks.service.receiveFrame.mockClear();
    port.postMessage.mockClear();
    mocks.service.receiveFrame.mockImplementationOnce((_name, _bytes, _width, _height, telemetry) => {
      mocks.frameReleasedListener.current?.({
        name: 'stage',
        attemptId: (telemetry as { attemptId?: string } | undefined)?.attemptId,
        accepted: false,
        reason: 'invalidPayload',
        releasedAtMs: 456,
      });
    });

    port.listeners.get('message')?.({
      data: {
        type: 'frame',
        name: 'stage',
        attemptId: 'bad:1',
        buffer: new ArrayBuffer(4),
        width: 1920,
        height: 1080,
      },
    });

    expect(mocks.service.receiveFrame).toHaveBeenCalledWith(
      'stage',
      expect.any(Uint8Array),
      0,
      0,
      expect.objectContaining({ attemptId: 'bad:1' }),
    );
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'released',
      release: expect.objectContaining({
        name: 'stage',
        attemptId: 'bad:1',
        accepted: false,
        reason: 'invalidPayload',
      }),
    });
  });

  it('closes an attached port that never completes its handshake', async () => {
    vi.useFakeTimers();
    try {
      await import('./ndi-host');
      onMessage?.({ data: { type: 'init', outputConfigs: createDefaultNdiOutputConfigs() } });
      const port = createFramePort();
      onMessage?.({ data: { type: 'attachFramePort', name: 'audience' }, ports: [port] });

      vi.advanceTimersByTime(500);

      expect(port.postMessage).toHaveBeenCalledWith({
        type: 'fallback',
        name: 'audience',
        reason: 'invalidHandshake',
      });
      expect(port.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a successfully handshaken port beyond the handshake deadline', async () => {
    vi.useFakeTimers();
    try {
      await import('./ndi-host');
      onMessage?.({ data: { type: 'init', outputConfigs: createDefaultNdiOutputConfigs() } });
      const port = createFramePort();
      onMessage?.({ data: { type: 'attachFramePort', name: 'audience' }, ports: [port] });
      port.listeners.get('message')?.({ data: { type: 'handshake', version: 1, name: 'audience' } });
      port.postMessage.mockClear();

      vi.advanceTimersByTime(500);

      expect(port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'fallback' }));
      expect(port.close).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes a replaced output port and rejects a mismatched handshake', async () => {
    await import('./ndi-host');
    onMessage?.({ data: { type: 'init', outputConfigs: createDefaultNdiOutputConfigs() } });
    const first = createFramePort();
    const second = createFramePort();
    onMessage?.({ data: { type: 'attachFramePort', name: 'audience' }, ports: [first] });
    onMessage?.({ data: { type: 'attachFramePort', name: 'audience' }, ports: [second] });
    expect(first.close).toHaveBeenCalledOnce();

    second.listeners.get('message')?.({ data: { type: 'handshake', version: 99, name: 'audience' } });
    expect(second.postMessage).toHaveBeenCalledWith({
      type: 'fallback',
      name: 'audience',
      reason: 'invalidHandshake',
    });
    expect(second.close).toHaveBeenCalledOnce();
  });
});
