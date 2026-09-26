import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChecksumMismatchError, downloadArtifact } from '../../../../apps/cloud/main/suite/download';
import type { OperationProgress } from '../../../../apps/cloud/shared/desktop-api';

function sha512Base64(buffer: Buffer): string {
  return createHash('sha512').update(buffer).digest('base64');
}

function chunkedBody(buffer: Buffer, chunkSize: number, delayMs = 0): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      for (let offset = 0; offset < buffer.length; offset += chunkSize) {
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        yield buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length));
      }
    },
  };
}

function fakeFetchFor(buffer: Buffer, opts?: { chunkSize?: number; delayMs?: number }): typeof globalThis.fetch {
  return (async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    body: chunkedBody(buffer, opts?.chunkSize ?? 8, opts?.delayMs ?? 0),
  })) as unknown as typeof globalThis.fetch;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

let dir: string;
let destination: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lumacloud-download-'));
  destination = path.join(dir, 'artifact', 'LumaCast-1.2.0-arm64-mac.zip');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('apps/cloud downloadArtifact', () => {
  it('streams to disk and verifies size + checksum on completion', async () => {
    const buffer = Buffer.from('lumacast-installer-bytes'.repeat(50));
    const expectedSha512 = sha512Base64(buffer);
    const progress: OperationProgress[] = [];

    await downloadArtifact({
      url: 'https://example.com/artifact.zip',
      destination,
      expectedSha512,
      expectedSize: buffer.length,
      fetch: fakeFetchFor(buffer),
      onProgress: (p) => progress.push(p),
    });

    expect(await readFile(destination)).toEqual(buffer);
    expect(await fileExists(`${destination}.part`)).toBe(false);
    expect(progress.at(-1)).toEqual({
      transferred: buffer.length,
      total: buffer.length,
      percent: 100,
      bytesPerSecond: null,
    });
  });

  it('reports transferred bytes monotonically', async () => {
    const buffer = Buffer.from('x'.repeat(2000));
    const expectedSha512 = sha512Base64(buffer);
    const progress: OperationProgress[] = [];

    await downloadArtifact({
      url: 'https://example.com/artifact.zip',
      destination,
      expectedSha512,
      expectedSize: buffer.length,
      fetch: fakeFetchFor(buffer, { chunkSize: 64 }),
      onProgress: (p) => progress.push(p),
    });

    expect(progress.length).toBeGreaterThan(0);
    for (let i = 1; i < progress.length; i += 1) {
      expect(progress[i].transferred).toBeGreaterThanOrEqual(progress[i - 1].transferred);
    }
    expect(progress.at(-1)!.transferred).toBe(buffer.length);
  });

  it('throws ChecksumMismatchError and removes the .part file on a hash mismatch', async () => {
    const buffer = Buffer.from('some installer bytes');
    const wrongSha512 = sha512Base64(Buffer.from('different bytes entirely'));

    await expect(
      downloadArtifact({
        url: 'https://example.com/artifact.zip',
        destination,
        expectedSha512: wrongSha512,
        expectedSize: buffer.length,
        fetch: fakeFetchFor(buffer),
      }),
    ).rejects.toBeInstanceOf(ChecksumMismatchError);

    expect(await fileExists(destination)).toBe(false);
    expect(await fileExists(`${destination}.part`)).toBe(false);
  });

  it('aborts the download and removes the .part file', async () => {
    const buffer = Buffer.from('y'.repeat(4000));
    const expectedSha512 = sha512Base64(buffer);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 15);

    await expect(
      downloadArtifact({
        url: 'https://example.com/artifact.zip',
        destination,
        expectedSha512,
        expectedSize: buffer.length,
        fetch: fakeFetchFor(buffer, { chunkSize: 32, delayMs: 5 }),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(await fileExists(destination)).toBe(false);
    expect(await fileExists(`${destination}.part`)).toBe(false);
  });

  it('reuses a previously downloaded and verified file without fetching again', async () => {
    const buffer = Buffer.from('already downloaded bytes');
    const expectedSha512 = sha512Base64(buffer);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, buffer);

    const progress: OperationProgress[] = [];
    const fetchThatMustNotRun: typeof globalThis.fetch = (async () => {
      throw new Error('must not fetch when reusing a verified file');
    }) as unknown as typeof globalThis.fetch;

    await downloadArtifact({
      url: 'https://example.com/artifact.zip',
      destination,
      expectedSha512,
      expectedSize: buffer.length,
      fetch: fetchThatMustNotRun,
      onProgress: (p) => progress.push(p),
    });

    expect(await readFile(destination)).toEqual(buffer);
    expect(progress).toEqual([{ transferred: buffer.length, total: buffer.length, percent: 100, bytesPerSecond: null }]);
  });

  it('does not reuse a file of the right size but the wrong hash', async () => {
    const buffer = Buffer.from('the real bytes');
    // Same length as `buffer`, different content: exercises the hash check in
    // the reuse path, not just the (cheaper) size check.
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, Buffer.from('wrong content!'));
    expect(Buffer.from('wrong content!').length).toBe(buffer.length);

    const expectedSha512 = sha512Base64(buffer);

    await downloadArtifact({
      url: 'https://example.com/artifact.zip',
      destination,
      expectedSha512,
      expectedSize: buffer.length,
      fetch: fakeFetchFor(buffer),
    });

    expect(await readFile(destination)).toEqual(buffer);
  });
});
