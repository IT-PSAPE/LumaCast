import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultNdiOutputConfigs, type NdiFrameRelease } from '@lumacast/protocol';

type HostListener = (...args: unknown[]) => void;

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, HostListener>();
  const rendererPort = { close: vi.fn() };
  const hostPort = { close: vi.fn() };
  const host = {
    postMessage: vi.fn(),
    on: vi.fn((event: string, listener: HostListener) => {
      listeners.set(event, listener);
    }),
    kill: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
  };
  return {
    listeners,
    host,
    rendererPort,
    hostPort,
    fork: vi.fn(() => host),
    MessageChannelMain: vi.fn(function MockMessageChannelMain() {
      return { port1: rendererPort, port2: hostPort };
    }),
  };
});

vi.mock('@lumacast/ndi-native', () => ({ discardSharedTexture: vi.fn() }));

vi.mock('electron', () => ({
  utilityProcess: { fork: mocks.fork },
  MessageChannelMain: mocks.MessageChannelMain,
}));

import { NdiServiceProxy } from '../../../../../apps/cast/main/ndi/ndi-service-proxy';

describe('NdiServiceProxy teardown lifecycle', () => {
  beforeEach(() => {
    mocks.listeners.clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('posts flushBlackout and destroy, then waits for teardownComplete before killing the host', () => {
    const proxy = new NdiServiceProxy({
      outputConfigs: createDefaultNdiOutputConfigs(),
      onOutputConfigsChanged: vi.fn(),
      hostModulePath: '/app/out/main/ndi-host.js',
    });

    mocks.host.postMessage.mockClear();
    mocks.host.kill.mockClear();

    proxy.destroy();

    expect(mocks.host.postMessage).toHaveBeenNthCalledWith(1, {
      type: 'flushBlackout',
      options: { totalBudgetMs: 500 },
    });
    expect(mocks.host.postMessage).toHaveBeenNthCalledWith(2, { type: 'destroy' });
    expect(mocks.host.kill).not.toHaveBeenCalled();

    mocks.listeners.get('message')?.({ type: 'teardownComplete' });

    expect(mocks.host.kill).toHaveBeenCalledOnce();
    expect(mocks.host.postMessage.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.host.kill.mock.invocationCallOrder[0]!,
    );
  });

  it('falls back to kill after the teardown timeout if no ack arrives', () => {
    const proxy = new NdiServiceProxy({
      outputConfigs: createDefaultNdiOutputConfigs(),
      onOutputConfigsChanged: vi.fn(),
      hostModulePath: '/app/out/main/ndi-host.js',
    });

    mocks.host.postMessage.mockClear();
    mocks.host.kill.mockClear();

    proxy.destroy();

    vi.advanceTimersByTime(999);
    expect(mocks.host.kill).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(mocks.host.kill).toHaveBeenCalledOnce();
  });

  it('is idempotent and ignores late frame releases after teardown starts', () => {
    const proxy = new NdiServiceProxy({
      outputConfigs: createDefaultNdiOutputConfigs(),
      onOutputConfigsChanged: vi.fn(),
      hostModulePath: '/app/out/main/ndi-host.js',
    });
    const onFrameReleased = vi.fn();
    proxy.onFrameReleased(onFrameReleased);

    mocks.host.postMessage.mockClear();
    mocks.host.kill.mockClear();

    proxy.destroy();
    proxy.destroy();
    mocks.listeners.get('message')?.({
      type: 'frameReleased',
      release: {
        name: 'audience',
        attemptId: 'session:1',
        accepted: true,
        reason: 'sent',
        releasedAtMs: Date.now(),
      } satisfies NdiFrameRelease,
    });
    mocks.listeners.get('message')?.({ type: 'teardownComplete' });
    mocks.listeners.get('message')?.({ type: 'teardownComplete' });

    expect(mocks.host.postMessage).toHaveBeenCalledTimes(2);
    expect(mocks.host.kill).toHaveBeenCalledOnce();
    expect(onFrameReleased).not.toHaveBeenCalled();
  });

  it('creates a renderer-to-utility frame channel and transfers the utility port', () => {
    const proxy = new NdiServiceProxy({
      outputConfigs: createDefaultNdiOutputConfigs(),
      onOutputConfigsChanged: vi.fn(),
      hostModulePath: '/app/out/main/ndi-host.js',
    });
    mocks.host.postMessage.mockClear();

    expect(proxy.createFrameTransport('audience')).toBe(mocks.rendererPort);
    expect(mocks.host.postMessage).toHaveBeenCalledWith(
      { type: 'attachFramePort', name: 'audience' },
      [mocks.hostPort],
    );
  });

  it('falls back when frame-channel transfer fails or teardown has started', () => {
    const proxy = new NdiServiceProxy({
      outputConfigs: createDefaultNdiOutputConfigs(),
      onOutputConfigsChanged: vi.fn(),
      hostModulePath: '/app/out/main/ndi-host.js',
    });
    mocks.host.postMessage.mockImplementationOnce(() => {
      throw new Error('port transfer failed');
    });

    expect(proxy.createFrameTransport('stage')).toBeNull();
    expect(mocks.rendererPort.close).toHaveBeenCalled();
    expect(mocks.hostPort.close).toHaveBeenCalled();

    proxy.destroy();
    mocks.host.postMessage.mockClear();
    expect(proxy.createFrameTransport('stage')).toBeNull();
    expect(mocks.host.postMessage).not.toHaveBeenCalled();
  });

  it('creates a renderer-to-utility audio channel and transfers the utility port', () => {
    const proxy = new NdiServiceProxy({
      outputConfigs: createDefaultNdiOutputConfigs(),
      onOutputConfigsChanged: vi.fn(),
      hostModulePath: '/app/out/main/ndi-host.js',
    });
    mocks.host.postMessage.mockClear();

    expect(proxy.createAudioTransport('stage')).toBe(mocks.rendererPort);
    expect(mocks.host.postMessage).toHaveBeenCalledWith(
      { type: 'attachAudioPort', name: 'stage' },
      [mocks.hostPort],
    );
  });

  it('falls back when audio-channel transfer fails or teardown has started', () => {
    const proxy = new NdiServiceProxy({
      outputConfigs: createDefaultNdiOutputConfigs(),
      onOutputConfigsChanged: vi.fn(),
      hostModulePath: '/app/out/main/ndi-host.js',
    });
    mocks.host.postMessage.mockImplementationOnce(() => {
      throw new Error('port transfer failed');
    });

    expect(proxy.createAudioTransport('audience')).toBeNull();
    expect(mocks.rendererPort.close).toHaveBeenCalled();
    expect(mocks.hostPort.close).toHaveBeenCalled();

    proxy.destroy();
    mocks.host.postMessage.mockClear();
    expect(proxy.createAudioTransport('audience')).toBeNull();
    expect(mocks.host.postMessage).not.toHaveBeenCalled();
  });
});

describe('GPU texture acknowledgements', () => {
  beforeEach(() => { mocks.listeners.clear(); vi.clearAllMocks(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());
  function setup() {
    const configs = createDefaultNdiOutputConfigs();
    const proxy = new NdiServiceProxy({ outputConfigs: configs, onOutputConfigsChanged: vi.fn(), hostModulePath: '/host.js' });
    mocks.listeners.get('message')?.({ type: 'ready', outputState: { audience: true, stage: false }, outputConfigs: configs, diagnostics: proxy.getDiagnostics(), gpuTransport: { supported: true, receiverEndpoint: 'private-test-endpoint', pid: 123 } });
    return proxy;
  }
  const telemetry = { attemptId: 'revision:1', captureDurationMs: 0, readbackDurationMs: 0, skippedCaptures: 0, framesDroppedBackpressure: 0, correctiveFrameRetries: 0 };
  const handle = { platform: 'darwin' as const, token: '0'.repeat(32) };
  it('waits for the matching native acknowledgement', async () => {
    const proxy = setup(); let settled = false;
    const pending = proxy.submitGpuFrame('audience', handle, 'bgra', telemetry).then((result) => { settled = true; return result; });
    mocks.listeners.get('message')?.({ type: 'frameReleased', release: { name: 'audience', attemptId: 'different:1', accepted: true, reason: 'sent', releasedAtMs: 1 } });
    await Promise.resolve(); expect(settled).toBe(false);
    const result = { conversionDurationMs: 2, sendDurationMs: 1, frameBytes: 123 };
    mocks.listeners.get('message')?.({ type: 'frameReleased', release: { name: 'audience', attemptId: telemetry.attemptId, accepted: true, reason: 'sent', releasedAtMs: 1, gpuFrameResult: result } });
    expect(await pending).toEqual(result); proxy.destroy(); mocks.listeners.get('message')?.({ type: 'teardownComplete' });
  });
  it('terminates a timed out reader but keeps the input lease pending until exit', async () => {
    const proxy = setup(); let settled = false;
    const pending = proxy.submitGpuFrame('audience', handle, 'bgra', telemetry).catch((error) => { settled = true; return error; });
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.host.kill).toHaveBeenCalledOnce(); expect(settled).toBe(false);
    mocks.listeners.get('exit')?.(1);
    expect(await pending).toBeInstanceOf(Error); expect(settled).toBe(true);
    proxy.destroy(); mocks.listeners.get('message')?.({ type: 'teardownComplete' });
  });
});
