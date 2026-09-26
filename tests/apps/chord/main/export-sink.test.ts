import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExportSinkRegistry, MAX_CONCURRENT_EXPORT_SINKS } from '../../../../apps/chord/main/export-sink';

describe('apps/chord ExportSinkRegistry', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'lumachord-export-sink-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('opens a sink with a random id at the given path', async () => {
    const registry = new ExportSinkRegistry();
    const filePath = path.join(dir, 'out.mp4');

    const sink = await registry.open(filePath);

    expect(sink.path).toBe(filePath);
    expect(sink.id).toMatch(/^[0-9a-f]{32}$/);
    expect(existsSync(filePath)).toBe(true);
    expect(registry.isOpen(sink.id)).toBe(true);

    await registry.close(sink.id);
  });

  it('issues a different id per open, even for the same path', async () => {
    const registry = new ExportSinkRegistry();
    const a = await registry.open(path.join(dir, 'out.mp4'));
    await registry.close(a.id);
    const b = await registry.open(path.join(dir, 'out.mp4'));

    expect(a.id).not.toBe(b.id);
    await registry.close(b.id);
  });

  it('writes bytes at the given position, producing the expected file contents', async () => {
    const registry = new ExportSinkRegistry();
    const filePath = path.join(dir, 'out.bin');
    const sink = await registry.open(filePath);

    await registry.write(sink.id, 0, new TextEncoder().encode('HELLO'));
    await registry.close(sink.id);

    expect(readFileSync(filePath, 'utf8')).toBe('HELLO');
  });

  it('supports out-of-order positional writes, including a rewind to patch a header', async () => {
    const registry = new ExportSinkRegistry();
    const filePath = path.join(dir, 'out.bin');
    const sink = await registry.open(filePath);

    // A streaming muxer: write a placeholder header, append the body, then
    // rewind to patch the header with the now-known final values.
    await registry.write(sink.id, 0, new TextEncoder().encode('....'));
    await registry.write(sink.id, 4, new TextEncoder().encode('BODY'));
    await registry.write(sink.id, 0, new TextEncoder().encode('HEAD'));
    await registry.close(sink.id);

    expect(readFileSync(filePath, 'utf8')).toBe('HEADBODY');
  });

  it('close() flushes to disk (fsync) before resolving', async () => {
    const registry = new ExportSinkRegistry();
    const filePath = path.join(dir, 'out.bin');
    const sink = await registry.open(filePath);
    await registry.write(sink.id, 0, new TextEncoder().encode('data'));

    await expect(registry.close(sink.id)).resolves.toBeUndefined();
    expect(readFileSync(filePath, 'utf8')).toBe('data');
  });

  it('close() forgets the id: further writes are rejected', async () => {
    const registry = new ExportSinkRegistry();
    const sink = await registry.open(path.join(dir, 'out.bin'));
    await registry.close(sink.id);

    expect(registry.isOpen(sink.id)).toBe(false);
    await expect(registry.write(sink.id, 0, new Uint8Array([1]))).rejects.toThrow(/[Uu]nknown/);
    await expect(registry.close(sink.id)).rejects.toThrow(/[Uu]nknown/);
  });

  it('abort() closes and deletes the partial file', async () => {
    const registry = new ExportSinkRegistry();
    const filePath = path.join(dir, 'out.bin');
    const sink = await registry.open(filePath);
    await registry.write(sink.id, 0, new TextEncoder().encode('partial'));

    await registry.abort(sink.id);

    expect(existsSync(filePath)).toBe(false);
    expect(registry.isOpen(sink.id)).toBe(false);
  });

  it('rejects a write, close, or abort against an id that was never opened', async () => {
    const registry = new ExportSinkRegistry();
    await expect(registry.write('deadbeef', 0, new Uint8Array())).rejects.toThrow(/[Uu]nknown/);
    await expect(registry.close('deadbeef')).rejects.toThrow(/[Uu]nknown/);
    await expect(registry.abort('deadbeef')).rejects.toThrow(/[Uu]nknown/);
  });

  it('caps concurrent open sinks', async () => {
    const registry = new ExportSinkRegistry();
    const opened = [];
    for (let i = 0; i < MAX_CONCURRENT_EXPORT_SINKS; i += 1) {
      opened.push(await registry.open(path.join(dir, `out-${i}.bin`)));
    }

    await expect(registry.open(path.join(dir, 'one-too-many.bin'))).rejects.toThrow(/concurrent/i);

    for (const sink of opened) {
      await registry.close(sink.id);
    }
  });

  it('allows opening a new sink after one closes, once under the cap again', async () => {
    const registry = new ExportSinkRegistry();
    const opened = [];
    for (let i = 0; i < MAX_CONCURRENT_EXPORT_SINKS; i += 1) {
      opened.push(await registry.open(path.join(dir, `out-${i}.bin`)));
    }
    await registry.close(opened[0].id);

    await expect(registry.open(path.join(dir, 'now-fits.bin'))).resolves.toMatchObject({});
  });
});
