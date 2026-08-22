import { describe, expect, it, vi } from 'vitest';
import { createDefaultNdiOutputConfigs } from '@lumacast/protocol';
import { NdiService } from './ndi-service';

function createService(options?: {
  sendRgbaFrame?: ReturnType<typeof vi.fn>;
}) {
  const sendRgbaFrame = (options?.sendRgbaFrame ?? vi.fn()) as (
    senderName: string,
    buffer: Uint8Array,
    width: number,
    height: number,
  ) => void;
  return new NdiService({
    outputConfigs: createDefaultNdiOutputConfigs(),
    onOutputConfigsChanged: vi.fn(),
    moduleLoader: () => ({
      initializeSender: vi.fn(),
      sendRgbaFrame,
      destroySender: vi.fn(),
      getRuntimeInfo: () => ({
        loaded: true,
        path: '/tmp/fake-ndi-runtime',
        asyncVideoSend: false,
        audioSend: false,
      }),
    }),
  });
}

describe('NdiService diagnostics cloning', () => {
  it('deep-clones frame drop counters when exposing diagnostics snapshots', () => {
    const service = createService();

    service.setOutputEnabled('audience', true);
    const first = service.getDiagnostics();
    expect(first.senders.audience).not.toBeNull();

    first.senders.audience!.performance.frameDrops.nativeSendFailed = 99;

    const second = service.getDiagnostics();
    expect(second.senders.audience!.performance.frameDrops.nativeSendFailed).toBe(0);

    service.destroy();
  });

  it('records output-disabled and sender-unavailable drops even without an active sender', () => {
    const service = createService();
    const frame = new Uint8Array(1920 * 1080 * 4);
    const onDiagnosticsChanged = vi.fn();
    service.onDiagnosticsChanged(onDiagnosticsChanged);

    service.receiveFrame('audience', frame, 1920, 1080, { attemptId: 'session:1', captureDurationMs: 0, readbackDurationMs: 0, skippedCaptures: 0, framesDroppedBackpressure: 0, correctiveFrameRetries: 0 });
    expect(service.getDiagnostics().availabilityDrops.audience.outputDisabled).toBe(1);
    expect(onDiagnosticsChanged).toHaveBeenCalled();

    const publishedBeforeDestroy = onDiagnosticsChanged.mock.calls.length;
    service.setOutputEnabled('audience', true);
    service.destroy();
    service.receiveFrame('audience', frame, 1920, 1080, { attemptId: 'session:2', captureDurationMs: 0, readbackDurationMs: 0, skippedCaptures: 0, framesDroppedBackpressure: 0, correctiveFrameRetries: 0 });
    expect(service.getDiagnostics().availabilityDrops.audience.senderUnavailable).toBe(1);
    expect(onDiagnosticsChanged.mock.calls.length).toBeGreaterThan(publishedBeforeDestroy);
  });

  it('dedupes accepted take-sequence aggregation across duplicate accepted retries', () => {
    const service = createService();
    const frame = new Uint8Array(1920 * 1080 * 4);

    service.setOutputEnabled('audience', true);
    const telemetry = {
      attemptId: 'session:1',
      captureDurationMs: 1,
      readbackDurationMs: 1,
      skippedCaptures: 0,
      framesDroppedBackpressure: 0,
      correctiveFrameRetries: 0,
      takeKind: 'take' as const,
      takeReason: 'jump' as const,
      takeSessionId: 'take-session-1',
      takeSequenceId: 41,
      takeIssuedAtMs: Date.now() - 10,
      captureStartedAtMs: Date.now() - 5,
    };

    service.receiveFrame('audience', frame, 1920, 1080, telemetry);
    service.receiveFrame('audience', frame, 1920, 1080, { ...telemetry, attemptId: 'session:2' });

    const diagnostics = service.getDiagnostics();
    expect(diagnostics.senders.audience?.performance.framesSent).toBe(2);
    expect(diagnostics.senders.audience?.performance.pipeline.takeToNativeSend.count).toBe(1);
    expect(diagnostics.senders.audience?.performance.pipeline.takeReasonToNativeSend.jump.count).toBe(1);

    service.destroy();
  });

  it('dedupes accepted activate-sequence aggregation across duplicate accepted retries and keeps the reason bucket', () => {
    const service = createService();
    const frame = new Uint8Array(1920 * 1080 * 4);

    service.setOutputEnabled('audience', true);
    const telemetry = {
      attemptId: 'session:1',
      captureDurationMs: 1,
      readbackDurationMs: 1,
      skippedCaptures: 0,
      framesDroppedBackpressure: 0,
      correctiveFrameRetries: 0,
      takeKind: 'activate' as const,
      takeReason: 'crossItem' as const,
      takeSessionId: 'activate-session-1',
      takeSequenceId: 31,
      takeIssuedAtMs: Date.now() - 10,
      captureStartedAtMs: Date.now() - 5,
    };

    service.receiveFrame('audience', frame, 1920, 1080, telemetry);
    service.receiveFrame('audience', frame, 1920, 1080, { ...telemetry, attemptId: 'session:2' });

    const diagnostics = service.getDiagnostics();
    expect(diagnostics.senders.audience?.performance.framesSent).toBe(2);
    expect(diagnostics.senders.audience?.performance.pipeline.activateToNativeSend.count).toBe(1);
    expect(diagnostics.senders.audience?.performance.pipeline.takeReasonToNativeSend.crossItem.count).toBe(1);

    service.destroy();
  });

  it('counts the same take sequence from a new take session as a new action', () => {
    const service = createService();
    const frame = new Uint8Array(1920 * 1080 * 4);

    service.setOutputEnabled('audience', true);
    const telemetry = {
      attemptId: 'session:1',
      captureDurationMs: 1,
      readbackDurationMs: 1,
      skippedCaptures: 0,
      framesDroppedBackpressure: 0,
      correctiveFrameRetries: 0,
      takeKind: 'take' as const,
      takeReason: 'jump' as const,
      takeSequenceId: 1,
      takeIssuedAtMs: Date.now() - 10,
      captureStartedAtMs: Date.now() - 5,
    };

    service.receiveFrame('audience', frame, 1920, 1080, { ...telemetry, takeSessionId: 'take-session-a' });
    service.receiveFrame('audience', frame, 1920, 1080, { ...telemetry, attemptId: 'session:2', takeSessionId: 'take-session-b' });

    const diagnostics = service.getDiagnostics();
    expect(diagnostics.senders.audience?.performance.pipeline.takeToNativeSend.count).toBe(2);
    expect(diagnostics.senders.audience?.performance.pipeline.takeReasonToNativeSend.jump.count).toBe(2);

    service.destroy();
  });

  it('still aggregates one accepted take after an earlier failed attempt with the same sequence', () => {
    const sendRgbaFrame = vi.fn()
      .mockImplementationOnce(() => { throw new Error('native send failed'); })
      .mockImplementationOnce(() => undefined);
    const service = createService({ sendRgbaFrame });
    const frame = new Uint8Array(1920 * 1080 * 4);

    service.setOutputEnabled('audience', true);
    const telemetry = {
      attemptId: 'session:1',
      captureDurationMs: 1,
      readbackDurationMs: 1,
      skippedCaptures: 0,
      framesDroppedBackpressure: 0,
      correctiveFrameRetries: 0,
      takeKind: 'take' as const,
      takeReason: 'sequential' as const,
      takeSessionId: 'take-session-2',
      takeSequenceId: 51,
      takeIssuedAtMs: Date.now() - 10,
      captureStartedAtMs: Date.now() - 5,
    };

    service.receiveFrame('audience', frame, 1920, 1080, telemetry);
    service.receiveFrame('audience', frame, 1920, 1080, { ...telemetry, attemptId: 'session:2' });

    const diagnostics = service.getDiagnostics();
    expect(diagnostics.senders.audience?.performance.frameDrops.nativeSendFailed).toBe(1);
    expect(diagnostics.senders.audience?.performance.pipeline.takeToNativeSend.count).toBe(1);
    expect(diagnostics.senders.audience?.performance.pipeline.takeReasonToNativeSend.sequential.count).toBe(1);

    service.destroy();
  });

  it('does not turn a successful native send into native-send-failed when take telemetry is malformed', () => {
    const service = createService();
    const frame = new Uint8Array(1920 * 1080 * 4);
    const onFrameReleased = vi.fn();
    service.onFrameReleased(onFrameReleased);

    service.setOutputEnabled('audience', true);
    service.receiveFrame('audience', frame, 1920, 1080, {
      attemptId: 'session:1',
      captureDurationMs: 1,
      readbackDurationMs: 1,
      skippedCaptures: 0,
      framesDroppedBackpressure: 0,
      correctiveFrameRetries: 0,
      takeKind: 'take',
      takeReason: 'bogus',
      takeIssuedAtMs: Date.now() - 10,
      captureStartedAtMs: Date.now() - 5,
    } as never);

    const diagnostics = service.getDiagnostics();
    expect(diagnostics.senders.audience?.performance.framesSent).toBe(1);
    expect(diagnostics.senders.audience?.performance.frameDrops.nativeSendFailed).toBe(0);
    expect(diagnostics.senders.audience?.performance.pipeline.takeToNativeSend.count).toBe(0);
    expect(diagnostics.senders.audience?.performance.pipeline.takeReasonToNativeSend.sequential.count).toBe(0);
    expect(diagnostics.senders.audience?.performance.pipeline.takeReasonToNativeSend.jump.count).toBe(0);
    expect(diagnostics.senders.audience?.performance.pipeline.takeReasonToNativeSend.crossItem.count).toBe(0);
    expect(diagnostics.senders.audience?.performance.pipeline.takeReasonToNativeSend.macro.count).toBe(0);
    expect(onFrameReleased).toHaveBeenCalledWith(expect.objectContaining({
      accepted: true,
      reason: 'sent',
      attemptId: 'session:1',
    }));

    service.destroy();
  });

  it('sanitizes malformed renderer telemetry counters before merging diagnostics', () => {
    const service = createService();
    const frame = new Uint8Array(1920 * 1080 * 4);

    service.setOutputEnabled('audience', true);
    service.receiveFrame('audience', frame, 1920, 1080, {
      attemptId: 'session:1',
      captureDurationMs: Number.NaN,
      readbackDurationMs: Infinity,
      skippedCaptures: -1,
      framesDroppedBackpressure: 'oops',
      correctiveFrameRetries: -4,
      dropReasons: {
        backpressure: 2,
        ackTimeout: 'bad',
        captureFailed: -3,
        bitmapFailed: 1,
        invalidPayload: 9,
        outputDisabled: 7,
        senderUnavailable: 6,
        nativeSendFailed: 5,
      },
      rendererSendAtMs: 'later',
      takeKind: 'bogus',
      takeReason: 'jump',
      takeSessionId: '',
      takeSequenceId: 1.5,
    } as never);

    const diagnostics = service.getDiagnostics();
    expect(diagnostics.senders.audience?.performance.skippedCaptures).toBe(0);
    expect(diagnostics.senders.audience?.performance.framesDroppedBackpressure).toBe(2);
    expect(diagnostics.senders.audience?.performance.correctiveFrameRetries).toBe(0);
    expect(diagnostics.senders.audience?.performance.frameDrops.backpressure).toBe(2);
    expect(diagnostics.senders.audience?.performance.frameDrops.ackTimeout).toBe(0);
    expect(diagnostics.senders.audience?.performance.frameDrops.captureFailed).toBe(0);
    expect(diagnostics.senders.audience?.performance.frameDrops.bitmapFailed).toBe(1);
    expect(diagnostics.senders.audience?.performance.frameDrops.invalidPayload).toBe(0);
    expect(diagnostics.senders.audience?.performance.frameDrops.outputDisabled).toBe(0);
    expect(diagnostics.senders.audience?.performance.frameDrops.senderUnavailable).toBe(0);
    expect(diagnostics.senders.audience?.performance.frameDrops.nativeSendFailed).toBe(0);
    expect(diagnostics.senders.audience?.performance.avgCaptureDurationMs).toBe(0);
    expect(diagnostics.senders.audience?.performance.avgReadbackDurationMs).toBe(0);
    expect(diagnostics.senders.audience?.performance.pipeline.takeReasonToNativeSend.jump.count).toBe(0);

    service.destroy();
  });

  it('does not reserve take-sequence dedupe state for a malformed partial take tuple', () => {
    const service = createService();
    const frame = new Uint8Array(1920 * 1080 * 4);

    service.setOutputEnabled('audience', true);
    service.receiveFrame('audience', frame, 1920, 1080, {
      attemptId: 'session:1',
      captureDurationMs: 1,
      readbackDurationMs: 1,
      skippedCaptures: 0,
      framesDroppedBackpressure: 0,
      correctiveFrameRetries: 0,
      takeKind: 'take',
      takeReason: 'jump',
      takeSessionId: 'take-session-3',
      takeSequenceId: 77,
      captureStartedAtMs: Date.now() - 5,
    } as never);
    service.receiveFrame('audience', frame, 1920, 1080, {
      attemptId: 'session:2',
      captureDurationMs: 1,
      readbackDurationMs: 1,
      skippedCaptures: 0,
      framesDroppedBackpressure: 0,
      correctiveFrameRetries: 0,
      takeKind: 'take',
      takeReason: 'jump',
      takeSessionId: 'take-session-3',
      takeSequenceId: 77,
      takeIssuedAtMs: Date.now() - 10,
      captureStartedAtMs: Date.now() - 5,
    });

    const diagnostics = service.getDiagnostics();
    expect(diagnostics.senders.audience?.performance.pipeline.takeToNativeSend.count).toBe(1);
    expect(diagnostics.senders.audience?.performance.pipeline.takeReasonToNativeSend.jump.count).toBe(1);

    service.destroy();
  });

  it('drops oversized telemetry ids so a later valid retry can still aggregate', () => {
    const service = createService();
    const frame = new Uint8Array(1920 * 1080 * 4);
    const oversized = `take-${'x'.repeat(200)}`;

    service.setOutputEnabled('audience', true);
    service.receiveFrame('audience', frame, 1920, 1080, {
      attemptId: oversized,
      captureDurationMs: 1,
      readbackDurationMs: 1,
      skippedCaptures: 0,
      framesDroppedBackpressure: 0,
      correctiveFrameRetries: 0,
      takeKind: 'take',
      takeReason: 'jump',
      takeSessionId: oversized,
      takeSequenceId: 77,
      takeIssuedAtMs: Date.now() - 10,
      captureStartedAtMs: Date.now() - 5,
    } as never);
    service.receiveFrame('audience', frame, 1920, 1080, {
      attemptId: 'session:2',
      captureDurationMs: 1,
      readbackDurationMs: 1,
      skippedCaptures: 0,
      framesDroppedBackpressure: 0,
      correctiveFrameRetries: 0,
      takeKind: 'take',
      takeReason: 'jump',
      takeSessionId: 'take-session-valid',
      takeSequenceId: 77,
      takeIssuedAtMs: Date.now() - 10,
      captureStartedAtMs: Date.now() - 5,
    });

    const diagnostics = service.getDiagnostics();
    expect(diagnostics.senders.audience?.performance.pipeline.takeToNativeSend.count).toBe(1);
    expect(diagnostics.senders.audience?.performance.pipeline.takeReasonToNativeSend.jump.count).toBe(1);

    service.destroy();
  });

  it('does not reserve a dedupe key when the accepted take span is invalid, so a later valid retry still aggregates', () => {
    const service = createService();
    const frame = new Uint8Array(1920 * 1080 * 4);

    service.setOutputEnabled('audience', true);
    service.receiveFrame('audience', frame, 1920, 1080, {
      attemptId: 'session:1',
      captureDurationMs: 1,
      readbackDurationMs: 1,
      skippedCaptures: 0,
      framesDroppedBackpressure: 0,
      correctiveFrameRetries: 0,
      takeKind: 'take',
      takeReason: 'jump',
      takeSessionId: 'take-session-invalid-span',
      takeSequenceId: 88,
      takeIssuedAtMs: 0,
      captureStartedAtMs: Date.now() - 5,
    });
    service.receiveFrame('audience', frame, 1920, 1080, {
      attemptId: 'session:2',
      captureDurationMs: 1,
      readbackDurationMs: 1,
      skippedCaptures: 0,
      framesDroppedBackpressure: 0,
      correctiveFrameRetries: 0,
      takeKind: 'take',
      takeReason: 'jump',
      takeSessionId: 'take-session-invalid-span',
      takeSequenceId: 88,
      takeIssuedAtMs: Date.now() - 10,
      captureStartedAtMs: Date.now() - 5,
    });

    const diagnostics = service.getDiagnostics();
    expect(diagnostics.senders.audience?.performance.pipeline.takeToNativeSend.count).toBe(1);
    expect(diagnostics.senders.audience?.performance.pipeline.takeReasonToNativeSend.jump.count).toBe(1);

    service.destroy();
  });

  it('drops huge finite telemetry values before they can poison aggregates', () => {
    const service = createService();
    const frame = new Uint8Array(1920 * 1080 * 4);

    service.setOutputEnabled('audience', true);
    service.receiveFrame('audience', frame, 1920, 1080, {
      attemptId: 'session:1',
      captureDurationMs: Number.MAX_VALUE,
      readbackDurationMs: Number.MAX_VALUE,
      skippedCaptures: Number.MAX_VALUE,
      framesDroppedBackpressure: Number.MAX_VALUE,
      correctiveFrameRetries: Number.MAX_VALUE,
      signatureChangedAtMs: Number.MAX_VALUE,
      captureStartedAtMs: Number.MAX_VALUE,
      rendererSendAtMs: Number.MAX_VALUE,
    } as never);
    service.receiveFrame('audience', frame, 1920, 1080, {
      attemptId: 'session:2',
      captureDurationMs: Number.MAX_VALUE,
      readbackDurationMs: Number.MAX_VALUE,
      skippedCaptures: Number.MAX_VALUE,
      framesDroppedBackpressure: Number.MAX_VALUE,
      correctiveFrameRetries: Number.MAX_VALUE,
      signatureChangedAtMs: Number.MAX_VALUE,
      captureStartedAtMs: Number.MAX_VALUE,
      rendererSendAtMs: Number.MAX_VALUE,
    } as never);

    const diagnostics = service.getDiagnostics();
    expect(diagnostics.senders.audience?.performance.skippedCaptures).toBe(0);
    expect(diagnostics.senders.audience?.performance.framesDroppedBackpressure).toBe(0);
    expect(diagnostics.senders.audience?.performance.correctiveFrameRetries).toBe(0);
    expect(diagnostics.senders.audience?.performance.avgCaptureDurationMs).toBe(0);
    expect(diagnostics.senders.audience?.performance.avgReadbackDurationMs).toBe(0);
    expect(diagnostics.senders.audience?.performance.pipeline.signatureToNativeSend.count).toBe(0);
    expect(diagnostics.senders.audience?.performance.pipeline.frameAgeAtNativeSend.count).toBe(0);

    service.destroy();
  });
});
