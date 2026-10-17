// @vitest-environment node
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { ChildProcessByStdio } from 'node:child_process';
import type { MessagePortMain, WebContents } from 'electron';
import { IPC_CHANNELS } from '../../../../apps/stream/main/ipc-channels';

vi.mock('electron', () => ({ MessageChannelMain: class {} }));

import {
  ApplicationAudioCapture,
  matchesApplicationAudioProcess,
  validateApplicationAudioProcessList,
  type ApplicationAudioProcess,
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

  it('matches both PID and normalized executable path', () => {
    const process: ApplicationAudioProcess = { pid: 1240, name: 'Music.exe', path: 'C:\\Apps\\Music.exe' };

    expect(matchesApplicationAudioProcess(process, 1240, 'c:/apps/music.exe')).toBe(true);
    expect(matchesApplicationAudioProcess(process, 1241, 'C:\\Apps\\Music.exe')).toBe(false);
    expect(matchesApplicationAudioProcess(process, 1240, 'C:\\Other\\Music.exe')).toBe(false);
    expect(matchesApplicationAudioProcess(process, 1240, 'Music.exe')).toBe(false);
  });

  it('uses the application-audio IPC channel and closes helper stdin when stopped', async () => {
    const children: FakeHelperChild[] = [];
    const spawnProcess = vi.fn((_executable: string, args: string[], _options?: unknown) => {
      const child = new FakeHelperChild();
      children.push(child);
      if (args[0] === 'list') {
        queueMicrotask(() => {
          child.stdout.end(JSON.stringify([{ pid: 1240, name: 'Music.exe', path: 'C:\\Apps\\Music.exe' }]));
          child.emit('close', 0, null);
        });
      }
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

    await capture.start('source-1', webContents, 1240, 'c:/apps/music.exe');

    expect(postMessage).toHaveBeenCalledWith(IPC_CHANNELS.applicationAudioFrame, 'source-1', [port2]);
    expect(spawnProcess.mock.calls[1]?.[2]).toMatchObject({ stdio: ['pipe', 'pipe', 'pipe'] });
    expect(spawnProcess.mock.calls[1]?.[1]).toEqual(['capture', '--pid', '1240', '--path', 'c:/apps/music.exe']);
    const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    children[1]?.stdout.emit('data', pcm);
    const forwarded = port1.postMessage.mock.calls[0]?.[0];
    expect(forwarded).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(forwarded as ArrayBuffer)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    capture.stop('source-1');
    expect(children[1]?.stdin.writableEnded).toBe(true);
    children[1]?.emit('exit', 0, null);
  });

  it('buffers arbitrary stdout chunk boundaries into complete stereo float frames', async () => {
    const children: FakeHelperChild[] = [];
    const spawnProcess = vi.fn((_executable: string, args: string[], _options?: unknown) => {
      const child = new FakeHelperChild();
      children.push(child);
      if (args[0] === 'list') {
        queueMicrotask(() => {
          child.stdout.end(JSON.stringify([{ pid: 1240, name: 'Music.exe', path: 'C:\\Apps\\Music.exe' }]));
          child.emit('close', 0, null);
        });
      }
      return child as unknown as ChildProcessByStdio<null, PassThrough, PassThrough>;
    });
    const port1 = new FakeMessagePort();
    const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, postMessage: vi.fn() }) as unknown as WebContents;
    const capture = new ApplicationAudioCapture('C:\\Tools\\audio-helper.exe', {
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
      createMessageChannel: () => ({ port1: port1 as unknown as MessagePortMain, port2: new FakeMessagePort() as unknown as MessagePortMain }),
    });

    await capture.start('source-1', webContents, 1240, 'C:\\Apps\\Music.exe');
    const stdout = children[1]!.stdout;
    stdout.emit('data', Buffer.from([1, 2, 3]));
    expect(port1.postMessage).not.toHaveBeenCalled();
    stdout.emit('data', Buffer.from([4, 5, 6, 7, 8, 9, 10]));

    expect(port1.postMessage).toHaveBeenCalledTimes(1);
    expect([...new Uint8Array(port1.postMessage.mock.calls[0]?.[0] as ArrayBuffer)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    capture.stop('source-1');
    children[1]?.emit('exit', 0, null);
  });

  it('reserves a source ID and stop during listing prevents capture launch', async () => {
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

    const pendingStart = capture.start('source-1', webContents, 1240, 'C:\\Apps\\Music.exe');
    await expect(capture.start('source-1', webContents, 1240, 'C:\\Apps\\Music.exe')).rejects.toThrow(/already active or starting/);
    capture.stop('source-1');
    children[0]!.stdout.end(JSON.stringify([{ pid: 1240, name: 'Music.exe', path: 'C:\\Apps\\Music.exe' }]));
    children[0]!.emit('close', 0, null);

    await expect(pendingStart).rejects.toThrow(/cancelled/);
    expect(spawnProcess).toHaveBeenCalledTimes(1);
  });

  it('reports an unexpected clean helper exit so the renderer can clear the runtime', async () => {
    const children: FakeHelperChild[] = [];
    const spawnProcess = vi.fn((_executable: string, args: string[], _options?: unknown) => {
      const child = new FakeHelperChild();
      children.push(child);
      if (args[0] === 'list') {
        queueMicrotask(() => {
          child.stdout.end(JSON.stringify([{ pid: 1240, name: 'Music.exe', path: 'C:\\Apps\\Music.exe' }]));
          child.emit('close', 0, null);
        });
      }
      return child as unknown as ChildProcessByStdio<null, PassThrough, PassThrough>;
    });
    const port1 = new FakeMessagePort();
    const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, postMessage: vi.fn() }) as unknown as WebContents;
    const capture = new ApplicationAudioCapture('C:\\Tools\\audio-helper.exe', {
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
      createMessageChannel: () => ({ port1: port1 as unknown as MessagePortMain, port2: new FakeMessagePort() as unknown as MessagePortMain }),
    });

    await capture.start('source-1', webContents, 1240, 'C:\\Apps\\Music.exe');
    children[1]!.emit('exit', 0, null);

    expect(port1.postMessage).toHaveBeenCalledWith({ error: 'The selected application audio process ended.' });
    capture.stop('source-1');
  });

  it('forwards a bounded helper diagnostic when capture is unsupported', async () => {
    const children: FakeHelperChild[] = [];
    const spawnProcess = vi.fn((_executable: string, args: string[], _options?: unknown) => {
      const child = new FakeHelperChild();
      children.push(child);
      if (args[0] === 'list') {
        queueMicrotask(() => {
          child.stdout.end(JSON.stringify([{ pid: 1240, name: 'Music.exe', path: 'C:\\Apps\\Music.exe' }]));
          child.emit('close', 0, null);
        });
      }
      return child as unknown as ChildProcessByStdio<null, PassThrough, PassThrough>;
    });
    const port1 = new FakeMessagePort();
    const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, postMessage: vi.fn() }) as unknown as WebContents;
    const capture = new ApplicationAudioCapture('C:\\Tools\\audio-helper.exe', {
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
      createMessageChannel: () => ({ port1: port1 as unknown as MessagePortMain, port2: new FakeMessagePort() as unknown as MessagePortMain }),
    });

    await capture.start('source-1', webContents, 1240, 'C:\\Apps\\Music.exe');
    children[1]!.stderr.emit('data', Buffer.from('Process audio capture requires Windows build 20348 or later.'));
    children[1]!.exitCode = 3;
    children[1]!.emit('exit', 3, null);

    expect(port1.postMessage).toHaveBeenCalledWith({ error: 'Process audio capture requires Windows build 20348 or later.' });
    capture.stop('source-1');
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
