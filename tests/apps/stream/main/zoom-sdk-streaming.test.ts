// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import type { ZoomLiveService } from '../../../../apps/stream/main/zoom-live';
import { ZoomSdkStreaming } from '../../../../apps/stream/main/zoom-sdk-streaming';
import { IPC_CHANNELS } from '../../../../apps/stream/main/ipc-channels';
import type { StreamOutputSettings, StreamRuntimeStatus } from '../../../../apps/stream/shared/desktop-api';

const electronMocks = vi.hoisted(() => {
  class FakePort {
    on = vi.fn();
    start = vi.fn();
    close = vi.fn();
    removeAllListeners = vi.fn();
    postMessage = vi.fn();
  }

  class FakeMessageChannelMain {
    port1 = new FakePort();
    port2 = new FakePort();
  }

  return {
    FakeMessageChannelMain,
    electronModule: {
      MessageChannelMain: FakeMessageChannelMain,
      app: { isPackaged: false, getAppPath: () => '/test-app' },
    },
  };
});

vi.mock('electron', () => electronMocks.electronModule);
vi.mock('../../../../apps/stream/node_modules/electron/index.js', () => electronMocks.electronModule);

interface ZoomSdkEvent { state: string; message: string; }
interface ZoomSdkAddon {
  initialize(publicAppKey: string, onEvent: (event: ZoomSdkEvent) => void): { ok: boolean; message: string };
  startMeeting(meetingNumber: string, zak: string, zoomUserId: string, displayName: string): { ok: boolean; message: string };
  startProductionStudio(width: number, height: number): { ok: boolean; message: string };
  sendVideoFrame(data: Buffer, width: number, height: number): { ok: boolean; message: string };
  sendAudioFrame(data: Buffer, sampleRate: number, channels: number): { ok: boolean; message: string };
  stop(): void;
}

const outputSettings: StreamOutputSettings = {
  width: 1280,
  height: 720,
  frameRate: 30,
  videoBitrateKbps: 4000,
  audioBitrateKbps: 160,
  rateControl: 'cbr',
  encoder: 'libopenh264',
  encoderQuality: 23,
  hardwareEncoding: false,
  keyframeIntervalSeconds: 2,
};

function createHarness() {
  const statuses: StreamRuntimeStatus[] = [];
  const contents = {
    isDestroyed: () => false,
    postMessage: vi.fn(),
    send: vi.fn((_channel: string, status: StreamRuntimeStatus) => statuses.push(status)),
  };
  const zoomLive = {
    getAccount: vi.fn(async () => ({ userId: 'zoom-user', displayName: 'Host', email: 'host@example.com' })),
    getZak: vi.fn(async () => 'test-zak'),
    getSdkPublicAppKey: vi.fn(() => 'test-app-key'),
  } as unknown as ZoomLiveService;

  let emitSdkEvent: ((event: ZoomSdkEvent) => void) | undefined;
  const addon: ZoomSdkAddon = {
    initialize: vi.fn((_publicAppKey, onEvent) => { emitSdkEvent = onEvent; return { ok: true, message: '' }; }),
    startMeeting: vi.fn(() => ({ ok: true, message: '' })),
    startProductionStudio: vi.fn(() => ({ ok: true, message: '' })),
    sendVideoFrame: vi.fn(() => ({ ok: true, message: '' })),
    sendAudioFrame: vi.fn(() => ({ ok: true, message: '' })),
    stop: vi.fn(),
  };
  const streaming = new ZoomSdkStreaming(zoomLive, () => contents as unknown as WebContents);
  Object.defineProperty(streaming, 'loadAddon', { value: () => addon });

  return {
    statuses,
    contents,
    addon,
    streaming,
    emit(event: ZoomSdkEvent) {
      if (!emitSdkEvent) throw new Error('Zoom SDK initialize did not register an event handler.');
      emitSdkEvent(event);
    },
  };
}

describe('Zoom SDK connection phases', () => {
  it('reports joining, starting output, live, then stopped without phases after connecting', async () => {
    const harness = createHarness();
    const sessionId = await harness.streaming.start('123456789', outputSettings);

    expect(harness.statuses.at(-1)).toMatchObject({ state: 'connecting', message: 'Connecting to Zoom Meeting SDK.' });
    expect(harness.statuses.at(-1)?.connectionPhase).toBeUndefined();

    harness.emit({ state: 'authenticated', message: 'Authenticated.' });
    expect(harness.statuses.at(-1)).toMatchObject({ state: 'connecting', connectionPhase: 'joining', message: 'Joining Zoom meeting.' });
    expect(harness.addon.startMeeting).toHaveBeenCalledWith('123456789', 'test-zak', 'zoom-user', 'Host');

    harness.emit({ state: 'meeting-connecting', message: 'Waiting for the Zoom meeting host.' });
    expect(harness.statuses.at(-1)).toMatchObject({ state: 'connecting', connectionPhase: 'joining', message: 'Waiting for the Zoom meeting host.' });

    harness.emit({ state: 'meeting', message: 'Joined Zoom meeting.' });
    expect(harness.statuses.at(-1)).toMatchObject({ state: 'connecting', connectionPhase: 'starting-output', message: 'Starting Zoom output.' });
    expect(harness.addon.startProductionStudio).toHaveBeenCalledWith(1280, 720);

    harness.emit({ state: 'production-studio-starting', message: 'Waiting for the Zoom sender.' });
    expect(harness.statuses.at(-1)).toMatchObject({ state: 'connecting', connectionPhase: 'starting-output', message: 'Waiting for the Zoom sender.' });

    harness.emit({ state: 'production-studio', message: 'Zoom Production Studio is sending media.' });
    expect(harness.statuses.at(-1)).toMatchObject({ state: 'live', message: 'Zoom Production Studio is sending media.' });
    expect(harness.statuses.at(-1)?.connectionPhase).toBeUndefined();

    harness.streaming.stop(sessionId);
    expect(harness.statuses.at(-1)).toMatchObject({ state: 'stopped', message: 'Zoom output stopped.' });
    expect(harness.statuses.at(-1)?.connectionPhase).toBeUndefined();
    expect(harness.addon.stop).toHaveBeenCalledOnce();
    expect(harness.contents.postMessage).toHaveBeenCalledWith(IPC_CHANNELS.zoomMediaPort, sessionId, expect.any(Array));
  });

  it('clears connection phase when the SDK fails', async () => {
    const harness = createHarness();
    await harness.streaming.start('123456789', outputSettings);

    harness.emit({ state: 'authenticated', message: 'Authenticated.' });
    harness.emit({ state: 'error', message: 'Could not join Zoom meeting.' });

    expect(harness.statuses.at(-1)).toMatchObject({ state: 'error', message: 'Could not join Zoom meeting.' });
    expect(harness.statuses.at(-1)?.connectionPhase).toBeUndefined();
    expect(harness.addon.stop).toHaveBeenCalledOnce();
  });

  it('fails and cleans up when Production Studio stops sending after going live', async () => {
    const harness = createHarness();
    await harness.streaming.start('123456789', outputSettings);

    harness.emit({ state: 'authenticated', message: 'Authenticated.' });
    harness.emit({ state: 'meeting', message: 'Joined Zoom meeting.' });
    harness.emit({ state: 'production-studio', message: 'Zoom Production Studio is sending media.' });
    expect(harness.statuses.at(-1)?.state).toBe('live');

    harness.emit({ state: 'production-studio-stopped', message: 'Zoom Production Studio stopped sending.' });

    expect(harness.statuses.at(-1)).toMatchObject({
      outputId: 'zoom',
      state: 'error',
      message: 'Zoom Production Studio stopped sending. Start the output again.',
    });
    expect(harness.addon.stop).toHaveBeenCalledOnce();
    const statusCount = harness.statuses.length;
    harness.emit({ state: 'production-studio-stopped', message: 'Late stop callback.' });
    expect(harness.statuses).toHaveLength(statusCount);
  });

  it.each(['stop', 'stopAll'] as const)('keeps an explicit %s stopped when native stop callbacks arrive late', async (stopKind) => {
    const harness = createHarness();
    const sessionId = await harness.streaming.start('123456789', outputSettings);

    harness.emit({ state: 'authenticated', message: 'Authenticated.' });
    harness.emit({ state: 'meeting', message: 'Joined Zoom meeting.' });
    harness.emit({ state: 'production-studio', message: 'Zoom Production Studio is sending media.' });

    if (stopKind === 'stop') harness.streaming.stop(sessionId);
    else harness.streaming.stopAll();
    harness.emit({ state: 'production-studio-stopped', message: 'Zoom Production Studio stopped sending.' });

    expect(harness.statuses.at(-1)).toMatchObject({ outputId: 'zoom', state: 'stopped' });
    expect(harness.addon.stop).toHaveBeenCalledOnce();
  });
});
