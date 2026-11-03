// @vitest-environment node
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import type { ChildProcessByStdio } from 'node:child_process';
import type { WebContents } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  failNextWrite = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly stderr = new PassThrough();
  readonly stdin = new Writable({
    write: (chunk, _encoding, callback) => {
      if (this.failNextWrite) {
        this.failNextWrite = false;
        const error = Object.assign(new Error('write EOF'), { code: 'EPIPE' });
        queueMicrotask(() => callback(error));
        return;
      }
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

function harness(
  maxRetries = 2,
  maxRecoveryBufferBytes = 1024 * 1024,
  retryDelayMs = 0,
  destination = 'rtmps://example.com/live/key',
  outputSettings = settings,
  startupTimeoutMs = 30_000,
  outputId = 'primary',
  statusMode: 'transport' | 'external' = 'transport',
) {
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
    { maxRetries, retryDelayMs, maxRecoveryBufferBytes, startupTimeoutMs },
  );
  const id = output.start(destination, outputSettings, outputId, statusMode);
  return { output, id, children, statuses, spawnProcess, argumentsList };
}

afterEach(() => vi.useRealTimers());

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

  it('handles an asynchronous stdin EPIPE event and reconnects without an uncaught error', async () => {
    const { output, id, children } = harness();
    children[0]!.failNextWrite = true;

    await expect(output.write(id, chunk('webm-header'))).resolves.toBeUndefined();
    await waitFor(() => children.length === 2 && children[1]!.writtenChunks.length === 1);

    expect(children[1]!.writtenChunks[0]?.toString()).toBe('webm-header');
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

  it('fails startup after the deadline when no media reaches the encoder', async () => {
    vi.useFakeTimers();
    const { output, id, children, statuses } = harness(2, 1024 * 1024, 0, undefined, settings, 100);

    await vi.advanceTimersByTimeAsync(100);

    expect(children[0]!.kill).toHaveBeenCalledOnce();
    expect(statuses.at(-1)).toMatchObject({
      state: 'error',
      message: 'No media reached the streaming encoder. Check the program output and try again.',
    });
    await output.stop(id);
  });

  it('reports a separate startup error when media arrives but FFmpeg never reports progress', async () => {
    vi.useFakeTimers();
    const { output, id, children, statuses } = harness(2, 1024 * 1024, 0, undefined, settings, 100);
    await output.write(id, chunk('webm-header'));

    await vi.advanceTimersByTimeAsync(100);

    expect(children[0]!.kill).toHaveBeenCalledOnce();
    expect(statuses.at(-1)).toMatchObject({
      state: 'error',
      message: 'The streaming encoder did not start sending data. Check the server and output settings, then try again.',
    });
    await output.stop(id);
  });

  it('ignores late FFmpeg progress after the startup deadline has failed the session', async () => {
    vi.useFakeTimers();
    const { output, id, children, statuses } = harness(2, 1024 * 1024, 0, undefined, settings, 100);
    await output.write(id, chunk('webm-header'));

    await vi.advanceTimersByTimeAsync(100);
    const statusCountAfterFailure = statuses.length;
    children[0]!.stderr.write('bitrate=1000kbits/s\nprogress=continue\n');

    expect(statuses).toHaveLength(statusCountAfterFailure);
    expect(statuses.at(-1)).toMatchObject({ state: 'error' });
    expect(statuses.some((status) => status.state === 'live')).toBe(false);
    await output.stop(id);
  });

  it('clears the startup deadline on the first FFmpeg progress record', async () => {
    vi.useFakeTimers();
    const { output, id, children, statuses } = harness(2, 1024 * 1024, 0, undefined, settings, 100);
    await output.write(id, chunk('webm-header'));
    children[0]!.stderr.write('bitrate=1000kbits/s\nprogress=continue\n');

    await vi.advanceTimersByTimeAsync(100);

    expect(statuses.some((status) => status.state === 'error')).toBe(false);
    expect(children[0]!.kill).not.toHaveBeenCalled();
    await output.stop(id);
  });

  it('clears startup timeout on progress in external mode without bypassing provider status gating', async () => {
    vi.useFakeTimers();
    const { output, id, children, statuses } = harness(2, 1024 * 1024, 0, undefined, settings, 100, 'youtube', 'external');
    await output.write(id, chunk('webm-header'));
    children[0]!.stderr.write('progress=continue\n');

    await vi.advanceTimersByTimeAsync(100);

    expect(statuses.some((status) => status.state === 'error')).toBe(false);
    expect(statuses.some((status) => status.state === 'live')).toBe(false);
    output.reportStatus(id, { state: 'live' });
    expect(statuses.at(-1)).toMatchObject({ outputId: 'youtube', state: 'live' });
    await output.stop(id);
  });

  it('does not reset the startup deadline when reconnect retries start new children', async () => {
    vi.useFakeTimers();
    const { output, id, children, statuses } = harness(5, 1024 * 1024, 30, undefined, settings, 50);
    await output.write(id, chunk('webm-header'));
    children[0]!.fail();

    await vi.advanceTimersByTimeAsync(30);
    expect(children).toHaveLength(2);
    // A late progress record from the failed child must not cancel this session's deadline.
    children[0]!.stderr.write('progress=continue\n');
    await vi.advanceTimersByTimeAsync(20);

    expect(children).toHaveLength(2);
    expect(children[1]!.kill).toHaveBeenCalledOnce();
    expect(statuses.at(-1)).toMatchObject({
      state: 'error',
      message: 'The streaming encoder did not start sending data. Check the server and output settings, then try again.',
    });
    await output.stop(id);
  });

  it('clears startup deadlines on stop, stopAll, and provider-reported failure', async () => {
    vi.useFakeTimers();
    const stopped = harness(2, 1024 * 1024, 0, undefined, settings, 100);
    await stopped.output.stop(stopped.id);
    const allStopped = harness(2, 1024 * 1024, 0, undefined, settings, 100, 'zoom');
    await allStopped.output.stopAll();
    const providerFailed = harness(2, 1024 * 1024, 0, undefined, settings, 100, 'youtube', 'external');
    providerFailed.output.reportStatus(providerFailed.id, { state: 'error', message: 'YouTube did not detect an incoming video stream.' });

    await vi.advanceTimersByTimeAsync(100);

    expect(stopped.statuses.some((status) => status.state === 'error')).toBe(false);
    expect(allStopped.statuses.some((status) => status.state === 'error')).toBe(false);
    expect(providerFailed.statuses.filter((status) => status.state === 'error')).toHaveLength(1);
    await providerFailed.output.stop(providerFailed.id);
  });

  it('keeps destination sessions independent and includes their output IDs in status', async () => {
    const { output, id: youtubeId, children, statuses } = harness();
    const zoomId = output.start('rtmps://example.com/zoom/key', settings, 'zoom');

    expect(children).toHaveLength(2);
    expect(statuses[0]).toMatchObject({ outputId: 'primary', state: 'connecting' });
    expect(statuses[1]).toMatchObject({ outputId: 'zoom', state: 'connecting' });
    await output.write(youtubeId, chunk('youtube-header'));
    await output.write(zoomId, chunk('zoom-header'));

    await output.stop(youtubeId);
    await output.write(zoomId, chunk('zoom-still-live'));
    expect(children[0]!.writtenChunks.map((part) => part.toString())).toEqual(['youtube-header']);
    expect(children[1]!.writtenChunks.map((part) => part.toString())).toEqual(['zoom-header', 'zoom-still-live']);
    expect(statuses.at(-1)).toMatchObject({ outputId: 'primary', state: 'stopped' });

    await output.stopAll();
    expect(statuses.at(-1)).toMatchObject({ outputId: 'zoom', state: 'stopped' });
  });

  it('rejects duplicate active output identifiers and malformed output identifiers', () => {
    const { output } = harness();
    expect(() => output.start('rtmps://example.com/another/key', settings, 'primary')).toThrow(/already active/);
    expect(() => output.start('rtmps://example.com/another/key', settings, '../zoom')).toThrow(/identifier is invalid/);
  });

  it('retains a provider-reported error when its output is stopped', async () => {
    const { output, statuses } = harness();
    const id = output.start('rtmps://example.com/provider/key', settings, 'youtube', 'external');

    output.reportStatus(id, { state: 'error', message: 'YouTube did not detect an incoming video stream.' });
    await output.stop(id);

    expect(statuses.at(-2)).toMatchObject({ outputId: 'youtube', state: 'error' });
    expect(statuses.at(-1)).toMatchObject({ outputId: 'youtube', state: 'error', message: 'YouTube did not detect an incoming video stream.' });
  });

  it('waits for provider confirmation before first live status, then restores live after reconnect', async () => {
    const { output, children, statuses } = harness(2, 1024 * 1024, 0);
    const id = output.start('rtmps://example.com/provider/key', settings, 'youtube', 'external');
    await output.write(id, chunk('webm-header'));
    children[1]!.stderr.write('bitrate=1000kbits/s\nprogress=continue\n');
    expect(statuses.filter((status) => status.outputId === 'youtube' && status.state === 'live')).toHaveLength(0);

    output.reportStatus(id, { state: 'live' });
    children[1]!.fail();
    await output.write(id, chunk('media-during-reconnect'));
    await waitFor(() => children.length === 3 && children[2]!.writtenChunks.length === 2);
    children[2]!.stderr.write('bitrate=1000kbits/s\nprogress=continue\n');

    expect(statuses.filter((status) => status.outputId === 'youtube' && status.state === 'live')).toHaveLength(2);
    await output.stop(id);
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
