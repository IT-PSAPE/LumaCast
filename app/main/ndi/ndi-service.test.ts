import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultNdiOutputConfigs, NDI_OUTPUT_HEIGHT, NDI_OUTPUT_WIDTH } from '@core/ndi';
import { NdiService } from './ndi-service';
import type { NdiNativeModule } from './ndi-native-module';

function createModuleMock() {
  const module: NdiNativeModule = {
    initializeSender: vi.fn(),
    sendRgbaFrame: vi.fn(),
    getSenderConnections: vi.fn(() => 1),
    destroySender: vi.fn(),
    getRuntimeInfo: vi.fn(() => ({ loaded: true, path: '/mock/ndi.node', asyncVideoSend: true })),
  };
  return module;
}

describe('NdiService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tracks frame telemetry for the active sender', () => {
    const module = createModuleMock();
    const service = new NdiService({
      outputConfigs: createDefaultNdiOutputConfigs(),
      onOutputConfigsChanged: vi.fn(),
      moduleLoader: () => module,
    });

    service.setOutputEnabled('audience', true);

    const frame = new Uint8Array(NDI_OUTPUT_WIDTH * NDI_OUTPUT_HEIGHT * 4);
    service.receiveFrame('audience', frame, NDI_OUTPUT_WIDTH, NDI_OUTPUT_HEIGHT, {
      captureDurationMs: 5,
      readbackDurationMs: 3,
      skippedCaptures: 2,
      framesDroppedBackpressure: 1,
    });

    const diagnostics = service.getDiagnostics();
    expect(diagnostics.sourceStatus).toBe('live');
    expect(diagnostics.senders.audience).not.toBeNull();
    expect(diagnostics.senders.stage).toBeNull();
    expect(diagnostics.activeSender?.performance).toMatchObject({
      framesCaptured: 1,
      framesSent: 1,
      framesReplayed: 0,
      framesRejected: 0,
      skippedCaptures: 2,
      framesDroppedBackpressure: 1,
      bytesReceived: frame.byteLength,
      cacheCopyBytes: 0,
      lastFrameBytes: frame.byteLength,
      avgCaptureDurationMs: 5,
      avgReadbackDurationMs: 3,
    });
    expect(diagnostics.activeSender?.asyncVideoSend).toBe(true);
    expect(diagnostics.activeSender?.connectionCount).toBe(1);
    expect(diagnostics.activeSender?.performance.avgSendDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('replays the cached frame when renderer input stalls', () => {
    const module = createModuleMock();
    const service = new NdiService({
      outputConfigs: createDefaultNdiOutputConfigs(),
      onOutputConfigsChanged: vi.fn(),
      moduleLoader: () => module,
    });

    service.setOutputEnabled('audience', true);

    const frame = new Uint8Array(NDI_OUTPUT_WIDTH * NDI_OUTPUT_HEIGHT * 4);
    service.receiveFrame('audience', frame, NDI_OUTPUT_WIDTH, NDI_OUTPUT_HEIGHT, {
      captureDurationMs: 4,
      readbackDurationMs: 2,
      skippedCaptures: 0,
      framesDroppedBackpressure: 0,
    });

    vi.advanceTimersByTime(100);

    const diagnostics = service.getDiagnostics();
    expect(module.sendRgbaFrame).toHaveBeenCalledTimes(2);
    expect(diagnostics.senders.audience?.performance.framesSent).toBe(2);
    expect(diagnostics.activeSender?.performance.framesSent).toBe(2);
    expect(diagnostics.activeSender?.performance.framesReplayed).toBe(1);
    expect(diagnostics.activeSender?.performance.cacheCopyBytes).toBe(0);
  });

  it('copies the cached frame only when rebuilding a sender', () => {
    const module = createModuleMock();
    const service = new NdiService({
      outputConfigs: createDefaultNdiOutputConfigs(),
      onOutputConfigsChanged: vi.fn(),
      moduleLoader: () => module,
    });

    service.setOutputEnabled('audience', true);

    const frame = new Uint8Array(NDI_OUTPUT_WIDTH * NDI_OUTPUT_HEIGHT * 4);
    service.receiveFrame('audience', frame, NDI_OUTPUT_WIDTH, NDI_OUTPUT_HEIGHT, {
      captureDurationMs: 4,
      readbackDurationMs: 2,
      skippedCaptures: 0,
      framesDroppedBackpressure: 0,
    });

    service.updateOutputConfig('audience', { withAlpha: true });

    const diagnostics = service.getDiagnostics();
    expect(diagnostics.senders.audience?.performance.cacheCopyBytes).toBe(frame.byteLength);
    expect(diagnostics.activeSender?.performance.cacheCopyBytes).toBe(frame.byteLength);
  });

  it('counts rejected frames without sending them', () => {
    const module = createModuleMock();
    const service = new NdiService({
      outputConfigs: createDefaultNdiOutputConfigs(),
      onOutputConfigsChanged: vi.fn(),
      moduleLoader: () => module,
    });

    service.setOutputEnabled('audience', true);
    service.receiveFrame('audience', new Uint8Array(32), 2, 4, {
      captureDurationMs: 1,
      readbackDurationMs: 1,
      skippedCaptures: 0,
      framesDroppedBackpressure: 0,
    });

    const diagnostics = service.getDiagnostics();
    expect(module.sendRgbaFrame).not.toHaveBeenCalled();
    expect(diagnostics.senders.audience?.performance.framesRejected).toBe(1);
    expect(diagnostics.activeSender?.performance.framesRejected).toBe(1);
    expect(diagnostics.lastError).toContain('Rejected invalid NDI frame');
  });

  it('skips transport sends when there are no active NDI receivers', () => {
    const module = createModuleMock();
    module.getSenderConnections = vi.fn(() => 0);
    const service = new NdiService({
      outputConfigs: createDefaultNdiOutputConfigs(),
      onOutputConfigsChanged: vi.fn(),
      moduleLoader: () => module,
    });

    service.setOutputEnabled('audience', true);
    const frame = new Uint8Array(NDI_OUTPUT_WIDTH * NDI_OUTPUT_HEIGHT * 4);
    service.receiveFrame('audience', frame, NDI_OUTPUT_WIDTH, NDI_OUTPUT_HEIGHT, {
      captureDurationMs: 2,
      readbackDurationMs: 1,
      skippedCaptures: 0,
      framesDroppedBackpressure: 0,
    });

    const diagnostics = service.getDiagnostics();
    expect(module.sendRgbaFrame).not.toHaveBeenCalled();
    expect(diagnostics.senders.audience?.connectionCount).toBe(0);
    expect(diagnostics.senders.audience?.performance.framesSkippedNoConnections).toBe(1);
    expect(diagnostics.activeSender?.connectionCount).toBe(0);
    expect(diagnostics.activeSender?.performance.framesSkippedNoConnections).toBe(1);
  });

  it('exposes stage diagnostics when stage is the only enabled output', () => {
    const module = createModuleMock();
    const service = new NdiService({
      outputConfigs: createDefaultNdiOutputConfigs(),
      onOutputConfigsChanged: vi.fn(),
      moduleLoader: () => module,
    });

    service.setOutputEnabled('stage', true);

    const frame = new Uint8Array(NDI_OUTPUT_WIDTH * NDI_OUTPUT_HEIGHT * 4);
    service.receiveFrame('stage', frame, NDI_OUTPUT_WIDTH, NDI_OUTPUT_HEIGHT, {
      captureDurationMs: 3,
      readbackDurationMs: 2,
      skippedCaptures: 0,
      framesDroppedBackpressure: 0,
    });

    const diagnostics = service.getDiagnostics();
    expect(diagnostics.outputConfig).toEqual(createDefaultNdiOutputConfigs().stage);
    expect(diagnostics.senders.audience).toBeNull();
    expect(diagnostics.senders.stage?.performance.framesSent).toBe(1);
    expect(diagnostics.activeSender?.senderName).toBe(diagnostics.senders.stage?.senderName);
  });
});
