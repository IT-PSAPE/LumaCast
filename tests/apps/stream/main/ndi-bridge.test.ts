// @vitest-environment node
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent, UtilityProcess, WebContents } from 'electron';
import { IPC_CHANNELS } from '../../../../apps/stream/main/ipc-channels';
import { registerNdiIpc, type NdiIpcOptions } from '../../../../apps/stream/main/ndi-bridge';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  utilityProcess: { fork: vi.fn() },
}));

type IpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

class FakeUtilityProcess extends EventEmitter {
  messages: Array<Record<string, unknown>> = [];
  killed = false;
  hanging = false;
  holdStop = false;
  heldRead: Record<string, unknown> | null = null;
  heldStop: Record<string, unknown> | null = null;
  errorOnType: string | null = null;
  frameToReturn: unknown = { kind: 'video', width: 2, height: 2, stride: 8, frameRateN: 30, frameRateD: 1, data: new Uint8Array(16) };
  sources = [{ name: 'Camera A', urlAddress: 'ndi://camera-a' }];

  postMessage(raw: unknown): void {
    const message = raw as Record<string, unknown>;
    this.messages.push(message);
    if (this.hanging) return;
    if (message.type === 'readFrame' && this.heldRead) {
      this.heldRead = message;
      return;
    }
    if (message.type === 'stopReceive' && this.holdStop) {
      this.heldStop = message;
      return;
    }
    this.reply(message);
  }

  reply(message: Record<string, unknown>): void {
    if (this.errorOnType === message.type) {
      this.errorOnType = null;
      queueMicrotask(() => this.emit('message', { requestId: message.requestId, ok: false, error: 'native teardown failed' }));
      return;
    }
    let value: unknown;
    switch (message.type) {
      case 'discover':
        value = this.sources;
        break;
      case 'startReceive':
        value = `native-receiver-${this.messages.filter((item) => item.type === 'startReceive').length}`;
        break;
      case 'readFrame':
        value = this.frameToReturn;
        break;
      case 'startSend':
        value = (message.settings as { senderName: string }).senderName;
        break;
      default:
        value = undefined;
    }
    queueMicrotask(() => this.emit('message', { requestId: message.requestId, ok: true, value }));
  }

  fail(): void {
    this.emit('exit', 1);
  }

  failWithError(): void {
    this.emit('error', new Error('utility process error'));
  }

  kill(): boolean {
    this.killed = true;
    queueMicrotask(() => this.emit('exit', 0));
    return true;
  }
}

function harness(options: Partial<NdiIpcOptions> = {}) {
  const handlers = new Map<string, IpcHandler>();
  const ipc = {
    handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
    removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
  } as unknown as NdiIpcOptions['ipc'];
  const contents = { mainFrame: { url: 'file:///app/out/renderer/index.html' } } as unknown as WebContents;
  const trustedEvent = { sender: contents, senderFrame: contents.mainFrame } as IpcMainInvokeEvent;
  const untrustedEvent = { sender: contents, senderFrame: { url: 'https://attacker.invalid/' } } as unknown as IpcMainInvokeEvent;
  const utility = new FakeUtilityProcess();
  const utilities = [utility];
  let forkCount = 0;
  const fork = vi.fn(() => {
    forkCount += 1;
    if (forkCount === 1) return utility as unknown as UtilityProcess;
    const replacement = new FakeUtilityProcess();
    utilities.push(replacement);
    return replacement as unknown as UtilityProcess;
  }) as unknown as NdiIpcOptions['fork'];
  const registration = registerNdiIpc(
    () => contents,
    (url) => url.startsWith('file:///app/out/renderer/'),
    '/app/out/main/ndi-host.js',
    { ipc, fork, ...options },
  );
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!(trustedEvent, ...args);
  return { handlers, contents, trustedEvent, untrustedEvent, utility, utilities, fork, registration, invoke };
}

describe('NDI utility bridge', () => {
  it('authorizes only the trusted main frame before starting the isolated host', async () => {
    const h = harness();
    const discover = h.handlers.get(IPC_CHANNELS.ndiDiscover)!;

    expect(() => discover(h.untrustedEvent)).toThrow('Untrusted renderer invocation');
    expect(h.fork).not.toHaveBeenCalled();
    await expect(discover(h.trustedEvent)).resolves.toEqual([{ name: 'Camera A', urlAddress: 'ndi://camera-a' }]);
    expect(h.fork).toHaveBeenCalledWith('/app/out/main/ndi-host.js', [], expect.objectContaining({ serviceName: 'lumastream-ndi' }));
    await h.registration.close();
  });

  it('uses opaque session IDs, forwards receiver frames and sends validated RGBA/audio to native', async () => {
    const h = harness();
    const receiverId = await h.invoke(IPC_CHANNELS.ndiStartReceive, { name: 'Camera A', urlAddress: 'ndi://camera-a' }) as string;
    expect(receiverId).not.toBe('native-receiver-1');

    const frame = await h.invoke(IPC_CHANNELS.ndiReadFrame, receiverId);
    expect(frame).toMatchObject({ kind: 'video', width: 2, height: 2, stride: 8 });
    expect(h.utility.messages.find((message) => message.type === 'startReceive')).toMatchObject({
      source: { name: 'Camera A' }, includeAudio: true,
    });
    expect(h.utility.messages.find((message) => message.type === 'readFrame')).toMatchObject({
      receiverId: 'native-receiver-1',
    });
    await h.invoke(IPC_CHANNELS.ndiStopReceive, receiverId);
    expect(h.utility.messages.find((message) => message.type === 'stopReceive')).toMatchObject({ receiverId: 'native-receiver-1' });
    const silentReceiverId = await h.invoke(IPC_CHANNELS.ndiStartReceive, { name: 'Camera A' }, false) as string;
    expect(h.utility.messages.find((message) => message.type === 'startReceive' && message.includeAudio === false)).toMatchObject({ includeAudio: false });
    await h.invoke(IPC_CHANNELS.ndiStopReceive, silentReceiverId);

    const senderId = await h.invoke(IPC_CHANNELS.ndiStartSend, {
      senderName: 'LumaStream Program',
      width: 2,
      height: 2,
      frameRateN: 30,
      frameRateD: 1,
    }) as string;
    expect(senderId).not.toBe('LumaStream Program');
    const rgba = new Uint8Array(16);
    await h.invoke(IPC_CHANNELS.ndiSendVideo, senderId, { width: 2, height: 2, data: rgba });
    await h.invoke(IPC_CHANNELS.ndiSendAudio, senderId, {
      data: new Float32Array([0, 0.25, -0.25, 0]),
      sampleRate: 48000,
      channels: 2,
      samplesPerChannel: 2,
    });
    await h.invoke(IPC_CHANNELS.ndiStopSend, senderId);

    expect(h.utility.messages.find((message) => message.type === 'startSend')).toMatchObject({
      settings: { senderName: 'LumaStream Program', frameRateN: 30, frameRateD: 1 },
    });
    expect(h.utility.messages.find((message) => message.type === 'sendVideo')).toMatchObject({ width: 2, height: 2, data: rgba });
    expect(h.utility.messages.find((message) => message.type === 'sendAudio')).toMatchObject({ sampleRate: 48000, channels: 2, samplesPerChannel: 2 });
    await h.registration.close();
  });

  it('bounds sender dimensions and prevents concurrent reads from one receiver', async () => {
    const h = harness();
    await expect(h.invoke(IPC_CHANNELS.ndiStartReceive, { name: 'Camera A' }, 'false')).rejects.toThrow(/must be a boolean/);
    await expect(h.invoke(IPC_CHANNELS.ndiStartSend, {
      senderName: 'Oversized', width: 1921, height: 1080, frameRateN: 30, frameRateD: 1,
    })).rejects.toThrow(/1920×1080/);
    expect(h.fork).not.toHaveBeenCalled();

    const receiverId = await h.invoke(IPC_CHANNELS.ndiStartReceive, { name: 'Camera A' }) as string;
    h.utility.heldRead = {};
    const firstRead = h.invoke(IPC_CHANNELS.ndiReadFrame, receiverId) as Promise<unknown>;
    await Promise.resolve();
    await expect(h.invoke(IPC_CHANNELS.ndiReadFrame, receiverId)).rejects.toThrow(/already in progress/);
    const request = h.utility.messages.find((message) => message.type === 'readFrame')!;
    h.utility.reply(request);
    await expect(firstRead).resolves.toMatchObject({ kind: 'video' });
    await h.registration.close();
  });

  it('prevents another read while a receiver is being stopped', async () => {
    const h = harness();
    const receiverId = await h.invoke(IPC_CHANNELS.ndiStartReceive, { name: 'Camera A' }) as string;
    h.utility.heldRead = {};
    const read = h.invoke(IPC_CHANNELS.ndiReadFrame, receiverId) as Promise<unknown>;
    await Promise.resolve();

    h.utility.holdStop = true;
    const stop = h.invoke(IPC_CHANNELS.ndiStopReceive, receiverId) as Promise<void>;
    await Promise.resolve();
    const readRequest = h.utility.messages.find((message) => message.type === 'readFrame')!;
    h.utility.reply(readRequest);
    await expect(read).resolves.toMatchObject({ kind: 'video' });

    await expect(h.invoke(IPC_CHANNELS.ndiReadFrame, receiverId)).rejects.toThrow(/receiver is stopping/);
    expect(h.utility.messages.filter((message) => message.type === 'readFrame')).toHaveLength(1);

    h.utility.holdStop = false;
    h.utility.reply(h.utility.heldStop!);
    await expect(stop).resolves.toBeUndefined();
    await h.registration.close();
  });

  it('accepts native receive limits beyond the sender limits and rejects frames above them', async () => {
    const h = harness();
    const receiverId = await h.invoke(IPC_CHANNELS.ndiStartReceive, { name: 'Camera A' }) as string;
    const pixels = 3840 * 2160;
    h.utility.frameToReturn = {
      kind: 'video', width: 3840, height: 2160, stride: 3840 * 4,
      frameRateN: 30, frameRateD: 1, data: new Uint8Array(pixels * 4),
    };
    await expect(h.invoke(IPC_CHANNELS.ndiReadFrame, receiverId)).resolves.toMatchObject({ width: 3840, height: 2160 });

    h.utility.frameToReturn = {
      kind: 'video', width: 4096, height: 2160, stride: 4096 * 4,
      frameRateN: 30, frameRateD: 1, data: new Uint8Array(16),
    };
    await expect(h.invoke(IPC_CHANNELS.ndiReadFrame, receiverId)).rejects.toThrow(/invalid video frame/);

    h.utility.frameToReturn = {
      kind: 'audio', sampleRate: 96000, channels: 10, samplesPerChannel: 10,
      channelStrideBytes: 40, data: new Float32Array(100),
    };
    await expect(h.invoke(IPC_CHANNELS.ndiReadFrame, receiverId)).resolves.toMatchObject({ kind: 'audio', channels: 10 });

    h.utility.frameToReturn = {
      kind: 'audio', sampleRate: 48000, channels: 17, samplesPerChannel: 1,
      channelStrideBytes: 4, data: new Float32Array(17),
    };
    await expect(h.invoke(IPC_CHANNELS.ndiReadFrame, receiverId)).resolves.toBeNull();
    h.utility.frameToReturn = { kind: 'video', width: 2, height: 2, stride: 8, frameRateN: 30, frameRateD: 1, data: new Uint8Array(16) };
    await expect(h.invoke(IPC_CHANNELS.ndiReadFrame, receiverId)).resolves.toMatchObject({ kind: 'video' });
    await h.registration.close();
  });

  it('bounds concurrent full-size video IPC payloads and releases capacity on replies', async () => {
    const h = harness();
    const senderId = await h.invoke(IPC_CHANNELS.ndiStartSend, {
      senderName: 'LumaStream Program', width: 1920, height: 1080, frameRateN: 30, frameRateD: 1,
    }) as string;
    h.utility.hanging = true;
    const frame = { width: 1920, height: 1080, data: new Uint8Array(1920 * 1080 * 4) };
    const first = h.invoke(IPC_CHANNELS.ndiSendVideo, senderId, frame) as Promise<void>;
    const second = h.invoke(IPC_CHANNELS.ndiSendVideo, senderId, frame) as Promise<void>;
    await Promise.resolve();
    await expect(h.invoke(IPC_CHANNELS.ndiSendVideo, senderId, frame)).rejects.toThrow(/video sender is busy/);

    const firstRequest = h.utility.messages.find((message) => message.type === 'sendVideo')!;
    h.utility.reply(firstRequest);
    await expect(first).resolves.toBeUndefined();
    const third = h.invoke(IPC_CHANNELS.ndiSendVideo, senderId, frame) as Promise<void>;
    await Promise.resolve();
    const outstanding = h.utility.messages.filter((message) => message.type === 'sendVideo').slice(1);
    for (const request of outstanding) h.utility.reply(request);
    await expect(Promise.all([second, third])).resolves.toEqual([undefined, undefined]);
    h.utility.hanging = false;
    await h.registration.close();
  });

  it('invalidates sessions and kills a host that misses its request deadline', async () => {
    const h = harness({ requestTimeoutMs: 10 });
    h.utility.hanging = true;

    await expect(h.invoke(IPC_CHANNELS.ndiDiscover)).rejects.toThrow(/did not respond in time/);
    expect(h.utility.killed).toBe(true);
    await h.registration.close();
  });

  it('rejects pending work and kills a utility process that emits an error', async () => {
    const h = harness();
    h.utility.hanging = true;
    const discover = h.invoke(IPC_CHANNELS.ndiDiscover) as Promise<unknown>;
    await Promise.resolve();

    h.utility.failWithError();
    await expect(discover).rejects.toThrow(/utility process error/);
    expect(h.utility.killed).toBe(true);
    await h.registration.close();
  });

  it('kills an uncertain native sender and lets the next sender start in a fresh host', async () => {
    const h = harness();
    const receiverId = await h.invoke(IPC_CHANNELS.ndiStartReceive, { name: 'Camera A' }) as string;
    const settings = { senderName: 'Program', width: 2, height: 2, frameRateN: 30, frameRateD: 1 };
    const senderId = await h.invoke(IPC_CHANNELS.ndiStartSend, settings) as string;
    h.utility.errorOnType = 'stopSend';

    await expect(h.invoke(IPC_CHANNELS.ndiStopSend, senderId)).rejects.toThrow(/native teardown failed/);
    expect(h.utility.killed).toBe(true);
    await expect(h.invoke(IPC_CHANNELS.ndiSendVideo, senderId, { width: 2, height: 2, data: new Uint8Array(16) })).rejects.toThrow(/session was not found/);
    await expect(h.invoke(IPC_CHANNELS.ndiReadFrame, receiverId)).rejects.toThrow(/session was not found/);

    const restartedId = await h.invoke(IPC_CHANNELS.ndiStartSend, settings) as string;
    expect(restartedId).not.toBe(senderId);
    expect(h.fork).toHaveBeenCalledTimes(2);
    expect(h.utilities[1].messages.find((message) => message.type === 'startSend')).toMatchObject({ settings });
    await h.registration.close();
  });

  it('removes every NDI IPC handler when unregistered', async () => {
    const h = harness();
    h.registration.unregister();
    h.registration.unregister();
    expect(h.handlers.size).toBe(0);
    await expect(h.registration.close()).resolves.toBeUndefined();
  });
});
