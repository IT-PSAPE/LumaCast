import { afterEach, describe, expect, it, vi } from 'vitest';
const transport = vi.hoisted(() => ({ sendFrame: vi.fn(), attach: vi.fn(), reset: vi.fn() }));
vi.mock('../../../../../app/renderer/features/playback/ndi-frame-transport-client', () => ({ NdiFrameTransportClient: class { sendFrame = transport.sendFrame; attach = transport.attach; reset = transport.reset; } }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks(); });
async function setup(direct: boolean) {
  transport.sendFrame.mockReturnValue(direct);
  const worker = { postMessage: vi.fn(), onmessage: null as null | ((event: MessageEvent) => void) };
  vi.stubGlobal('self', worker);
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return { clearRect: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(16) }) }; } });
  await import('../../../../../app/renderer/features/playback/ndi-readback-worker');
  const bitmap = { width: 1920, height: 1080, close: vi.fn() };
  worker.onmessage!({ data: { type: 'capture', bitmap, requestId: 1, name: 'audience', attemptId: 'capture:1', withAlpha: false,
    captureStartedAtEpochMs: performance.timeOrigin + performance.now() - 10,
    telemetry: { attemptId: 'capture:1', captureDurationMs: 1, skippedCaptures: 0, framesDroppedBackpressure: 0, correctiveFrameRetries: 0 } } } as MessageEvent);
  return { worker, bitmap };
}
describe('NDI readback worker submission', () => {
  it('submits directly after readback without a renderer reply', async () => {
    const { worker, bitmap } = await setup(true);
    expect(transport.sendFrame).toHaveBeenCalledOnce();
    expect(transport.sendFrame).toHaveBeenCalledWith(expect.objectContaining({ name: 'audience', attemptId: 'capture:1', buffer: expect.any(ArrayBuffer) }));
    expect(worker.postMessage.mock.calls.some(([message]) => message.type === 'captured')).toBe(false);
    expect(bitmap.close).toHaveBeenCalledOnce();
    const telemetry = transport.sendFrame.mock.calls[0]![0].telemetry;
    expect(telemetry.captureDurationMs).toBeGreaterThanOrEqual(10);
  });
  it('transfers the frame back immediately if direct transport is unavailable', async () => {
    const { worker } = await setup(false);
    const fallback = worker.postMessage.mock.calls.find(([message]) => message.type === 'captured');
    expect(fallback?.[0]).toMatchObject({ requestId: 1, width: 1920, height: 1080 });
    expect(fallback?.[1]).toEqual([fallback?.[0].buffer]);
  });
});
