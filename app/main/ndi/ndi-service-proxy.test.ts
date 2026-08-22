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

vi.mock('electron', () => ({
  utilityProcess: { fork: mocks.fork },
  MessageChannelMain: mocks.MessageChannelMain,
}));

import { NdiServiceProxy } from './ndi-service-proxy';

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
});
