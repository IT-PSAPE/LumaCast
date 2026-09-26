// The write side of the export pipeline: the renderer's encoder produces
// chunks out of order relative to file position (a streaming muxer patches
// header bytes it already flushed once the final duration/index is known),
// so every write is positional (`fs.write(fd, buf, 0, len, position)`) rather
// than an append. Ids are random and unknown ids are rejected so a stray or
// forged sink id from the renderer can never write through a dangling fd.
import { randomBytes } from 'node:crypto';
import { close, fsync, open, unlink, write } from 'node:fs';
import { promisify } from 'node:util';
import type { ExportSink } from '../shared/desktop-api';

const closeAsync = promisify(close);
const fsyncAsync = promisify(fsync);
const openAsync = promisify(open);
const unlinkAsync = promisify(unlink);
const writeAsync = promisify(write);

/** An export encodes video/audio and is naturally memory/CPU heavy; capping
 *  concurrent sinks keeps a renderer bug (or a user mashing Export) from
 *  opening unbounded file descriptors. */
export const MAX_CONCURRENT_EXPORT_SINKS = 4;

interface OpenSink {
  fd: number;
  path: string;
}

export class ExportSinkRegistry {
  private readonly sinks = new Map<string, OpenSink>();

  async open(path: string): Promise<ExportSink> {
    if (this.sinks.size >= MAX_CONCURRENT_EXPORT_SINKS) {
      throw new Error(
        `Refusing to open another concurrent export sink: ${MAX_CONCURRENT_EXPORT_SINKS} are already open`,
      );
    }
    const fd = await openAsync(path, 'w');
    const id = randomBytes(16).toString('hex');
    this.sinks.set(id, { fd, path });
    return { id, path };
  }

  async write(id: string, position: number, bytes: Uint8Array): Promise<void> {
    const sink = this.sinks.get(id);
    if (!sink) throw new Error(`Unknown export sink: ${id}`);
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    await writeAsync(sink.fd, buffer, 0, buffer.length, position);
  }

  async close(id: string): Promise<void> {
    const sink = this.sinks.get(id);
    if (!sink) throw new Error(`Unknown export sink: ${id}`);
    this.sinks.delete(id);
    await fsyncAsync(sink.fd);
    await closeAsync(sink.fd);
  }

  /** Closes the fd and deletes the partial file. */
  async abort(id: string): Promise<void> {
    const sink = this.sinks.get(id);
    if (!sink) throw new Error(`Unknown export sink: ${id}`);
    this.sinks.delete(id);
    await closeAsync(sink.fd);
    await unlinkAsync(sink.path).catch(() => {});
  }

  isOpen(id: string): boolean {
    return this.sinks.has(id);
  }
}
