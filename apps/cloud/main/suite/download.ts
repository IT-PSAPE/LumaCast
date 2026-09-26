// Streams one installer artifact to disk, hashing as it goes so the whole
// file is never buffered in memory. Writes go to `<destination>.part` first;
// only a size- and checksum-verified download is renamed into place, so a
// half-written or corrupted download can never masquerade as a real install
// artifact.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { once } from 'node:events';
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

/** Normalizes a fetch Response body (web ReadableStream or async iterable) to one shape. */
function bodyChunks(body: unknown): AsyncIterable<Uint8Array> {
  if (body && typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function') {
    return body as AsyncIterable<Uint8Array>;
  }
  const reader = (body as { getReader: () => ReadableStreamDefaultReader<Uint8Array> }).getReader();
  return {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<Uint8Array>> {
          const { done, value } = await reader.read();
          if (done) return { done: true, value: undefined };
          return { done: false, value: value! };
        },
      };
    },
  };
}

async function writeChunk(stream: NodeJS.WritableStream, chunk: Buffer): Promise<void> {
  if (!stream.write(chunk)) {
    await once(stream, 'drain');
  }
}

function endStream(stream: NodeJS.WritableStream & { end: (cb?: (error?: Error | null) => void) => unknown }): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.end((error?: Error | null) => {
      if (error) reject(error);
      else resolve();
    });
  });
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

  try {
    if (signal?.aborted) {
      throw new DOMException('The download was aborted', 'AbortError');
    }

    const response = await fetchFn(url, { signal });
    if (!response.ok || !response.body) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const total = expectedSize > 0 ? expectedSize : Number(response.headers.get('content-length')) || null;
    const hash = createHash('sha512');
    const fileStream = createWriteStream(partPath);
    let streamError: Error | null = null;
    fileStream.on('error', (error) => {
      streamError = error;
    });

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

    for await (const chunk of bodyChunks(response.body)) {
      if (signal?.aborted) throw new DOMException('The download was aborted', 'AbortError');
      if (streamError) throw streamError;

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(buffer);
      transferred += buffer.length;
      samples.push({ time: Date.now(), bytes: buffer.length });
      await writeChunk(fileStream, buffer);
      emitProgress(false);
    }

    if (streamError) throw streamError as Error;
    await endStream(fileStream);

    const stats = await stat(partPath);
    if (stats.size !== expectedSize) {
      throw new Error(`Downloaded size ${stats.size} does not match expected ${expectedSize}`);
    }

    const digest = hash.digest('base64');
    if (digest !== expectedSha512) {
      throw new ChecksumMismatchError(expectedSha512, digest);
    }

    await rename(partPath, destination);
    emitProgress(true);
  } catch (error) {
    await unlink(partPath).catch(() => {});
    throw error;
  }
}
