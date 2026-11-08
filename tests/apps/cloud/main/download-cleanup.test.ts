// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChecksumMismatchError, downloadArtifact } from '../../../../apps/cloud/main/suite/download';

const state = vi.hoisted(() => ({
  writers: [] as Writable[],
  events: [] as Array<{ event: string; closed: boolean | null; file: string }>,
  nextWriter: null as Writable | null,
  afterPartStat: null as (() => void) | null,
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, createWriteStream: vi.fn((...args: Parameters<typeof actual.createWriteStream>) => {
    const writer = state.nextWriter ?? actual.createWriteStream(...args);
    state.nextWriter = null;
    state.writers.push(writer);
    writer.once('close', () => state.events.push({ event: 'close', closed: true, file: String(args[0]) }));
    return writer;
  }) };
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual,
    stat: vi.fn(async (...args: Parameters<typeof actual.stat>) => {
      const result = await actual.stat(...args);
      if (String(args[0]).endsWith('.part')) state.afterPartStat?.();
      return result;
    }),
    unlink: vi.fn(async (file: Parameters<typeof actual.unlink>[0]) => {
      state.events.push({ event: 'unlink', closed: state.writers.at(-1)?.closed ?? null, file: String(file) });
      await actual.unlink(file);
    }),
    rename: vi.fn(async (...args: Parameters<typeof actual.rename>) => {
      state.events.push({ event: 'rename', closed: state.writers.at(-1)?.closed ?? null, file: String(args[0]) });
      await actual.rename(...args);
    }),
  };
});

const digest = (bytes: Buffer) => createHash('sha512').update(bytes).digest('base64');
let dir: string;
let destination: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lumacloud-download-cleanup-'));
  destination = path.join(dir, 'artifact.zip');
  state.writers.length = 0;
  state.events.length = 0;
  state.nextWriter = null;
  state.afterPartStat = null;
});
afterEach(async () => {
  // Failed regressions must still relinquish the test's real file descriptors.
  await Promise.all(state.writers.map(async (writer) => {
    if (!writer.closed) {
      const closed = new Promise<void>((resolve) => writer.once('close', resolve));
      writer.destroy();
      await closed;
    }
  }));
  await rm(dir, { recursive: true, force: true });
});
function response(body: unknown, status = 200): Response {
  return { ok: status === 200, status, statusText: status === 200 ? 'OK' : 'Service Unavailable', headers: { get: () => null }, body } as unknown as Response;
}
function run(body: unknown, options: { signal?: AbortSignal; status?: number; expected?: Buffer } = {}) {
  const expected = options.expected ?? Buffer.from('expected installer bytes');
  return downloadArtifact({ url: 'http://synthetic.invalid/owned', destination, expectedSize: expected.length,
    expectedSha512: digest(expected), signal: options.signal,
    fetch: async () => response(body, options.status),
  });
}
function expectClosedBeforeRemoval() {
  expect(state.writers.length).toBeGreaterThan(0);
  expect(state.writers.every((writer) => writer.closed && writer.destroyed)).toBe(true);
  expect(state.events.filter((event) => event.event === 'unlink')).toEqual([
    { event: 'unlink', closed: true, file: `${destination}.part` },
  ]);
}

describe('Cloud download resource ownership', () => {
  it('closes an asynchronously opening writer before removing a source-failed partial file', async () => {
    const original = new Error('synthetic source failed before first chunk');
    const returned = vi.fn();
    const body = { [Symbol.asyncIterator]: () => ({ next: async () => { throw original; }, return: async () => { returned(); return { done: true as const, value: undefined }; } }) };
    await expect(run(body)).rejects.toBe(original);
    expectClosedBeforeRemoval();
    expect(returned).toHaveBeenCalledOnce();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await readdir(dir)).toEqual([]);
  });

  it('cancels and unlocks an unused HTTP error body without opening a writer', async () => {
    const cancel = vi.fn(() => { throw new Error('cleanup failed'); });
    const body = new ReadableStream<Uint8Array>({ cancel });
    await expect(run(body, { status: 503 })).rejects.toThrow('Download failed: 503 Service Unavailable');
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(state.writers).toHaveLength(0);
    expect(await readdir(dir)).toEqual([]);
  });

  it('retains the source error if cooperative iterator cleanup also throws', async () => {
    const original = new Error('original source failure');
    const body = { [Symbol.asyncIterator]: () => ({ next: async () => { throw original; }, return: async () => { throw new Error('return failed'); } }) };
    await expect(run(body)).rejects.toBe(original);
    expectClosedBeforeRemoval();
    expect(await readdir(dir)).toEqual([]);
  });

  it('aborts a pending getReader read, releases its lock and closes the writer', async () => {
    let reading!: () => void;
    const started = new Promise<void>((resolve) => { reading = resolve; });
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const controller = new AbortController();
    const download = run({ getReader() {
      const reader = body.getReader();
      return { read() { reading(); return reader.read(); }, cancel: reader.cancel.bind(reader), releaseLock: reader.releaseLock.bind(reader) };
    } }, { signal: controller.signal });
    const rejected = expect(download).rejects.toMatchObject({ name: 'AbortError' });
    await started;
    controller.abort();
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expectClosedBeforeRemoval();
    expect(await readdir(dir)).toEqual([]);
  });

  it('cancels a pending body read when disk failure interrupts it, keeping the disk error', async () => {
    const original = new Error('synthetic disk full');
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1])); }, cancel });
    state.nextWriter = new Writable({ write(_chunk, _encoding, callback) { setImmediate(() => callback(original)); } });
    await expect(run(body)).rejects.toBe(original);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expectClosedBeforeRemoval();
  });

  it('aborts while waiting for disk backpressure and closes before removing the partial', async () => {
    let writing!: () => void;
    const started = new Promise<void>((resolve) => { writing = resolve; });
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(64 * 1024)); }, cancel });
    state.nextWriter = new Writable({ highWaterMark: 1, write() { writing(); } });
    const controller = new AbortController();
    const download = run(body, { signal: controller.signal });
    const rejected = expect(download).rejects.toMatchObject({ name: 'AbortError' });
    await started;
    controller.abort();
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expectClosedBeforeRemoval();
  });

  it('keeps the old destination on checksum failure and unlocks the completed reader', async () => {
    const previous = Buffer.from('existing target must survive');
    await writeFile(destination, previous);
    const actual = Buffer.from('corrupted installer bytes');
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(actual); controller.close(); } });
    await expect(run(body, { expected: Buffer.alloc(actual.length) })).rejects.toBeInstanceOf(ChecksumMismatchError);
    expect(await readFile(destination)).toEqual(previous);
    expect(body.locked).toBe(false);
    expectClosedBeforeRemoval();
    expect(await readdir(dir)).toEqual(['artifact.zip']);
  });

  it('keeps the progress error when cancelling the reader also fails', async () => {
    const original = new Error('progress handler failed');
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1])); },
      cancel() { throw new Error('reader cancellation failed'); },
    });
    await expect(downloadArtifact({ url: 'http://synthetic.invalid/owned', destination,
      expectedSize: 2, expectedSha512: 'not reached', fetch: async () => response(body),
      onProgress: () => { throw original; },
    })).rejects.toBe(original);
    expect(body.locked).toBe(false);
    expectClosedBeforeRemoval();
    expect(await readdir(dir)).toEqual([]);
  });

  it('returns a cooperative iterator when cancellation interrupts its pending next', async () => {
    let reading!: () => void;
    const started = new Promise<void>((resolve) => { reading = resolve; });
    let completeRead!: (result: IteratorResult<Uint8Array>) => void;
    const returned = vi.fn(async () => {
      completeRead({ done: true, value: undefined });
      return { done: true as const, value: undefined };
    });
    const body = { [Symbol.asyncIterator]: () => ({
      next: () => new Promise<IteratorResult<Uint8Array>>((resolve) => { completeRead = resolve; reading(); }),
      return: returned,
    }) };
    const controller = new AbortController();
    const download = run(body, { signal: controller.signal });
    const rejected = expect(download).rejects.toMatchObject({ name: 'AbortError' });
    await started;
    controller.abort();
    await rejected;
    expect(returned).toHaveBeenCalledOnce();
    expectClosedBeforeRemoval();
    expect(await readdir(dir)).toEqual([]);
  });

  it('closes before verified rename and preserves downloaded bytes', async () => {
    const expected = Buffer.from('valid installer bytes');
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(expected); controller.close(); } });
    await run(body, { expected });
    expect(body.locked).toBe(false);
    expect(state.writers.every((writer) => writer.closed)).toBe(true);
    expect(state.events.filter((event) => event.event === 'rename')).toEqual([
      { event: 'rename', closed: true, file: `${destination}.part` },
    ]);
    expect(await readFile(destination)).toEqual(expected);
  });

  it('keeps the old destination when cancellation arrives during final verification', async () => {
    const previous = Buffer.from('previous target');
    await writeFile(destination, previous);
    const expected = Buffer.from('verified new installer bytes');
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(expected); controller.close(); } });
    const controller = new AbortController();
    state.afterPartStat = () => controller.abort();
    await expect(run(body, { expected, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(await readFile(destination)).toEqual(previous);
    expect(state.events.some((event) => event.event === 'rename')).toBe(false);
    expect(body.locked).toBe(false);
    expectClosedBeforeRemoval();
    expect(await readdir(dir)).toEqual(['artifact.zip']);
  });

  it('repeated aborts leave no open file streams or partial paths', async () => {
    for (let i = 0; i < 12; i++) {
      const controller = new AbortController();
      // Disable eager WebStream prefetch so every abort follows actual reader
      // acquisition and writer creation, rather than the pre-fetch signal guard.
      const body = new ReadableStream<Uint8Array>({ pull() { controller.abort(); } }, { highWaterMark: 0 });
      await expect(run(body, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
      expect(state.writers).toHaveLength(i + 1);
      expect(body.locked).toBe(false);
      expect(state.writers.every((writer) => writer.closed && Reflect.get(writer, 'fd') === null)).toBe(true);
      expect(await readdir(dir)).toEqual([]);
    }
  });

  it('cleans a real loopback HTTP cancellation after bytes reach the writer', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.write(Buffer.alloc(64 * 1024, 1));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const controller = new AbortController();
    try {
      const address = server.address() as import('node:net').AddressInfo;
      const download = downloadArtifact({ url: `http://127.0.0.1:${address.port}/synthetic`, destination,
        expectedSize: 128 * 1024, expectedSha512: 'not reached', signal: controller.signal,
        onProgress: () => controller.abort(),
      });
      await expect(download).rejects.toMatchObject({ name: 'AbortError' });
      expectClosedBeforeRemoval();
      expect(await readdir(dir)).toEqual([]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
