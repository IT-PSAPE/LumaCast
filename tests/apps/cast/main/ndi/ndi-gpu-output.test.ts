import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NdiGpuSceneSnapshot, NdiOutputState } from '@lumacast/protocol';
import type { NdiServiceProxy } from '../../../../../apps/cast/main/ndi/ndi-service-proxy';
import { GpuFrameQueue } from '../../../../../apps/cast/main/ndi/gpu-frame-queue';
import { NdiGpuOutput } from '../../../../../apps/cast/main/ndi/ndi-gpu-output';

const mocks = vi.hoisted(() => {
  class MockWindow {
    webContents = {
      setZoomFactor: vi.fn(), setFrameRate: vi.fn(), setWindowOpenHandler: vi.fn(),
      on: vi.fn(), send: vi.fn(), startPainting: vi.fn(), stopPainting: vi.fn(),
    };
    loadURL = vi.fn().mockResolvedValue(undefined);
    isDestroyed = vi.fn().mockReturnValue(false);
    destroy = vi.fn();
    constructor() { windows.push(this); }
  }
  const windows: MockWindow[] = [];
  return { MockWindow, windows, on: vi.fn(), removeListener: vi.fn() };
});
vi.mock('electron', () => ({
  BrowserWindow: mocks.MockWindow,
  ipcMain: { on: mocks.on, removeListener: mocks.removeListener },
}));

const scene = { width: 1920, height: 1080, slide: { id: 'slide' }, nodes: [] } as unknown as NdiGpuSceneSnapshot['scene'];
function snapshot(revisionId = 'scene:1', takeSequenceId = 1): NdiGpuSceneSnapshot {
  return {
    name: 'audience', revisionId, scene,
    binding: { currentSlideText: null, nextSlideText: null, slideNotes: null, timerReadings: {} },
    layerVideo: null,
    telemetry: { captureDurationMs: 0, readbackDurationMs: 0, skippedCaptures: 0,
      framesDroppedBackpressure: 0, correctiveFrameRetries: 0,
      takeSessionId: 'session', takeSequenceId },
  };
}

let output: NdiGpuOutput;
let state: NdiOutputState;
let stateChanged: (state: NdiOutputState) => void;
let ready: (event: { sender: unknown }, revisionId: string) => void;
let reportError: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.windows.length = 0;
  state = { audience: true, stage: false };
  reportError = vi.fn();
  const service = {
    getOutputState: () => ({ ...state }),
    onOutputStateChanged: (callback: typeof stateChanged) => { stateChanged = callback; return vi.fn(); },
    reportGpuSourceError: reportError,
  } as unknown as NdiServiceProxy;
  output = new NdiGpuOutput(service, '/cast/main');
  ready = mocks.on.mock.calls[0]![1];
});
afterEach(async () => { await output.stop(); vi.restoreAllMocks(); vi.useRealTimers(); });
function commit(value: NdiGpuSceneSnapshot) {
  output.publish(value);
  ready({ sender: mocks.windows[0]!.webContents }, value.revisionId);
}

describe('NDI GPU capture lifecycle', () => {
  it('keeps a bounded capture retry window across repeated updates for one take', () => {
    commit(snapshot());
    const contents = mocks.windows[0]!.webContents;
    for (let update = 0; update < 60; update += 1) {
      vi.advanceTimersByTime(100);
      output.publish(snapshot());
    }
    expect(contents.startPainting).toHaveBeenCalledTimes(20);
    expect(reportError).toHaveBeenCalledExactlyOnceWith('NDI audience did not produce a shared texture');
    output.publish(snapshot('scene:1', 2));
    expect(contents.startPainting).toHaveBeenCalledTimes(21);
    // A distinct session may reuse the same sequence number.
    const nextSession = snapshot('scene:1', 2);
    nextSession.telemetry!.takeSessionId = 'next-session';
    output.publish(nextSession);
    expect(contents.startPainting).toHaveBeenCalledTimes(22);
  });

  it('forces fresh capture after sender invalidation and re-enabling the same scene', () => {
    commit(snapshot());
    const contents = mocks.windows[0]!.webContents;
    output.invalidate();
    expect(contents.startPainting).toHaveBeenCalledTimes(2);
    output.publish(snapshot());
    expect(contents.startPainting).toHaveBeenCalledTimes(2);
    state.audience = false; stateChanged(state);
    vi.advanceTimersByTime(6000);
    expect(contents.startPainting).toHaveBeenCalledTimes(2);
    expect(reportError).not.toHaveBeenCalled();
    state.audience = true; stateChanged(state);
    expect(contents.startPainting).toHaveBeenCalledTimes(3);
    output.publish(snapshot());
    expect(contents.startPainting).toHaveBeenCalledTimes(3);
  });

  it('discards pending textures on scene change and disable, while retaining video clock updates', () => {
    const discard = vi.spyOn(GpuFrameQueue.prototype, 'discardPending');
    commit(snapshot());
    output.publish(snapshot());
    expect(discard).not.toHaveBeenCalled();
    output.publish(snapshot('scene:2'));
    expect(discard).toHaveBeenCalledTimes(1);
    // An obsolete draw acknowledgement cannot resume the old scene.
    const contents = mocks.windows[0]!.webContents;
    ready({ sender: contents }, 'scene:1');
    expect(contents.startPainting).toHaveBeenCalledTimes(1);
    ready({ sender: contents }, 'scene:2');
    expect(contents.startPainting).toHaveBeenCalledTimes(2);
    state.audience = false; stateChanged(state);
    expect(discard).toHaveBeenCalledTimes(2);
  });
});
