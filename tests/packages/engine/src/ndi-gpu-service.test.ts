import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultNdiOutputConfigs, type NdiGpuFrameResult } from '@lumacast/protocol';
import { NdiService } from '../../../../packages/engine/src/ndi-service';
const result = { conversionDurationMs: 2, sendDurationMs: 3, frameBytes: 1920 * 1080 * 3 };
const handle = { platform: 'darwin' as const, surfaceId: 123 };
const telemetry = { attemptId: 'gpu:1', captureDurationMs: 0, readbackDurationMs: 0, skippedCaptures: 0, framesDroppedBackpressure: 0, correctiveFrameRetries: 0 };
const services: NdiService[] = [];
afterEach(() => { services.forEach((service) => service.destroy()); services.length = 0; vi.useRealTimers(); });
function setup(send = vi.fn<(...args: unknown[]) => Promise<NdiGpuFrameResult>>().mockResolvedValue(result)) {
  const discard = vi.fn();
  const replay = vi.fn().mockResolvedValue(result);
  const service = new NdiService({ outputConfigs: createDefaultNdiOutputConfigs(), onOutputConfigsChanged: vi.fn(), moduleLoader: () => ({ initializeSender: vi.fn(), destroySender: vi.fn(), sendRgbaFrame: vi.fn(), sendSharedTextureFrame: send, discardSharedTexture: discard, replaySharedTextureFrame: replay }) });
  services.push(service);
  service.setOutputEnabled('audience', true);
  const release = vi.fn(); service.onFrameReleased(release);
  return { service, release, send, discard, replay };
}
describe('native GPU frames', () => {
  it('releases the texture only after native completion and keeps pixel bytes out of JS cache', async () => {
    let resolve!: (value: NdiGpuFrameResult) => void;
    const send = vi.fn().mockImplementation(() => new Promise<NdiGpuFrameResult>((done) => { resolve = done; }));
    const { service, release, discard } = setup(send);
    const pending = service.receiveSharedTextureFrame('audience', handle, 'bgra', telemetry);
    expect(release).not.toHaveBeenCalled();
    resolve(result); await pending;
    expect(release).toHaveBeenCalledWith(expect.objectContaining({ accepted: true, gpuFrameResult: result }));
    expect(discard).not.toHaveBeenCalled();
    const stats = service.getDiagnostics().senders.audience!.performance;
    expect(stats.framesSent).toBe(1); expect(stats.bytesReceived).toBe(0); expect(stats.cacheCopyBytes).toBe(0);
  });
  it('acknowledges native failures and disposes handles rejected before native submission', async () => {
    const { service, release, discard, send } = setup(vi.fn().mockRejectedValue(new Error('Import failed')));
    await service.receiveSharedTextureFrame('audience', handle, 'bgra', telemetry);
    expect(release).toHaveBeenLastCalledWith(expect.objectContaining({ accepted: false, reason: 'nativeSendFailed' }));
    expect(discard).not.toHaveBeenCalled();
    service.setOutputEnabled('audience', false);
    await service.receiveSharedTextureFrame('audience', handle, 'bgra', telemetry);
    expect(discard).toHaveBeenCalledWith(handle); expect(send).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'outputDisabled' }));
  });
  it('replays the native cache for a static scene', async () => {
    vi.useFakeTimers();
    const { service, replay } = setup();
    await service.receiveSharedTextureFrame('audience', handle, 'bgra', telemetry);
    await vi.advanceTimersByTimeAsync(100);
    expect(replay).toHaveBeenCalled();
    expect(service.getDiagnostics().senders.audience!.performance.framesReplayed).toBeGreaterThan(0);
  });
  it('does not attribute completion to a replacement sender', async () => {
    let resolve!: (value: NdiGpuFrameResult) => void;
    const { service, release } = setup(vi.fn().mockImplementation(() => new Promise<NdiGpuFrameResult>((done) => { resolve = done; })));
    const pending = service.receiveSharedTextureFrame('audience', handle, 'bgra', telemetry);
    service.updateOutputConfig('audience', { withAlpha: false });
    resolve(result); await pending;
    expect(release).toHaveBeenCalledWith(expect.objectContaining({ accepted: false, reason: 'senderUnavailable' }));
    expect(service.getDiagnostics().senders.audience!.performance.framesSent).toBe(0);
  });
});
