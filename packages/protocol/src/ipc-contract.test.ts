import { describe, expect, it, vi, beforeEach } from 'vitest';

// `app/main/preload.ts` calls `contextBridge.exposeInMainWorld` as a module
// side effect. Mocking 'electron' lets us load the real preload module in
// vitest and inspect exactly what it hands to the renderer, instead of
// trusting that its `satisfies MainApi` annotation alone is enough — a
// completeness test that only re-states the type system proves nothing.
const invoke = vi.fn(async () => undefined);
const send = vi.fn();
const on = vi.fn();
const removeListener = vi.fn();
const getPathForFile = vi.fn(() => '/tmp/fake-path');
const exposeInMainWorld = vi.fn();

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke, send, on, removeListener },
  webUtils: { getPathForFile },
}));

import {
  APP_MENU_EVENTS,
  IPC,
  MEDIA_DERIVATIVE_EVENTS,
  NDI_EVENTS,
  NDI_FRAME_CHANNEL_NAMES,
  NDI_FRAME_TRANSPORT_PORT_CHANNEL,
  PERSISTENCE_CHANNELS,
  PERSISTENCE_EVENTS,
} from './ipc';

// Importing the real preload module runs `contextBridge.exposeInMainWorld`
// as a side effect; this is the only way to observe the bridge object it
// actually builds, as opposed to what `MainApi` merely permits it to build.
await import('../../../app/main/preload');

const frameTransportPortRegistration = on.mock.calls.find(
  ([channel]) => channel === NDI_FRAME_TRANSPORT_PORT_CHANNEL,
);

function exposedApi(): Record<string, unknown> {
  const call = exposeInMainWorld.mock.calls.find(([key]) => key === 'castApi');
  if (!call) throw new Error('preload never exposed castApi');
  return call[1] as Record<string, unknown>;
}

// Explicit channel -> preload method name tables for the two event maps.
// These mirror `app/core/ipc.ts`'s `NdiEventPayloads`/`AppMenuEventPayloads`
// and preload's `onNdi*`/`onAppMenuCommand` subscription wrappers. Kept
// separate from the RPC and frame name sets below on purpose: this is the
// runtime half of "events/subscriptions and frame/message channels are
// separate maps, not RPC entries."
const NDI_EVENT_METHOD_NAMES: Record<keyof typeof NDI_EVENTS, string> = {
  outputStateChanged: 'onNdiOutputStateChanged',
  diagnosticsChanged: 'onNdiDiagnosticsChanged',
  frameReleased: 'onNdiFrameReleased',
};

const APP_MENU_EVENT_METHOD_NAMES: Record<keyof typeof APP_MENU_EVENTS, string> = {
  command: 'onAppMenuCommand',
};

const PERSISTENCE_EVENT_METHOD_NAMES: Record<keyof typeof PERSISTENCE_EVENTS, string> = {
  progress: 'onPersistenceProgress',
};

const MEDIA_DERIVATIVE_EVENT_METHOD_NAMES: Record<keyof typeof MEDIA_DERIVATIVE_EVENTS, string> = {
  progress: 'onMediaDerivativeProgress',
};

const UTIL_METHOD_NAMES = ['platform', 'getPathForFile'];

const frameNames: readonly string[] = NDI_FRAME_CHANNEL_NAMES;
const rpcNames = Object.keys(IPC).filter((key) => !frameNames.includes(key));
const eventMethodNames = [
  ...Object.values(NDI_EVENT_METHOD_NAMES),
  ...Object.values(APP_MENU_EVENT_METHOD_NAMES),
  ...Object.values(PERSISTENCE_EVENT_METHOD_NAMES),
  ...Object.values(MEDIA_DERIVATIVE_EVENT_METHOD_NAMES),
];

describe('ipc contract: RPC/event/frame classification', () => {
  it('classifies every IPC channel as either RPC or a frame channel, never both', () => {
    expect(rpcNames.length + frameNames.length).toBe(Object.keys(IPC).length);
    for (const name of frameNames) {
      expect(rpcNames).not.toContain(name);
    }
  });

  it('never reuses a wire channel string across RPC, event, and frame classifications', () => {
    const allChannelStrings = [
      ...Object.values(IPC),
      ...Object.values(NDI_EVENTS),
      NDI_FRAME_TRANSPORT_PORT_CHANNEL,
      ...Object.values(APP_MENU_EVENTS),
      ...Object.values(PERSISTENCE_EVENTS),
      ...Object.values(PERSISTENCE_CHANNELS),
      ...Object.values(MEDIA_DERIVATIVE_EVENTS),
    ];
    expect(new Set(allChannelStrings).size).toBe(allChannelStrings.length);
  });

  it('keeps exactly three NDI frame/control channels, all real IPC channels', () => {
    expect(NDI_FRAME_CHANNEL_NAMES).toEqual(['requestNdiFrameTransport', 'sendNdiFrame', 'sendNdiAudio']);
    for (const name of NDI_FRAME_CHANNEL_NAMES) {
      expect(Object.keys(IPC)).toContain(name);
    }
  });
});

describe('ipc contract: preload exposes exactly the canonical MainApi surface', () => {
  it('has no extra and no missing operations, events, frame senders, or utilities', () => {
    const expectedKeys = [...rpcNames, ...eventMethodNames, ...frameNames, ...UTIL_METHOD_NAMES].sort();
    const actualKeys = Object.keys(exposedApi()).sort();
    expect(actualKeys).toEqual(expectedKeys);
  });
});

describe('ipc contract: RPC operations invoke, never send', () => {
  beforeEach(() => {
    invoke.mockClear();
    send.mockClear();
  });

  it('routes a zero-arg RPC operation through ipcRenderer.invoke on its declared channel', async () => {
    await (exposedApi().getSnapshot as () => Promise<unknown>)();
    expect(invoke).toHaveBeenCalledWith(IPC.getSnapshot);
    expect(send).not.toHaveBeenCalled();
  });

  it('routes a multi-arg RPC operation through ipcRenderer.invoke with positional args preserved', async () => {
    await (exposedApi().renamePlaylist as (id: string, name: string) => Promise<unknown>)('playlist-1', 'New Playlist');
    expect(invoke).toHaveBeenCalledWith(IPC.renamePlaylist, 'playlist-1', 'New Playlist');
  });
});

describe('ipc contract: events subscribe/unsubscribe, never invoke', () => {
  beforeEach(() => {
    on.mockClear();
    removeListener.mockClear();
    invoke.mockClear();
    send.mockClear();
  });

  it('registers an NDI event listener on its declared channel and tears it down on unsubscribe', () => {
    const callback = vi.fn();
    const unsubscribe = (exposedApi().onNdiFrameReleased as (cb: (release: { name: string; accepted: boolean; reason: string; releasedAtMs: number }) => void) => () => void)(callback);
    expect(on).toHaveBeenCalledWith(NDI_EVENTS.frameReleased, expect.any(Function));
    expect(invoke).not.toHaveBeenCalled();

    const [, handler] = on.mock.calls[on.mock.calls.length - 1] as [string, (event: unknown, release: { name: string; accepted: boolean; reason: string; releasedAtMs: number }) => void];
    handler({}, { name: 'stage', accepted: true, reason: 'sent', releasedAtMs: 1 });
    expect(callback).toHaveBeenCalledWith({ name: 'stage', accepted: true, reason: 'sent', releasedAtMs: 1 });

    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith(NDI_EVENTS.frameReleased, handler);
  });

  it('forwards a validated direct-frame MessagePort from preload into the isolated renderer world', () => {
    expect(frameTransportPortRegistration).toBeDefined();
    const [, handler] = frameTransportPortRegistration as [string, (event: { ports: MessagePort[] }, payload: unknown) => void];
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const port = { close: vi.fn() } as unknown as MessagePort;
    const announcement = {
      type: 'lumacast:ndi-frame-transport-port',
      version: 1,
      name: 'audience',
    };

    handler({ ports: [port] }, announcement);

    expect(postMessage).toHaveBeenCalledWith(announcement, '*', [port]);
    expect(port.close).not.toHaveBeenCalled();
    postMessage.mockRestore();
  });

  it('closes malformed or ambiguous direct-frame port deliveries in preload', () => {
    expect(frameTransportPortRegistration).toBeDefined();
    const [, handler] = frameTransportPortRegistration as [string, (event: { ports: MessagePort[] }, payload: unknown) => void];
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const first = { close: vi.fn() } as unknown as MessagePort;
    const second = { close: vi.fn() } as unknown as MessagePort;

    handler({ ports: [first] }, { type: 'wrong', version: 1, name: 'audience' });
    expect(first.close).toHaveBeenCalledOnce();
    expect(postMessage).not.toHaveBeenCalled();

    handler({ ports: [first, second] }, {
      type: 'lumacast:ndi-frame-transport-port',
      version: 1,
      name: 'audience',
    });
    expect(first.close).toHaveBeenCalledTimes(2);
    expect(second.close).toHaveBeenCalledOnce();
    expect(postMessage).not.toHaveBeenCalled();
    postMessage.mockRestore();
  });

  it('registers the app-menu command event on its declared channel', () => {
    const callback = vi.fn();
    (exposedApi().onAppMenuCommand as (cb: (id: string) => void) => () => void)(callback);
    expect(on).toHaveBeenCalledWith(APP_MENU_EVENTS.command, expect.any(Function));
  });

  it('registers persistence progress on its declared channel and forwards the payload', () => {
    const callback = vi.fn();
    const unsubscribe = (exposedApi().onPersistenceProgress as (cb: (progress: unknown) => void) => () => void)(callback);
    expect(on).toHaveBeenCalledWith(PERSISTENCE_EVENTS.progress, expect.any(Function));
    expect(send).toHaveBeenCalledWith(PERSISTENCE_CHANNELS.subscribe);
    const [, handler] = on.mock.calls[on.mock.calls.length - 1] as [string, (event: unknown, progress: unknown) => void];
    const progress = { operation: 'initialize', phase: 'migrating', completed: 2, total: 4 };
    handler({}, progress);
    expect(callback).toHaveBeenCalledWith(progress);
    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith(PERSISTENCE_EVENTS.progress, handler);
  });
});

describe('ipc contract: frame channels send, never invoke', () => {
  beforeEach(() => {
    send.mockClear();
    invoke.mockClear();
  });

  it('requests a direct NDI frame transport without an invoke round trip', () => {
    (exposedApi().requestNdiFrameTransport as (name: string) => void)('audience');
    expect(send).toHaveBeenCalledWith(IPC.requestNdiFrameTransport, { name: 'audience' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('sends an NDI video frame on its declared channel without an invoke round trip', () => {
    const buffer = new ArrayBuffer(4);
    (exposedApi().sendNdiFrame as (
      name: string,
      buffer: ArrayBuffer,
      width: number,
      height: number,
    ) => void)('audience', buffer, 1, 1);
    expect(send).toHaveBeenCalledWith(
      IPC.sendNdiFrame,
      expect.objectContaining({ name: 'audience', buffer, width: 1, height: 1 }),
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it('sends NDI audio on its declared channel without an invoke round trip', () => {
    const samples = new Float32Array([0, 1, 2, 3]);
    (exposedApi().sendNdiAudio as (
      name: string,
      samples: Float32Array,
      sampleRate: number,
      channels: number,
      samplesPerChannel: number,
    ) => void)('stage', samples, 48000, 2, 2);
    expect(send).toHaveBeenCalledWith(
      IPC.sendNdiAudio,
      expect.objectContaining({ name: 'stage', sampleRate: 48000, channels: 2, samplesPerChannel: 2 }),
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});
