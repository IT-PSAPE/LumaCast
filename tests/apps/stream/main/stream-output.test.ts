// @vitest-environment node
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import type { ChildProcessByStdio } from 'node:child_process';
import type { WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { StreamOutputSettings, StreamRuntimeStatus } from '../../../../apps/stream/shared/desktop-api';

vi.mock('../../../../apps/stream/main/media-engine-path', () => ({ bundledMediaEnginePath: () => 'ffmpeg' }));

import { StreamOutput } from '../../../../apps/stream/main/stream-output';

const settings: StreamOutputSettings = {
  width: 1920,
  height: 1080,
  frameRate: 30,
  videoBitrateKbps: 6000,
  audioBitrateKbps: 160,
  rateControl: 'cbr',
  encoder: 'h264_mf',
  encoderQuality: 60,
  hardwareEncoding: false,
  keyframeIntervalSeconds: 2,
};

class FakeOutputProcess extends EventEmitter {
  readonly writtenChunks: Buffer[] = [];
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly stderr = new PassThrough();
  readonly stdin = new Writable({
    write: (chunk, _encoding, callback) => {
      this.writtenChunks.push(Buffer.from(chunk));
      callback();
    },
    final: (callback) => {
      this.exitCode = 0;
      queueMicrotask(() => this.emit('close', 0, null));
      callback();
    },
  });

  kill = vi.fn(() => {
    this.signalCode = 'SIGTERM';
    queueMicrotask(() => this.emit('close', null, 'SIGTERM'));
    return true;
  });

  fail(code = 1): void {
    this.exitCode = code;
    this.emit('close', code, null);
  }
}

function harness(maxRetries = 2, maxRecoveryBufferBytes = 1024 * 1024, retryDelayMs = 0) {
  const children: FakeOutputProcess[] = [];
  const statuses: StreamRuntimeStatus[] = [];
  const contents = { isDestroyed: () => false, send: (_channel: string, status: StreamRuntimeStatus) => statuses.push(status) };
  const spawnProcess = vi.fn(() => {
    const child = new FakeOutputProcess();
    children.push(child);
    return child as unknown as ChildProcessByStdio<Writable, null, PassThrough>;
  });
  const output = new StreamOutput(
    () => contents as unknown as WebContents,
    spawnProcess as unknown as typeof import('node:child_process').spawn,
    { maxRetries, retryDelayMs, maxRecoveryBufferBytes },
  );
  const id = output.start('rtmps://example.com/live/key', settings);
  return { output, id, children, statuses, spawnProcess };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Timed out waiting for the stream output state.');
}

function chunk(value: string): ArrayBuffer {
  return Uint8Array.from(Buffer.from(value)).buffer;
}

describe('Stream RTMP output reconnect', () => {
  it('restarts after a transient exit and re-feeds the WebM header and buffered media', async () => {
    const { output, id, children } = harness();
    await output.write(id, chunk('webm-header'));
    await output.write(id, chunk('media-before-drop'));
    children[0]!.fail();
    await output.write(id, chunk('media-during-reconnect'));
    await waitFor(() => children.length === 2 && children[1]!.writtenChunks.length === 2);

    expect(children[1]!.writtenChunks.map((part) => part.toString())).toEqual([
      'webm-header',
      'media-during-reconnect',
    ]);
    await output.stop(id);
  });

  it('surfaces an error after the bounded retry budget is exhausted', async () => {
    const { output, id, children, statuses } = harness(2);
    await output.write(id, chunk('webm-header'));
    children[0]!.fail();
    await waitFor(() => children.length === 2);
    children[1]!.fail();
    await waitFor(() => children.length === 3);
    children[2]!.fail();
    await waitFor(() => statuses.some((status) => status.state === 'error'));

    expect(children).toHaveLength(3);
    expect(statuses.at(-1)).toMatchObject({ state: 'error' });
    await expect(output.write(id, chunk('late media'))).rejects.toThrow('could not reconnect');
    await output.stop(id);
  });

  it('stops cleanly without retrying after a user-requested stop', async () => {
    const { output, id, children, statuses, spawnProcess } = harness();
    await output.write(id, chunk('webm-header'));
    await output.stop(id);

    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toMatchObject({ state: 'stopped' });
    expect(statuses.some((status) => status.state === 'error')).toBe(false);
    expect(children).toHaveLength(1);
  });

  it('terminates the encoder when the bounded recovery buffer fills', async () => {
    const { output, id, children, statuses } = harness(2, 4, 10_000);
    await output.write(id, chunk('h'));
    children[0]!.emit('error', new Error('transient encoder error'));

    await expect(output.write(id, chunk('media'))).rejects.toThrow('media buffer filled');

    expect(children[0]!.kill).toHaveBeenCalledOnce();
    expect(statuses.at(-1)).toMatchObject({ state: 'error' });
    await output.stop(id);
  });
});
