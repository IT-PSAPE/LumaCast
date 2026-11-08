// Streams one installer artifact to disk, hashing as it goes so the whole
// file is never buffered in memory. Writes go to `<destination>.part` first;
// only a size- and checksum-verified download is renamed into place, so a
// half-written or corrupted download can never masquerade as a real install
// artifact.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, type WriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import type { OperationProgress } from '../../shared/desktop-api';

export class ChecksumMismatchError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`Checksum mismatch: expected ${expected}, got ${actual}`);
    this.name = 'ChecksumMismatchError';
  }
}

export interface DownloadArtifactOptions {
  url: string;
  destination: string;
  /** base64-encoded SHA-512, as electron-builder's `latest*.yml` records it. */
  expectedSha512: string;
  expectedSize: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  onProgress?: (progress: OperationProgress) => void;
}

// ~10 callbacks/second: frequent enough for a smooth progress bar, rare
// enough that a fast local fetch (as in tests) doesn't flood the caller.
const PROGRESS_INTERVAL_MS = 100;
// bytesPerSecond is the sum of bytes transferred in the trailing window,
// divided by the window's actual elapsed time — a true sliding window rather
// than a reset-every-tick average, so a burst followed by a lull still
// reports a sane rate.
const SPEED_WINDOW_MS = 1000;

async function statOrNull(filePath: string): Promise<{ size: number } | null> {
  try {
    return await stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function sha512Base64OfFile(filePath: string): Promise<string> {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('base64');
}

/** Own the fetch reader explicitly, including a read pending when the disk fails. */
function openBody(body: unknown) {
  const reader = typeof (body as ReadableStream<Uint8Array>).getReader === 'function'
    ? (body as ReadableStream<Uint8Array>).getReader()
    : null;
  const iterator = reader ? null : (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
  let done = false;
  let pendingRead: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
  let closing: Promise<void> | null = null;
  const close = (reason?: unknown): Promise<void> => {
    if (!closing) {
      closing = (async () => {
        try {
          if (!done) {
            if (reader) await reader.cancel(reason);
            else await iterator?.return?.();
          }
        } catch {
          // Cleanup must not replace a useful HTTP, source, disk or abort error.
        } finally {
          if (reader) {
            await pendingRead?.catch(() => {});
            try { reader.releaseLock(); } catch { /* Preserve the initiating failure. */ }
          }
        }
      })();
    }
    return closing;
  };
  return {
    close,
    async *chunks(signal: AbortSignal): AsyncGenerator<Uint8Array> {
      // Pipeline aborts this signal for disk errors as well as user cancellation.
      // Cancelling here settles a pending reader.read before iterator cleanup.
      const abort = () => { void close(signal.reason); };
      signal.addEventListener('abort', abort, { once: true });
      try {
        while (true) {
          signal.throwIfAborted();
          const result = reader
            ? await (pendingRead = reader.read())
            : await iterator!.next();
          pendingRead = null;
          if (result.done) { done = true; return; }
          yield result.value;
        }
      } finally {
        signal.removeEventListener('abort', abort);
        await close(signal.reason);
      }
    },
  };
}

export async function downloadArtifact(options: DownloadArtifactOptions): Promise<void> {
  const { url, destination, expectedSha512, expectedSize, signal } = options;
  const fetchFn = options.fetch ?? globalThis.fetch;

  // Reuse a prior, verified download outright — no request, no .part file.
  const existing = await statOrNull(destination);
  if (existing && existing.size === expectedSize) {
    const digest = await sha512Base64OfFile(destination);
    if (digest === expectedSha512) {
      options.onProgress?.({
        transferred: expectedSize,
        total: expectedSize,
        percent: 100,
        bytesPerSecond: null,
      });
      return;
    }
  }

  await mkdir(path.dirname(destination), { recursive: true });
  const partPath = `${destination}.part`;
  let body: ReturnType<typeof openBody> | null = null;
  let fileStream: WriteStream | null = null;
  let writerClosed: Promise<void> | null = null;

  try {
    if (signal?.aborted) {
      throw new DOMException('The download was aborted', 'AbortError');
    }

    const response = await fetchFn(url, { signal });
    if (response.body) body = openBody(response.body);
    if (!response.ok || !response.body) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const total = expectedSize > 0 ? expectedSize : Number(response.headers.get('content-length')) || null;
    const hash = createHash('sha512');
    fileStream = createWriteStream(partPath);
    writerClosed = new Promise((resolve) => fileStream!.once('close', resolve));

    let transferred = 0;
    const samples: Array<{ time: number; bytes: number }> = [];
    let lastEmit = 0;

    const emitProgress = (final: boolean): void => {
      const now = Date.now();
      if (!final && now - lastEmit < PROGRESS_INTERVAL_MS) return;
      lastEmit = now;
      while (samples.length > 0 && now - samples[0].time > SPEED_WINDOW_MS) samples.shift();
      const windowBytes = samples.reduce((sum, sample) => sum + sample.bytes, 0);
      const windowElapsed = samples.length > 0 ? now - samples[0].time : 0;
      const bytesPerSecond = final || windowElapsed <= 0 ? null : (windowBytes / windowElapsed) * 1000;
      options.onProgress?.({
        transferred,
        total,
        percent: total ? Math.min(100, (transferred / total) * 100) : null,
        bytesPerSecond,
      });
    };

    const responseBody = body!;
    // Node supplies source options, though the current Node type declarations
    // describe a zero-argument source. Keep the missing-context case explicit.
    await pipeline(async function* (context?: { signal: AbortSignal }) {
      if (!context) throw new Error('Download pipeline cancellation context is missing');
      const readSignal = context.signal;
      for await (const chunk of responseBody.chunks(readSignal)) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        hash.update(buffer);
        transferred += buffer.length;
        samples.push({ time: Date.now(), bytes: buffer.length });
        yield buffer;
        emitProgress(false);
      }
    }, fileStream, { signal });
    await writerClosed;
    signal?.throwIfAborted();

    const stats = await stat(partPath);
    if (stats.size !== expectedSize) {
      throw new Error(`Downloaded size ${stats.size} does not match expected ${expectedSize}`);
    }

    const digest = hash.digest('base64');
    if (digest !== expectedSha512) {
      throw new ChecksumMismatchError(expectedSha512, digest);
    }

    signal?.throwIfAborted();
    await rename(partPath, destination);
    emitProgress(true);
  } catch (error) {
    // destroy also waits for an in-flight asynchronous open before closing.
    // In particular, unlinking first can miss a .part that has not opened yet.
    fileStream?.destroy();
    await Promise.all([body?.close(error), writerClosed]);
    await unlink(partPath).catch(() => {});
    throw error;
  }
}
