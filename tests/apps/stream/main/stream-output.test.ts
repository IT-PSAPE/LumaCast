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

function harness(maxRetries = 2, maxRecoveryBufferBytes = 1024 * 1024, retryDelayMs = 0, destination = 'rtmps://example.com/live/key', outputSettings = settings) {
  const children: FakeOutputProcess[] = [];
  const argumentsList: string[][] = [];
  const statuses: StreamRuntimeStatus[] = [];
  const contents = { isDestroyed: () => false, send: (_channel: string, status: StreamRuntimeStatus) => statuses.push(status) };
  const spawnProcess = vi.fn((_executable: string, args: string[]) => {
    argumentsList.push(args);
    const child = new FakeOutputProcess();
    children.push(child);
    return child as unknown as ChildProcessByStdio<Writable, null, PassThrough>;
  });
  const output = new StreamOutput(
    () => contents as unknown as WebContents,
    spawnProcess as unknown as typeof import('node:child_process').spawn,
    { maxRetries, retryDelayMs, maxRecoveryBufferBytes },
  );
  const id = output.start(destination, outputSettings);
  return { output, id, children, statuses, spawnProcess, argumentsList };
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

describe('Stream output destination and reconnect', () => {
  it.each([1, 59.94, 240])('accepts %s FPS and passes the configured frame rate to FFmpeg', (frameRate) => {
    const { argumentsList } = harness(2, 1024 * 1024, 0, 'rtmps://example.com/live/key', { ...settings, frameRate });
    expect(argumentsList[0]?.slice(argumentsList[0]!.indexOf('-r'), argumentsList[0]!.indexOf('-r') + 2)).toEqual(['-r', String(frameRate)]);
  });

  it.each([0, 0.99, 240.01, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid stream frame rates (%s)', (frameRate) => {
    expect(() => harness(2, 1024 * 1024, 0, 'rtmps://example.com/live/key', { ...settings, frameRate })).toThrow(/outside the supported range/);
  });

  it('keeps RTMP output on FLV', () => {
    const { argumentsList } = harness();

    expect(argumentsList[0]?.slice(-2)).toEqual(['flv', 'rtmps://example.com/live/key']);
  });

  it('accepts SRT host and port with FFmpeg query options and selects MPEG-TS', () => {
    const { argumentsList } = harness(2, 1024 * 1024, 0, 'srt://stream.example:9000?mode=caller&latency=120000');

    expect(argumentsList[0]?.slice(-2)).toEqual(['mpegts', 'srt://stream.example:9000?mode=caller&latency=120000']);
  });

  it('accepts RIST host and port with FFmpeg query options and selects MPEG-TS', () => {
    const { argumentsList } = harness(2, 1024 * 1024, 0, 'rist://stream.example:9001?buffer_size=2000&fifo_size=1024');

    expect(argumentsList[0]?.slice(-2)).toEqual(['mpegts', 'rist://stream.example:9001?buffer_size=2000&fifo_size=1024']);
  });

  it.each([
    ['missing a port', 'srt://stream.example'],
    ['missing a host', 'srt://:9000'],
    ['using an out-of-range port', 'srt://stream.example:65536'],
    ['containing a path', 'srt://stream.example:9000/channel'],
    ['containing user information', 'srt://user:secret@stream.example:9000'],
    ['containing a fragment', 'srt://stream.example:9000#channel'],
  ])('rejects SRT URLs %s', (_reason, destination) => {
    expect(() => harness(2, 1024 * 1024, 0, destination)).toThrow();
  });

  it.each([
    ['missing a port', 'rist://stream.example'],
    ['missing a host', 'rist://:9001'],
    ['using an out-of-range port', 'rist://stream.example:65536'],
    ['containing a path', 'rist://stream.example:9001/channel'],
    ['containing user information', 'rist://user:secret@stream.example:9001'],
    ['containing a fragment', 'rist://stream.example:9001#channel'],
  ])('rejects RIST URLs %s', (_reason, destination) => {
    expect(() => harness(2, 1024 * 1024, 0, destination)).toThrow();
  });

  it('continues to reject query options and fragments on RTMP destinations', () => {
    expect(() => harness(2, 1024 * 1024, 0, 'rtmp://stream.example/live/key?token=secret')).toThrow();
    expect(() => harness(2, 1024 * 1024, 0, 'rtmp://stream.example/live/key#channel')).toThrow();
    expect(() => harness(2, 1024 * 1024, 0, 'rtmp://user:secret@stream.example/live/key')).toThrow();
  });

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
