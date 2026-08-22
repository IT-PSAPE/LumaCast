import { describe, expect, it } from 'vitest';
import {
  NDI_FRAME_TRANSPORT_VERSION,
  NDI_VIDEO_FRAME_INTERVAL_MS,
  decodeNdiFrameTransportFrame,
  isNdiFrameTransportHandshake,
  type NdiFrameTransportFrame,
} from './index';

const FRAME_BYTES = 1920 * 1080 * 4;

function validFrame(overrides: Partial<NdiFrameTransportFrame> = {}): NdiFrameTransportFrame {
  return {
    type: 'frame',
    name: 'audience',
    attemptId: 'capture-session:1',
    buffer: new ArrayBuffer(FRAME_BYTES),
    width: 1920,
    height: 1080,
    telemetry: {
      attemptId: 'capture-session:1',
      captureDurationMs: 7,
      readbackDurationMs: 3,
      skippedCaptures: 0,
      framesDroppedBackpressure: 0,
      correctiveFrameRetries: 0,
    },
    ...overrides,
  };
}

describe('NDI direct frame transport contract', () => {
  it('uses the exact 30000/1001 frame cadence', () => {
    expect(NDI_VIDEO_FRAME_INTERVAL_MS).toBeCloseTo(33.3666666667, 8);
  });

  it('accepts the current handshake only for the expected output', () => {
    expect(isNdiFrameTransportHandshake({
      type: 'handshake',
      version: NDI_FRAME_TRANSPORT_VERSION,
      name: 'audience',
    }, 'audience')).toBe(true);
    expect(isNdiFrameTransportHandshake({
      type: 'handshake',
      version: NDI_FRAME_TRANSPORT_VERSION + 1,
      name: 'audience',
    }, 'audience')).toBe(false);
    expect(isNdiFrameTransportHandshake({
      type: 'handshake',
      version: NDI_FRAME_TRANSPORT_VERSION,
      name: 'stage',
    }, 'audience')).toBe(false);
  });

  it('accepts and sanitizes an exact 1080p RGBA frame', () => {
    const decoded = decodeNdiFrameTransportFrame(validFrame({
      telemetry: {
        attemptId: 'capture-session:1',
        captureDurationMs: 7,
        readbackDurationMs: 3,
        skippedCaptures: -2,
        framesDroppedBackpressure: 4,
        correctiveFrameRetries: 0,
      },
    }), 'audience');

    expect(decoded).not.toBeNull();
    expect(decoded?.telemetry).toMatchObject({
      attemptId: 'capture-session:1',
      skippedCaptures: 0,
      framesDroppedBackpressure: 4,
    });
  });

  it.each([
    ['wrong output', validFrame({ name: 'stage' })],
    ['missing attempt', validFrame({ attemptId: '' })],
    ['attempt with invalid characters', validFrame({ attemptId: 'capture session/1' })],
    ['attempt longer than 128 characters', validFrame({ attemptId: 'a'.repeat(129) })],
    ['wrong width', validFrame({ width: 1280 })],
    ['wrong height', validFrame({ height: 720 })],
    ['short frame', validFrame({ buffer: new ArrayBuffer(FRAME_BYTES - 1) })],
    ['long frame', validFrame({ buffer: new ArrayBuffer(FRAME_BYTES + 1) })],
    ['typed-array view', { ...validFrame(), buffer: new Uint8Array(FRAME_BYTES) }],
  ])('rejects %s at the utility trust boundary', (_label, value) => {
    expect(decodeNdiFrameTransportFrame(value, 'audience')).toBeNull();
  });

  it('uses the top-level attempt id as the canonical release-routing id', () => {
    const decoded = decodeNdiFrameTransportFrame(validFrame({
      attemptId: 'canonical:2',
      telemetry: {
        attemptId: 'spoofed:9',
        captureDurationMs: 1,
        readbackDurationMs: 1,
        skippedCaptures: 0,
        framesDroppedBackpressure: 0,
        correctiveFrameRetries: 0,
      },
    }), 'audience');

    expect(decoded?.attemptId).toBe('canonical:2');
    expect(decoded?.telemetry?.attemptId).toBe('canonical:2');
  });

  it('strips timestamps owned by bypassed or downstream process boundaries', () => {
    const decoded = decodeNdiFrameTransportFrame(validFrame({
      telemetry: {
        attemptId: 'capture-session:1',
        captureDurationMs: 1,
        readbackDurationMs: 1,
        skippedCaptures: 0,
        framesDroppedBackpressure: 0,
        correctiveFrameRetries: 0,
        rendererSendAtMs: 10,
        mainReceivedAtMs: 20,
        proxyForwardedAtMs: 30,
        hostReceivedAtMs: 40,
      },
    }), 'audience');

    expect(decoded?.telemetry).toMatchObject({ rendererSendAtMs: 10 });
    expect(decoded?.telemetry).not.toHaveProperty('mainReceivedAtMs');
    expect(decoded?.telemetry).not.toHaveProperty('proxyForwardedAtMs');
    expect(decoded?.telemetry).not.toHaveProperty('hostReceivedAtMs');
  });
});
