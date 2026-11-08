// Muxers patch already-written headers, so writes are positional and ordered.
// Publish only after the sibling temporary file is synced and closed. Abort
// and failure cleanup own only that temporary file, never the destination.
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, open, realpath, rename, stat, unlink, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { ExportSink } from '../shared/desktop-api';

export const MAX_CONCURRENT_EXPORT_SINKS = 4;
type TerminalKind = 'close' | 'abort';

interface OpenSink {
  id: string;
  destination: string;
  temporary: string | null;
  file: FileHandle | null;
  mode: number;
  keys: Set<string>;
  phase: 'opening' | 'open' | 'closing' | 'aborting' | 'failed';
  pending: Promise<void>;
  failure: unknown;
  terminal: { kind: TerminalKind; promise: Promise<void> } | null;
  cleanup: Promise<void> | null;
  openingDone: Promise<void>;
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function targetKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  // Conservatively exclude case/normalization aliases on desktop filesystems,
  // including case-sensitive macOS volumes, while an export is active.
  return process.platform === 'darwin' || process.platform === 'win32'
    ? resolved.normalize('NFC').toLowerCase() : resolved;
}

async function resolveDestination(selected: string): Promise<{ destination: string; mode: number }> {
  let destination: string;
  try {
    destination = await realpath(selected);
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error;
    // open('w') follows symlinks. Keep valid links by publishing to their initial
    // target; reject dangling links rather than replacing the link itself.
    try {
      if ((await lstat(selected)).isSymbolicLink()) throw new Error('The export destination symlink has no existing target.');
    } catch (entryError) {
      if (!hasCode(entryError, 'ENOENT')) throw entryError;
    }
    destination = path.join(await realpath(path.dirname(path.resolve(selected))), path.basename(selected));
    return { destination, mode: 0o666 & ~process.umask() };
  }
  const metadata = await stat(destination);
  if (!metadata.isFile()) throw new Error('The export destination must be a regular file.');
  await access(destination, constants.W_OK);
  // Replacement creates a new inode: retain mode bits; ownership/ACLs come from
  // the new file and hard-link aliases keep their original inode and contents.
  return { destination, mode: metadata.mode & 0o777 };
}

export class ExportSinkRegistry {
  private readonly sinks = new Map<string, OpenSink>();
  private readonly targets = new Map<string, string>();
  private retired = false;
  private retirement: Promise<void> | null = null;

  async open(selected: string): Promise<ExportSink> {
    this.assertActive();
    if (this.sinks.size >= MAX_CONCURRENT_EXPORT_SINKS) {
      throw new Error(`Refusing to open another concurrent export sink: ${MAX_CONCURRENT_EXPORT_SINKS} are already open`);
    }
    let opened!: () => void;
    const openingDone = new Promise<void>((resolve) => { opened = resolve; });
    const sink: OpenSink = {
      id: randomBytes(16).toString('hex'), destination: selected,
      temporary: null, file: null, mode: 0o600, keys: new Set(), phase: 'opening',
      pending: Promise.resolve(), failure: undefined, terminal: null, cleanup: null,
      openingDone,
    };
    // Opening and cleanup count against the cap; reserve before the first await.
    this.claim(sink, selected);
    this.sinks.set(sink.id, sink);
    try {
      const resolved = await resolveDestination(selected);
      this.claim(sink, resolved.destination);
      sink.destination = resolved.destination;
      sink.mode = resolved.mode;
      this.assertActive();
      const temporary = path.join(path.dirname(sink.destination), `.lumachord-export-${sink.id}.tmp`);
      const file = await open(temporary, 'wx', 0o600);
      // A failed exclusive open never grants ownership of an existing temp path.
      sink.file = file;
      sink.temporary = temporary;
      this.assertActive();
      sink.phase = 'open';
      return { id: sink.id, path: selected };
    } catch (error) {
      // Retirement must not observe openingDone before failed-open cleanup.
      return await this.fail(sink, error);
    } finally {
      opened();
    }
  }

  async write(id: string, position: number, bytes: Uint8Array): Promise<void> {
    this.assertActive();
    const sink = this.get(id);
    if (sink.phase !== 'open') throw new Error(`Export sink is ${sink.phase}: ${id}`);
    // Callers may release/reuse a chunk while waiting behind another write.
    const buffer = Buffer.from(bytes);
    const result = sink.pending.then(async () => {
      if (sink.failure !== undefined) throw sink.failure;
      try {
        const file = sink.file;
        if (!file) throw new Error('The export sink no longer owns its temporary file.');
        let offset = 0;
        while (offset < buffer.length) {
          const { bytesWritten } = await file.write(buffer, offset, buffer.length - offset, position + offset);
          if (!Number.isInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > buffer.length - offset) {
            throw new Error('The export file write made no valid progress.');
          }
          offset += bytesWritten;
        }
      } catch (error) {
        return this.fail(sink, error);
      }
    });
    sink.pending = result.then(() => {}, () => {});
    return result;
  }

  async close(id: string): Promise<void> {
    this.assertActive();
    return this.finish(id, 'close');
  }

  async abort(id: string): Promise<void> {
    return this.finish(id, 'abort');
  }

  isOpen(id: string): boolean {
    return this.sinks.has(id);
  }

  /** Permanently fence this renderer/window owner and drain its bounded sinks.
   *  Accepted closes still publish; other sinks abort. Repeated calls coalesce;
   *  after a failure another call retries retained cleanup, never publication.
   *  A replacement renderer needs a fresh registry after this drain completes. */
  retire(): Promise<void> {
    this.retired = true;
    if (this.retirement) return this.retirement;
    const drains = [...this.sinks.values()].map((sink) => this.retireSink(sink));
    const promise = Promise.allSettled(drains).then((results) => {
      const errors = results.flatMap((result) => result.status === 'rejected' ? [result.reason as unknown] : []);
      if (errors.length > 0) throw new AggregateError(errors, `Could not retire export sinks: ${errors.map(errorMessage).join('; ')}`);
    });
    this.retirement = promise;
    promise.then(undefined, () => { if (this.retirement === promise) this.retirement = null; });
    return promise;
  }

  private assertActive(): void {
    if (this.retired) throw new Error('The export sink registry has retired.');
  }

  private async retireSink(sink: OpenSink): Promise<void> {
    // Capture an already accepted terminal before any await: its failure must
    // remain observable even if it releases the map entry while we are draining.
    const acceptedTerminal = sink.terminal;
    if (acceptedTerminal) return acceptedTerminal.promise;
    await sink.openingDone;
    if (this.sinks.get(sink.id) !== sink) return;
    if (sink.terminal) return sink.terminal.promise;
    return this.finish(sink.id, 'abort');
  }

  private get(id: string): OpenSink {
    const sink = this.sinks.get(id);
    if (!sink) throw new Error(`Unknown export sink: ${id}`);
    return sink;
  }

  private claim(sink: OpenSink, filePath: string): void {
    const key = targetKey(filePath);
    const owner = this.targets.get(key);
    if (owner && owner !== sink.id) throw new Error('An export to this destination is already active.');
    this.targets.set(key, sink.id);
    sink.keys.add(key);
  }

  private release(sink: OpenSink): void {
    this.sinks.delete(sink.id);
    for (const key of sink.keys) if (this.targets.get(key) === sink.id) this.targets.delete(key);
  }

  private finish(id: string, kind: TerminalKind): Promise<void> {
    const sink = this.get(id);
    // First terminal admission wins. A late abort cannot report cancellation
    // after close accepted publication, or unlink a successfully published file.
    if (sink.terminal) {
      return sink.terminal.kind === kind ? sink.terminal.promise
        : Promise.reject(new Error(`Export sink is ${sink.terminal.kind === 'close' ? 'closing' : 'aborting'}: ${id}`));
    }
    if (sink.phase !== 'open' && !(kind === 'abort' && sink.phase === 'failed')) {
      return Promise.reject(sink.failure ?? new Error(`Export sink is ${sink.phase}: ${id}`));
    }
    sink.phase = kind === 'close' ? 'closing' : 'aborting';
    const promise = sink.pending.then(async () => {
      if (kind === 'abort') return this.cleanup(sink);
      try {
        if (sink.failure !== undefined) throw sink.failure;
        const file = sink.file;
        const temporary = sink.temporary;
        if (!file || !temporary) throw new Error('The export sink no longer owns its temporary file.');
        await file.chmod(sink.mode);
        await file.sync();
        await this.closeFile(sink);
        await rename(temporary, sink.destination);
        sink.temporary = null;
        this.release(sink);
      } catch (error) {
        return this.fail(sink, error);
      }
    });
    sink.terminal = { kind, promise };
    promise.then(() => { sink.terminal = null; }, () => {
      sink.terminal = null;
      sink.phase = 'failed';
    });
    return promise;
  }

  private async closeFile(sink: OpenSink): Promise<void> {
    const file = sink.file;
    if (!file) return;
    try {
      await file.close();
    } finally {
      // FileHandle consumes ownership before native close completes. Never retry
      // a bare descriptor that another operation may already have reused.
      if (file.fd === -1) sink.file = null;
    }
  }

  private async fail(sink: OpenSink, error: unknown): Promise<never> {
    sink.failure ??= error;
    sink.phase = 'failed';
    try {
      await this.cleanup(sink);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `Export failed: ${errorMessage(error)}. Temporary output cleanup also failed: ${errorMessage(cleanupError)}`);
    }
    throw error;
  }

  private cleanup(sink: OpenSink): Promise<void> {
    if (sink.cleanup) return sink.cleanup;
    const promise = this.performCleanup(sink);
    sink.cleanup = promise;
    promise.then(() => { sink.cleanup = null; }, () => { sink.cleanup = null; });
    return promise;
  }

  private async performCleanup(sink: OpenSink): Promise<void> {
    const errors: unknown[] = [];
    try { await this.closeFile(sink); } catch (error) { errors.push(error); }
    if (sink.temporary) {
      try {
        await unlink(sink.temporary);
        sink.temporary = null;
      } catch (error) {
        if (hasCode(error, 'ENOENT')) sink.temporary = null;
        else errors.push(error);
      }
    }
    if (!sink.file && !sink.temporary) this.release(sink);
    else sink.phase = 'failed'; // Retain ownership/capacity for an abort retry.
    if (errors.length > 0) throw new AggregateError(errors, `Could not clean up the temporary export output: ${errors.map(errorMessage).join('; ')}`);
  }
}
