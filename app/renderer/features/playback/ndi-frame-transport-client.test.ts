import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NDI_FRAME_TRANSPORT_VERSION } from '@lumacast/protocol';
import { NdiFrameTransportClient, type NdiFrameTransportPort } from './ndi-frame-transport-client';

function createPort() {
  const port: NdiFrameTransportPort = {
    onmessage: null,
    onmessageerror: null,
    postMessage: vi.fn(),
    start: vi.fn(),
    close: vi.fn(),
  };
  return port;
}

function emit(port: NdiFrameTransportPort, data: unknown): void {
  port.onmessage?.({ data } as MessageEvent<unknown>);
}

describe('NdiFrameTransportClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('handshakes and posts a full frame without a transfer list', () => {
    const port = createPort();
    const onFallback = vi.fn();
    const onReady = vi.fn();
    const client = new NdiFrameTransportClient({ onReleased: vi.fn(), onFallback, onReady });

    client.attach('audience', port);
    expect(port.start).toHaveBeenCalledTimes(1);
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'handshake',
      version: NDI_FRAME_TRANSPORT_VERSION,
      name: 'audience',
    });

    emit(port, { type: 'ready', version: NDI_FRAME_TRANSPORT_VERSION, name: 'audience' });
    expect(onReady).toHaveBeenCalledWith('audience');
    const buffer = new ArrayBuffer(1920 * 1080 * 4);
    expect(client.sendFrame({
      type: 'frame',
      name: 'audience',
      attemptId: 'session:1',
      buffer,
      width: 1920,
      height: 1080,
      telemetry: {
        attemptId: 'session:1',
        captureDurationMs: 4,
        readbackDurationMs: 2,
        skippedCaptures: 0,
        framesDroppedBackpressure: 0,
        correctiveFrameRetries: 0,
      },
    })).toBe(true);

    const frameCall = (port.postMessage as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(frameCall).toHaveLength(1);
    expect(frameCall?.[0]).toMatchObject({
      type: 'frame',
      name: 'audience',
      attemptId: 'session:1',
      buffer,
      telemetry: {
        attemptId: 'session:1',
        rendererSendAtMs: expect.any(Number),
      },
    });
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('forwards matching releases from the utility process', () => {
    const port = createPort();
    const onReleased = vi.fn();
    const client = new NdiFrameTransportClient({ onReleased, onFallback: vi.fn(), onReady: vi.fn() });
    client.attach('stage', port);
    emit(port, { type: 'ready', version: NDI_FRAME_TRANSPORT_VERSION, name: 'stage' });

    const release = {
      type: 'released',
      release: {
        name: 'stage',
        attemptId: 'session:2',
        accepted: true,
        reason: 'sent',
        releasedAtMs: 10,
      },
    };
    emit(port, release);

    expect(onReleased).toHaveBeenCalledWith(release.release);
  });

  it('falls back when the handshake times out', () => {
    const port = createPort();
    const onFallback = vi.fn();
    const client = new NdiFrameTransportClient({ onReleased: vi.fn(), onFallback, onReady: vi.fn() });
    client.attach('audience', port);

    vi.advanceTimersByTime(500);

    expect(onFallback).toHaveBeenCalledWith('audience');
    expect(port.close).toHaveBeenCalledTimes(1);
    expect(client.isReady()).toBe(false);
  });

  it('falls back on invalid messages, message errors, and send failures', () => {
    const invalidPort = createPort();
    const messageErrorPort = createPort();
    const sendFailurePort = createPort();
    const onFallback = vi.fn();
    const client = new NdiFrameTransportClient({ onReleased: vi.fn(), onFallback, onReady: vi.fn() });

    client.attach('audience', invalidPort);
    emit(invalidPort, { type: 'ready', version: 99, name: 'audience' });
    expect(onFallback).toHaveBeenCalledTimes(1);

    client.attach('audience', messageErrorPort);
    messageErrorPort.onmessageerror?.({} as MessageEvent<unknown>);
    expect(onFallback).toHaveBeenCalledTimes(2);

    (sendFailurePort.postMessage as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {}).mockImplementationOnce(() => {
      throw new Error('closed');
    });
    client.attach('audience', sendFailurePort);
    emit(sendFailurePort, { type: 'ready', version: NDI_FRAME_TRANSPORT_VERSION, name: 'audience' });
    expect(client.sendFrame({
      type: 'frame',
      name: 'audience',
      attemptId: 'session:3',
      buffer: new ArrayBuffer(1920 * 1080 * 4),
      width: 1920,
      height: 1080,
    })).toBe(false);
    expect(onFallback).toHaveBeenCalledTimes(3);
  });

  it('closes an attached channel on reset without reporting a failure', () => {
    const port = createPort();
    const onFallback = vi.fn();
    const client = new NdiFrameTransportClient({ onReleased: vi.fn(), onFallback, onReady: vi.fn() });
    client.attach('audience', port);
    emit(port, { type: 'ready', version: NDI_FRAME_TRANSPORT_VERSION, name: 'audience' });

    client.reset();

    expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'close', name: 'audience' });
    expect(port.close).toHaveBeenCalledTimes(1);
    expect(onFallback).not.toHaveBeenCalled();
  });
});
