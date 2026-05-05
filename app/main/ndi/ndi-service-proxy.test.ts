import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultNdiOutputConfigs, NDI_OUTPUT_HEIGHT, NDI_OUTPUT_WIDTH } from '@core/ndi';
import { NdiServiceProxy } from './ndi-service-proxy';

const electronMock = vi.hoisted(() => ({
  host: null as {
    stdout: EventEmitter;
    stderr: EventEmitter;
    postMessage: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
    on: EventEmitter['on'];
  } | null,
  fork: vi.fn(),
}));

vi.mock('electron', () => ({
  utilityProcess: {
    fork: electronMock.fork,
  },
}));

describe('NdiServiceProxy', () => {
  beforeEach(() => {
    const events = new EventEmitter();
    electronMock.host = {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      postMessage: vi.fn(),
      kill: vi.fn(),
      on: events.on.bind(events),
    };
    electronMock.fork.mockReset();
    electronMock.fork.mockReturnValue(electronMock.host);
  });

  it('posts frames to the utility host without an ArrayBuffer transfer list', () => {
    const proxy = new NdiServiceProxy({
      outputConfigs: createDefaultNdiOutputConfigs(),
      onOutputConfigsChanged: vi.fn(),
      hostModulePath: '/mock/ndi-host.js',
    });
    const host = electronMock.host!;
    host.postMessage.mockClear();

    const frame = new Uint8Array(NDI_OUTPUT_WIDTH * NDI_OUTPUT_HEIGHT * 4);
    proxy.receiveFrame('audience', frame, NDI_OUTPUT_WIDTH, NDI_OUTPUT_HEIGHT, {
      captureDurationMs: 1,
      readbackDurationMs: 1,
      skippedCaptures: 0,
      framesDroppedBackpressure: 0,
    });

    expect(host.postMessage).toHaveBeenCalledTimes(1);
    expect(host.postMessage.mock.calls[0]).toHaveLength(1);
    expect(host.postMessage.mock.calls[0][0]).toMatchObject({
      type: 'frame',
      name: 'audience',
      width: NDI_OUTPUT_WIDTH,
      height: NDI_OUTPUT_HEIGHT,
    });
  });
});
