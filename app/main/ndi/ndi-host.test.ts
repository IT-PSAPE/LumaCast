import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultNdiOutputConfigs } from '@lumacast/protocol';

const mocks = vi.hoisted(() => {
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
    onFrameReleased: vi.fn(),
    setOutputEnabled: vi.fn(),
    updateOutputConfig: vi.fn(),
    receiveFrame: vi.fn(),
    receiveAudioFrame: vi.fn(),
    flushBlackoutAndDestroy: vi.fn(),
    destroy: vi.fn(),
  };
  return {
    service,
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
  let onMessage: ((event: { data: unknown }) => void) | null = null;
  let postMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    onMessage = null;
    postMessage = vi.fn();
    Object.defineProperty(process, 'parentPort', {
      configurable: true,
      value: {
        on: vi.fn((event: string, listener: (event: { data: unknown }) => void) => {
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
});
