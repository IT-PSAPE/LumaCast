// @vitest-environment node
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcessByStdio } from 'node:child_process';
import type { MessagePortMain, WebContents } from 'electron';
import { IPC_CHANNELS } from '../../../../apps/stream/main/ipc-channels';

vi.mock('electron', () => ({ MessageChannelMain: class {} }));

import {
  ApplicationAudioCapture,
  validateApplicationAudioProcessList,
} from '../../../../apps/stream/main/application-audio-capture';

describe('application audio process validation', () => {
  it('accepts a bounded list of absolute executable identities', () => {
    const processes = validateApplicationAudioProcessList([
      { pid: 1240, name: 'Music.exe', path: 'C:\\Apps\\Music.exe' },
      { pid: 1241, name: 'Browser.exe', path: 'C:\\Apps\\Browser.exe' },
    ]);

    expect(processes).toEqual([
      { pid: 1240, name: 'Music.exe', path: 'C:\\Apps\\Music.exe' },
      { pid: 1241, name: 'Browser.exe', path: 'C:\\Apps\\Browser.exe' },
    ]);
  });

  it('rejects malformed entries, duplicate PIDs, and non-absolute paths', () => {
    expect(() => validateApplicationAudioProcessList({})).toThrow(/invalid or oversized/);
    expect(() => validateApplicationAudioProcessList([{ pid: 0, name: 'Music.exe', path: 'C:\\Apps\\Music.exe' }])).toThrow(/invalid process entry/);
    expect(() => validateApplicationAudioProcessList([{ pid: 10, name: '', path: 'C:\\Apps\\Music.exe' }])).toThrow(/invalid process entry/);
    expect(() => validateApplicationAudioProcessList([{ pid: 10, name: 'Music.exe', path: 'Music.exe' }])).toThrow(/invalid process entry/);
    expect(() => validateApplicationAudioProcessList([
      { pid: 10, name: 'Music.exe', path: 'C:\\Apps\\Music.exe' },
      { pid: 10, name: 'Other.exe', path: 'C:\\Apps\\Other.exe' },
    ])).toThrow(/duplicate process IDs/);
  });

  it('rejects oversized process listings before traversing entries', () => {
    const oversized = new Proxy([], { get: (target, key, receiver) => key === 'length' ? 2049 : Reflect.get(target, key, receiver) });
    expect(() => validateApplicationAudioProcessList(oversized)).toThrow(/invalid or oversized/);
  });

  it('parses the filtered helper catalog without changing its PID, name, and path contract', async () => {
    const children: FakeHelperChild[] = [];
    const spawnProcess = vi.fn((_executable: string, _args: string[], _options?: unknown) => {
      const child = new FakeHelperChild();
      children.push(child);
      queueMicrotask(() => {
        child.stdout.end(JSON.stringify([{ pid: 1240, name: 'Music.exe', path: 'C:\\Apps\\Music.exe' }]));
        child.emit('close', 0, null);
      });
      return child as unknown as ChildProcessByStdio<null, PassThrough, PassThrough>;
    });
    const capture = new ApplicationAudioCapture('C:\\Tools\\audio-helper.exe', {
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
    });

    await expect(capture.list()).resolves.toEqual([
      { pid: 1240, name: 'Music.exe', path: 'C:\\Apps\\Music.exe' },
    ]);
    expect(spawnProcess.mock.calls[0]?.[1]).toEqual(['list']);
  });

  it('starts the selected PID and path without using the filtered catalog as authorization', async () => {
    const children: FakeHelperChild[] = [];
    const spawnProcess = vi.fn((_executable: string, _args: string[], _options?: unknown) => {
      const child = new FakeHelperChild();
      children.push(child);
      return child as unknown as ChildProcessByStdio<null, PassThrough, PassThrough>;
    });
    const port1 = new FakeMessagePort();
    const port2 = new FakeMessagePort();
    const postMessage = vi.fn();
    const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, postMessage }) as unknown as WebContents;
    const capture = new ApplicationAudioCapture('C:\\Tools\\audio-helper.exe', {
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
      createMessageChannel: () => ({ port1: port1 as unknown as MessagePortMain, port2: port2 as unknown as MessagePortMain }),
    });

    await capture.start('source-1', webContents, 1240, 'c:/apps/music.exe', 'test-epoch');

    expect(postMessage).toHaveBeenCalledWith(IPC_CHANNELS.applicationAudioFrame, { sourceId: 'source-1', epoch: 'test-epoch' }, [port2]);
    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(spawnProcess.mock.calls[0]?.[2]).toMatchObject({ stdio: ['pipe', 'pipe', 'pipe'] });
    expect(spawnProcess.mock.calls[0]?.[1]).toEqual(['capture', '--pid', '1240', '--path', 'c:/apps/music.exe']);
    const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    children[0]?.stdout.write(pcm);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const forwarded = (port1.postMessage.mock.calls[0]?.[0] as { buffer: ArrayBuffer }).buffer;
    expect(forwarded).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(forwarded as ArrayBuffer)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    capture.stop('source-1');
    expect(children[0]?.stdin.writableEnded).toBe(true);
    children[0]?.emit('exit', 0, null);
  });

  it('buffers arbitrary stdout chunk boundaries into complete stereo float frames', async () => {
    const children: FakeHelperChild[] = [];
    const spawnProcess = vi.fn((_executable: string, _args: string[], _options?: unknown) => {
      const child = new FakeHelperChild();
      children.push(child);
      return child as unknown as ChildProcessByStdio<null, PassThrough, PassThrough>;
    });
    const port1 = new FakeMessagePort();
    const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, postMessage: vi.fn() }) as unknown as WebContents;
    const capture = new ApplicationAudioCapture('C:\\Tools\\audio-helper.exe', {
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
      createMessageChannel: () => ({ port1: port1 as unknown as MessagePortMain, port2: new FakeMessagePort() as unknown as MessagePortMain }),
    });

    await capture.start('source-1', webContents, 1240, 'C:\\Apps\\Music.exe', 'test-epoch');
    const stdout = children[0]!.stdout;
    stdout.write(Buffer.from([1, 2, 3]));
    expect(port1.postMessage).not.toHaveBeenCalled();
    stdout.write(Buffer.from([4, 5, 6, 7, 8, 9, 10]));
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(port1.postMessage).toHaveBeenCalledTimes(1);
    expect([...new Uint8Array((port1.postMessage.mock.calls[0]?.[0] as { buffer: ArrayBuffer }).buffer)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    capture.stop('source-1');
    children[0]?.emit('exit', 0, null);
  });

  it('rejects malformed selected process identities before launching the helper', async () => {
    const children: FakeHelperChild[] = [];
    const spawnProcess = vi.fn((_executable: string, _args: string[], _options?: unknown) => {
      const child = new FakeHelperChild();
      children.push(child);
      return child as unknown as ChildProcessByStdio<null, PassThrough, PassThrough>;
    });
    const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, postMessage: vi.fn() }) as unknown as WebContents;
    const capture = new ApplicationAudioCapture('C:\\Tools\\audio-helper.exe', {
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
      createMessageChannel: () => ({ port1: new FakeMessagePort() as unknown as MessagePortMain, port2: new FakeMessagePort() as unknown as MessagePortMain }),
    });

    await expect(capture.start('source-1', webContents, 1240, 'Music.exe', 'test-epoch')).rejects.toThrow(/Invalid application-audio process identity/);
    await expect(capture.start('source-1', webContents, 0, 'C:\\Apps\\Music.exe', 'test-epoch')).rejects.toThrow(/Invalid application-audio process identity/);
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(children).toHaveLength(0);
  });

  it('rejects starting application audio twice for one source', async () => {
    const children: FakeHelperChild[] = [];
    const spawnProcess = vi.fn(() => {
      const child = new FakeHelperChild();
      children.push(child);
      return child as unknown as ChildProcessByStdio<null, PassThrough, PassThrough>;
    });
    const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, postMessage: vi.fn() }) as unknown as WebContents;
    const capture = new ApplicationAudioCapture('C:\\Tools\\audio-helper.exe', {
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
      createMessageChannel: () => ({ port1: new FakeMessagePort() as unknown as MessagePortMain, port2: new FakeMessagePort() as unknown as MessagePortMain }),
    });

    await capture.start('source-1', webContents, 1240, 'C:\\Apps\\Music.exe', 'test-epoch');
    await expect(capture.start('source-1', webContents, 1241, 'C:\\Apps\\Music.exe', 'test-epoch')).rejects.toThrow(/already active or starting/);
    expect(spawnProcess).toHaveBeenCalledTimes(1);

    capture.stop('source-1');
    children[0]?.emit('exit', 0, null);
  });

  it('reports an unexpected clean helper exit so the renderer can clear the runtime', async () => {
    const children: FakeHelperChild[] = [];
    const spawnProcess = vi.fn((_executable: string, _args: string[], _options?: unknown) => {
      const child = new FakeHelperChild();
      children.push(child);
      return child as unknown as ChildProcessByStdio<null, PassThrough, PassThrough>;
    });
    const port1 = new FakeMessagePort();
    const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, postMessage: vi.fn() }) as unknown as WebContents;
    const capture = new ApplicationAudioCapture('C:\\Tools\\audio-helper.exe', {
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
      createMessageChannel: () => ({ port1: port1 as unknown as MessagePortMain, port2: new FakeMessagePort() as unknown as MessagePortMain }),
    });

    await capture.start('source-1', webContents, 1240, 'C:\\Apps\\Music.exe', 'test-epoch');
    children[0]!.emit('exit', 0, null);

    expect(port1.postMessage).toHaveBeenCalledWith({ type: 'error', error: 'The selected application audio process ended.' });
    capture.stop('source-1');
  });

  it('forwards a bounded helper diagnostic when capture is unsupported', async () => {
    const children: FakeHelperChild[] = [];
    const spawnProcess = vi.fn((_executable: string, _args: string[], _options?: unknown) => {
      const child = new FakeHelperChild();
      children.push(child);
      return child as unknown as ChildProcessByStdio<null, PassThrough, PassThrough>;
    });
    const port1 = new FakeMessagePort();
    const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, postMessage: vi.fn() }) as unknown as WebContents;
    const capture = new ApplicationAudioCapture('C:\\Tools\\audio-helper.exe', {
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
      createMessageChannel: () => ({ port1: port1 as unknown as MessagePortMain, port2: new FakeMessagePort() as unknown as MessagePortMain }),
    });

    await capture.start('source-1', webContents, 1240, 'C:\\Apps\\Music.exe', 'test-epoch');
    children[0]!.stderr.emit('data', Buffer.from('Process audio capture requires Windows build 20348 or later.'));
    children[0]!.exitCode = 3;
    children[0]!.emit('exit', 3, null);

    expect(port1.postMessage).toHaveBeenCalledWith({ type: 'error', error: 'Process audio capture requires Windows build 20348 or later.' });
    capture.stop('source-1');
  });
});

describe('system audio capture', () => {
  it('spawns the helper with capture --system directly, with no process list lookup first', async () => {
    const children: FakeHelperChild[] = [];
    const spawnProcess = vi.fn((_executable: string, _args: string[], _options?: unknown) => {
      const child = new FakeHelperChild();
      children.push(child);
      return child as unknown as ChildProcessByStdio<null, PassThrough, PassThrough>;
    });
    const port1 = new FakeMessagePort();
    const port2 = new FakeMessagePort();
    const postMessage = vi.fn();
    const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, postMessage }) as unknown as WebContents;
    const capture = new ApplicationAudioCapture('/usr/local/bin/lumastream-audio-tap', {
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
      createMessageChannel: () => ({ port1: port1 as unknown as MessagePortMain, port2: port2 as unknown as MessagePortMain }),
    });

    await capture.startSystem('system-source', webContents, 'test-epoch');

    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(spawnProcess.mock.calls[0]?.[1]).toEqual(['capture', '--system']);
    expect(postMessage).toHaveBeenCalledWith(IPC_CHANNELS.applicationAudioFrame, { sourceId: 'system-source', epoch: 'test-epoch' }, [port2]);

    const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    children[0]?.stdout.write(pcm);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const forwarded = (port1.postMessage.mock.calls[0]?.[0] as { buffer: ArrayBuffer }).buffer;
    expect(forwarded).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(forwarded as ArrayBuffer)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    capture.stop('system-source');
    children[0]?.emit('exit', 0, null);
  });

  it('rejects starting system audio twice for the same source', async () => {
    const children: FakeHelperChild[] = [];
    const spawnProcess = vi.fn((_executable: string, _args: string[], _options?: unknown) => {
      const child = new FakeHelperChild();
      children.push(child);
      return child as unknown as ChildProcessByStdio<null, PassThrough, PassThrough>;
    });
    const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, postMessage: vi.fn() }) as unknown as WebContents;
    const capture = new ApplicationAudioCapture('/usr/local/bin/lumastream-audio-tap', {
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
      createMessageChannel: () => ({ port1: new FakeMessagePort() as unknown as MessagePortMain, port2: new FakeMessagePort() as unknown as MessagePortMain }),
    });

    await capture.startSystem('system-source', webContents, 'test-epoch');
    await expect(capture.startSystem('system-source', webContents, 'test-epoch')).rejects.toThrow('System audio is already active or starting for this source.');

    capture.stop('system-source');
    children[0]?.emit('exit', 0, null);
  });

  it('rejects an empty or oversized source ID', async () => {
    const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, postMessage: vi.fn() }) as unknown as WebContents;
    const capture = new ApplicationAudioCapture('/usr/local/bin/lumastream-audio-tap', {
      spawnProcess: vi.fn() as unknown as typeof import('node:child_process').spawn,
      createMessageChannel: () => ({ port1: new FakeMessagePort() as unknown as MessagePortMain, port2: new FakeMessagePort() as unknown as MessagePortMain }),
    });

    await expect(capture.startSystem('', webContents, 'test-epoch')).rejects.toThrow('Invalid system-audio source ID.');
    await expect(capture.startSystem('x'.repeat(257), webContents, 'test-epoch')).rejects.toThrow('Invalid system-audio source ID.');
  });

  it('ends the helper stdin when system audio capture is stopped', async () => {
    const children: FakeHelperChild[] = [];
    const spawnProcess = vi.fn((_executable: string, _args: string[], _options?: unknown) => {
      const child = new FakeHelperChild();
      children.push(child);
      return child as unknown as ChildProcessByStdio<null, PassThrough, PassThrough>;
    });
    const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, postMessage: vi.fn() }) as unknown as WebContents;
    const capture = new ApplicationAudioCapture('/usr/local/bin/lumastream-audio-tap', {
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
      createMessageChannel: () => ({ port1: new FakeMessagePort() as unknown as MessagePortMain, port2: new FakeMessagePort() as unknown as MessagePortMain }),
    });

    await capture.startSystem('system-source', webContents, 'test-epoch');
    capture.stop('system-source');

    expect(children[0]?.stdin.writableEnded).toBe(true);
    children[0]?.emit('exit', 0, null);
  });
});

class FakeHelperChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kill = vi.fn(() => true);
}

class FakeMessagePort extends EventEmitter {
  postMessage = vi.fn((_message?: unknown) => undefined);
  start = vi.fn();
  close = vi.fn(() => this.emit('close'));
}

describe('bounded application audio credits', () => {
  afterEach(() => vi.useRealTimers());
  async function setup() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const child = new FakeHelperChild();
    const port = new FakeMessagePort();
    const capture = new ApplicationAudioCapture('/audio-helper', {
      spawnProcess: vi.fn(() => child) as any,
      createMessageChannel: () => ({ port1: port as any, port2: new FakeMessagePort() as any }),
    });
    const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false, postMessage: vi.fn() }) as any;
    await capture.startSystem('source', contents, 'epoch');
    return { child, port, capture, feed(bytes: Buffer) { child.stdout.write(bytes); child.stdout.emit('readable'); },
      ack(sequence: number) { port.emit('message', { data: { type: 'consumed', sequence } }); } };
  }
  it('pulls only five packets without consumption and terminates once at the original deadline', async () => {
    const { child, port, feed, ack } = await setup();
    feed(Buffer.alloc(7680 * 20));
    expect(port.postMessage.mock.calls).toHaveLength(5);
    expect(child.stdout.readableLength).toBe(7680 * 15);
    await vi.advanceTimersByTimeAsync(100);
    ack(1);
    expect(port.postMessage.mock.calls).toHaveLength(6);
    expect(child.stdout.readableLength).toBe(7680 * 14);
    await vi.advanceTimersByTimeAsync(149);
    ack(1); // Duplicate credit cannot postpone packet 2's deadline.
    expect(port.postMessage.mock.calls).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(1);
    const terminal = port.postMessage.mock.calls.filter(([packet]) => (packet as any).type === 'error');
    expect(terminal).toHaveLength(1);
    expect(port.close).toHaveBeenCalledOnce();
    expect(child.stdin.writableEnded).toBe(true);
    ack(2); child.emit('exit', 1, null);
    expect(port.postMessage.mock.calls).toHaveLength(7);
  });
  it('preserves exact fragmented PCM and flushes a short complete frame within20ms', async () => {
    const { child, port, capture, feed, ack } = await setup();
    const expected = Buffer.from(Array.from({ length: 7680 + 8 }, (_, i) => i % 251));
    feed(expected.subarray(0, 3)); feed(expected.subarray(3, 7679));
    expect(port.postMessage).not.toHaveBeenCalled();
    feed(expected.subarray(7679));
    expect(port.postMessage.mock.calls).toHaveLength(1);
    ack(1);
    await vi.advanceTimersByTimeAsync(20);
    const packets = port.postMessage.mock.calls.map(([packet]) => Buffer.from((packet as any).buffer));
    expect(Buffer.concat(packets)).toEqual(expected);
    ack(2); await vi.advanceTimersByTimeAsync(500);
    expect(port.close).not.toHaveBeenCalled();
    capture.stop('source'); child.emit('exit', 0, null);
  });
  it('does not accept an expired receipt merely because the main timer callback was delayed', async () => {
    const { child, port, feed, ack } = await setup();
    feed(Buffer.alloc(7680));
    const now = performance.now();
    vi.spyOn(performance, 'now').mockReturnValue(now + 251);
    ack(1);
    expect(port.postMessage.mock.calls.filter(([packet]) => (packet as any).type === 'error')).toHaveLength(1);
    expect(port.close).toHaveBeenCalledOnce();
    child.emit('exit', 0, null);
    vi.restoreAllMocks();
  });
  it.each([{}, { type: 'consumed', sequence: 2 }, { type: 'consumed', sequence: NaN }, { type: 'failed' }])
  ('invalid/failing controls never grant credit', async (data) => {
    const { child, port, feed } = await setup();
    feed(Buffer.alloc(7680 * 6));
    port.emit('message', { data });
    expect(port.postMessage.mock.calls.filter(([packet]) => (packet as any).type === 'pcm')).toHaveLength(5);
    expect(port.close).toHaveBeenCalledOnce();
    child.emit('exit', 0, null);
  });
});
