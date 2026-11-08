// @vitest-environment node
import { chmodSync, closeSync, existsSync, fstatSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportSinkRegistry, MAX_CONCURRENT_EXPORT_SINKS } from '../../../../apps/chord/main/export-sink';

const io = vi.hoisted(() => ({
  handles: [] as FileHandle[],
  files: new Map<string, FileHandle>(),
  events: [] as string[],
  writeLimit: Infinity,
  zeroWrite: false,
  writeError: null as Error | null,
  syncError: null as Error | null,
  chmodError: null as Error | null,
  closeErrors: [] as Error[],
  afterClose: null as (() => void) | null,
  closeAfterError: null as Error | null,
  renameError: null as Error | null,
  unlinkError: null as Error | null,
  openGate: null as Promise<void> | null,
  writeGate: null as Promise<void> | null,
  syncGate: null as Promise<void> | null,
  collideTemp: false,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      io.events.push('open');
      if (io.openGate) await io.openGate;
      if (io.collideTemp) await actual.writeFile(args[0], 'unowned temporary sentinel');
      const handle = await actual.open(...args);
      io.handles.push(handle);
      io.files.set(String(args[0]), handle);
      return new Proxy(handle, {
        get(target, key) {
          if (key === 'write') return async (buffer: Buffer, offset: number, length: number, position: number) => {
            io.events.push(`write:${position}`);
            if (io.writeGate) await io.writeGate;
            if (io.writeError) throw io.writeError;
            if (io.zeroWrite) return { bytesWritten: 0, buffer };
            return target.write(buffer, offset, Math.min(length, io.writeLimit), position);
          };
          if (key === 'sync') return async () => {
            io.events.push('sync');
            if (io.syncGate) await io.syncGate;
            if (io.syncError) throw io.syncError;
            return target.sync();
          };
          if (key === 'chmod') return async (mode: number) => {
            if (io.chmodError) throw io.chmodError;
            return target.chmod(mode);
          };
          if (key === 'close') return async () => {
            io.events.push('close');
            const error = io.closeErrors.shift();
            // A synthetic pre-close rejection leaves native ownership intact;
            // real FileHandle close consumes fd even if native close rejects.
            if (error) throw error;
            await target.close();
            if (io.afterClose) io.afterClose();
            if (io.closeAfterError) throw io.closeAfterError;
          };
          const value: unknown = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      io.events.push('rename');
      expect(io.files.get(String(args[0]))?.fd).toBe(-1);
      if (io.renameError) throw io.renameError;
      return actual.rename(...args);
    },
    unlink: async (...args: Parameters<typeof actual.unlink>) => {
      io.events.push('unlink');
      if (io.unlinkError) throw io.unlinkError;
      return actual.unlink(...args);
    },
  };
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function untilEvent(event: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (io.events.includes(event)) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`Expected IO event: ${event}`);
}

describe('Chord export destination integrity', () => {
  let directory: string;
  let target: string;
  const previous = 'previous successful export';

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'chord-export-integrity-'));
    target = path.join(directory, 'out.mp4');
    writeFileSync(target, previous);
    Object.assign(io, {
      handles: [], files: new Map(), events: [], writeLimit: Infinity, zeroWrite: false,
      writeError: null, syncError: null, chmodError: null, closeErrors: [], afterClose: null, closeAfterError: null,
      renameError: null, unlinkError: null, openGate: null, writeGate: null, syncGate: null,
      collideTemp: false,
    });
  });

  afterEach(async () => {
    for (const handle of io.handles) if (handle.fd !== -1) await handle.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function expectClean(registry: ExportSinkRegistry, id: string) {
    expect(readFileSync(target, 'utf8')).toBe(previous);
    expect(readdirSync(directory)).toEqual(['out.mp4']);
    expect(io.handles.every((handle) => handle.fd === -1)).toBe(true);
    expect(registry.isOpen(id)).toBe(false);
  }

  it('leaves the previous export untouched while writing and after cancellation', async () => {
    const registry = new ExportSinkRegistry();
    const sink = await registry.open(target);
    expect(sink.path).toBe(target);
    await registry.write(sink.id, 0, Buffer.from('partial'));
    expect(readFileSync(target, 'utf8')).toBe(previous);
    expect(readdirSync(directory)).toHaveLength(2);
    await registry.abort(sink.id);
    expectClean(registry, sink.id);
  });

  it('preserves arbitrary prior binary bytes when a new export is cancelled', async () => {
    const binary = Buffer.from([0, 255, 128, 0, 17, 222, 173, 190, 239]);
    writeFileSync(target, binary);
    const registry = new ExportSinkRegistry();
    const sink = await registry.open(target);
    await registry.write(sink.id, 0, Buffer.from([1, 2, 3]));
    expect(readFileSync(target)).toEqual(binary);
    await registry.abort(sink.id);
    expect(readFileSync(target)).toEqual(binary);
    expect(readdirSync(directory)).toEqual(['out.mp4']);
    expect(io.handles[0].fd).toBe(-1);
  });

  it('publishes complete short writes and positional header patches only after sync and close', async () => {
    io.writeLimit = 2;
    const registry = new ExportSinkRegistry();
    const sink = await registry.open(target);
    await Promise.all([
      registry.write(sink.id, 0, Buffer.from('....')),
      registry.write(sink.id, 4, Buffer.from('BODY')),
      registry.write(sink.id, 0, Buffer.from('HEAD')),
    ]);
    expect(readFileSync(target, 'utf8')).toBe(previous);
    await registry.close(sink.id);
    expect(readFileSync(target, 'utf8')).toBe('HEADBODY');
    expect(io.events.slice(-3)).toEqual(['sync', 'close', 'rename']);
    expect(readdirSync(directory)).toEqual(['out.mp4']);
  });

  it('snapshots queued caller buffers and seals immediately when close is admitted', async () => {
    const gate = deferred();
    io.writeGate = gate.promise;
    const registry = new ExportSinkRegistry();
    const sink = await registry.open(target);
    const first = registry.write(sink.id, 0, Buffer.from('HEAD'));
    const reused = Buffer.from('BODY');
    const second = registry.write(sink.id, 4, reused);
    reused.fill(0);
    const closing = registry.close(sink.id);
    await expect(registry.write(sink.id, 0, Buffer.from('late'))).rejects.toThrow(/closing/);
    expect(registry.isOpen(sink.id)).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe(previous);
    gate.resolve();
    await Promise.all([first, second, closing]);
    expect(readFileSync(target, 'utf8')).toBe('HEADBODY');
  });

  it('lets an accepted close finish and rejects late cancellation without deleting its output', async () => {
    const gate = deferred();
    io.syncGate = gate.promise;
    const registry = new ExportSinkRegistry();
    const sink = await registry.open(target);
    await registry.write(sink.id, 0, Buffer.from('done'));
    const closing = registry.close(sink.id);
    const joined = registry.close(sink.id);
    await untilEvent('sync');
    await expect(registry.abort(sink.id)).rejects.toThrow(/closing/);
    await expect(registry.open(target)).rejects.toThrow(/already active/);
    expect(registry.isOpen(sink.id)).toBe(true);
    gate.resolve();
    await Promise.all([closing, joined]);
    await expect(registry.abort(sink.id)).rejects.toThrow(/Unknown/);
    expect(readFileSync(target, 'utf8')).toBe('done');
  });

  it('lets an accepted abort drain admitted IO and rejects close or new writes', async () => {
    const gate = deferred();
    io.writeGate = gate.promise;
    const registry = new ExportSinkRegistry();
    const sink = await registry.open(target);
    const writing = registry.write(sink.id, 0, Buffer.from('partial'));
    const aborting = registry.abort(sink.id);
    const joined = registry.abort(sink.id);
    await expect(registry.close(sink.id)).rejects.toThrow(/aborting/);
    await expect(registry.write(sink.id, 0, Buffer.from('late'))).rejects.toThrow(/aborting/);
    gate.resolve();
    await Promise.all([writing, aborting, joined]);
    expectClean(registry, sink.id);
    expect(io.events).not.toContain('rename');
  });

  it.each(['zero', 'write', 'chmod', 'sync', 'close', 'rename'] as const)('cleans up a %s failure without changing prior output', async (failure) => {
    const registry = new ExportSinkRegistry();
    const sink = await registry.open(target);
    const fd = io.handles[0].fd;
    const error = new Error(`synthetic ${failure} failure`);
    if (failure === 'zero') io.zeroWrite = true;
    if (failure === 'write') io.writeError = error;
    if (failure === 'chmod') io.chmodError = error;
    if (failure === 'sync') io.syncError = error;
    if (failure === 'close') io.closeErrors = [error];
    if (failure === 'rename') io.renameError = error;
    if (failure === 'zero' || failure === 'write') {
      const writing = registry.write(sink.id, 0, Buffer.from('bad'));
      const closing = registry.close(sink.id);
      await expect(writing).rejects.toThrow(failure === 'zero' ? /progress/ : error.message);
      await expect(closing).rejects.toThrow(failure === 'zero' ? /progress/ : error.message);
    } else {
      await registry.write(sink.id, 0, Buffer.from('bad'));
      await expect(registry.close(sink.id)).rejects.toThrow(error.message);
    }
    expect(() => fstatSync(fd)).toThrow();
    expectClean(registry, sink.id);
  });

  it('retains cleanup ownership and evidence until abort retry succeeds; close never retries publication', async () => {
    const registry = new ExportSinkRegistry();
    const sink = await registry.open(target);
    io.syncError = new Error('source flush failed');
    io.unlinkError = new Error('temporary cleanup refused');
    const failure = await registry.close(sink.id).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as Error).message).toContain('source flush failed');
    expect((failure as Error).message).toContain('temporary cleanup refused');
    const causes = (failure as AggregateError).errors;
    expect(causes[0]).toBe(io.syncError);
    expect(causes[1]).toBeInstanceOf(AggregateError);
    expect(registry.isOpen(sink.id)).toBe(true);
    expect(io.handles[0].fd).toBe(-1);
    await expect(registry.close(sink.id)).rejects.toThrow('source flush failed');
    await expect(registry.open(target)).rejects.toThrow(/already active/);
    io.unlinkError = null;
    await registry.abort(sink.id);
    expectClean(registry, sink.id);
    expect(io.events).not.toContain('rename');
  });

  it('keeps a pre-close failure addressable until abort retry actually releases the handle', async () => {
    const registry = new ExportSinkRegistry();
    const sink = await registry.open(target);
    io.closeErrors = [new Error('initial close refused'), new Error('cleanup close refused')];
    await expect(registry.close(sink.id)).rejects.toThrow(/initial close refused.*cleanup close refused/);
    expect(registry.isOpen(sink.id)).toBe(true);
    expect(io.handles[0].fd).not.toBe(-1);
    expect(readFileSync(target, 'utf8')).toBe(previous);
    await registry.abort(sink.id);
    expectClean(registry, sink.id);
    expect(io.events).not.toContain('rename');
  });

  it('rejects all queued writes after the first failure without using the released descriptor', async () => {
    const registry = new ExportSinkRegistry();
    const sink = await registry.open(target);
    io.writeError = new Error('first write failed');
    const first = registry.write(sink.id, 0, Buffer.from('first'));
    const second = registry.write(sink.id, 5, Buffer.from('second'));
    await expect(first).rejects.toThrow('first write failed');
    await expect(second).rejects.toThrow('first write failed');
    expect(io.events.filter((event) => event.startsWith('write:'))).toEqual(['write:0']);
    expectClean(registry, sink.id);
  });

  it('does not retry a consumed native close or close a replacement descriptor', async () => {
    const registry = new ExportSinkRegistry();
    const sink = await registry.open(target);
    let replacement = -1;
    io.afterClose = () => { replacement = openSync(path.join(directory, 'replacement'), 'w'); };
    io.closeAfterError = new Error('native close reported a failure after consuming ownership');
    try {
      await expect(registry.close(sink.id)).rejects.toThrow('native close reported');
      expect(fstatSync(replacement).isFile()).toBe(true);
      expect(io.events.filter((event) => event === 'close')).toHaveLength(1);
      expect(readFileSync(target, 'utf8')).toBe(previous);
      expect(readdirSync(directory).sort()).toEqual(['out.mp4', 'replacement']);
      expect(registry.isOpen(sink.id)).toBe(false);
    } finally {
      if (replacement !== -1) closeSync(replacement);
    }
  });

  it('reserves pending opens against the cap and excludes the same target before any await', async () => {
    const gate = deferred();
    io.openGate = gate.promise;
    const registry = new ExportSinkRegistry();
    const first = registry.open(target);
    await expect(registry.open(target)).rejects.toThrow(/already active/);
    const opening = [first];
    for (let i = 1; i < MAX_CONCURRENT_EXPORT_SINKS; i += 1) opening.push(registry.open(path.join(directory, `out-${i}.mp4`)));
    await expect(registry.open(path.join(directory, 'overflow.mp4'))).rejects.toThrow(/concurrent/);
    expect(io.handles).toHaveLength(0);
    gate.resolve();
    const sinks = await Promise.all(opening);
    for (const sink of sinks) await registry.abort(sink.id);
    expect(readdirSync(directory)).toEqual(['out.mp4']);
  });

  it('publishes one destination while another independently owned sink remains open', async () => {
    const other = path.join(directory, 'other.mp4');
    writeFileSync(other, 'other prior export');
    const registry = new ExportSinkRegistry();
    const first = await registry.open(target);
    const second = await registry.open(other);
    await registry.write(first.id, 0, Buffer.from('done'));
    await registry.write(second.id, 0, Buffer.from('partial'));
    await registry.close(first.id);
    expect(readFileSync(target, 'utf8')).toBe('done');
    expect(readFileSync(other, 'utf8')).toBe('other prior export');
    expect(registry.isOpen(second.id)).toBe(true);
    await registry.abort(second.id);
    expect(readdirSync(directory).sort()).toEqual(['other.mp4', 'out.mp4']);
  });

  it.skipIf(process.platform !== 'darwin' && process.platform !== 'win32')('excludes case aliases while a destination is reserved', async () => {
    const registry = new ExportSinkRegistry();
    const sink = await registry.open(target);
    await expect(registry.open(path.join(directory, 'OUT.MP4'))).rejects.toThrow(/already active/);
    await registry.abort(sink.id);
    expectClean(registry, sink.id);
  });

  it('releases claims after failed open so a fresh export can retry', async () => {
    const registry = new ExportSinkRegistry();
    const missing = path.join(directory, 'missing', 'out.mp4');
    await expect(registry.open(missing)).rejects.toThrow();
    mkdirSync(path.dirname(missing));
    const retried = await registry.open(missing);
    await registry.abort(retried.id);
    rmSync(path.dirname(missing), { recursive: true });
    const sink = await registry.open(target);
    await registry.abort(sink.id);
    expectClean(registry, sink.id);
  });

  it('never removes an unowned file when exclusive temporary creation fails', async () => {
    const registry = new ExportSinkRegistry();
    io.collideTemp = true;
    await expect(registry.open(target)).rejects.toThrow();
    const collision = readdirSync(directory).find((name) => name.endsWith('.tmp'))!;
    expect(readFileSync(path.join(directory, collision), 'utf8')).toBe('unowned temporary sentinel');
    expect(readFileSync(target, 'utf8')).toBe(previous);
    io.collideTemp = false;
    const retry = await registry.open(target);
    await registry.abort(retry.id);
    expect(readFileSync(path.join(directory, collision), 'utf8')).toBe('unowned temporary sentinel');
  });

  it('follows existing file symlinks, excludes their canonical target, and keeps the selected path identity', async (context) => {
    const link = path.join(directory, 'link.mp4');
    try { symlinkSync(target, link, 'file'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') context.skip();
      throw error;
    }
    const registry = new ExportSinkRegistry();
    const sink = await registry.open(link);
    expect(sink.path).toBe(link);
    await expect(registry.open(target)).rejects.toThrow(/already active/);
    await registry.write(sink.id, 0, Buffer.from('replaced'));
    await registry.close(sink.id);
    expect(readFileSync(link, 'utf8')).toBe('replaced');
    expect(readFileSync(target, 'utf8')).toBe('replaced');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readdirSync(directory).sort()).toEqual(['link.mp4', 'out.mp4']);
  });

  it('rejects dangling symlinks and directories without changing either', async (context) => {
    const link = path.join(directory, 'link.mp4');
    try { symlinkSync(path.join(directory, 'missing.mp4'), link, 'file'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') context.skip();
      throw error;
    }
    const registry = new ExportSinkRegistry();
    await expect(registry.open(link)).rejects.toThrow(/symlink/);
    await expect(registry.open(directory)).rejects.toThrow(/regular file/);
    expect(readFileSync(target, 'utf8')).toBe(previous);
    expect(readdirSync(directory).sort()).toEqual(['link.mp4', 'out.mp4']);
    expect(existsSync(link)).toBe(false); // The dangling link itself is retained.
  });

  it('replaces only the selected hard-link entry, leaving aliases on the prior inode', async () => {
    const alias = path.join(directory, 'alias.mp4');
    linkSync(target, alias);
    const registry = new ExportSinkRegistry();
    const sink = await registry.open(target);
    await registry.write(sink.id, 0, Buffer.from('replacement'));
    await registry.close(sink.id);
    expect(readFileSync(target, 'utf8')).toBe('replacement');
    expect(readFileSync(alias, 'utf8')).toBe(previous);
  });

  it.skipIf(process.platform === 'win32')('preserves existing mode bits and normal creation mode for new files', async () => {
    const registry = new ExportSinkRegistry();
    chmodSync(target, 0o640);
    const sink = await registry.open(target);
    await registry.write(sink.id, 0, Buffer.from('replacement'));
    await registry.close(sink.id);
    expect(statSync(target).mode & 0o777).toBe(0o640);
    const created = path.join(directory, 'created.mp4');
    const newSink = await registry.open(created);
    await registry.close(newSink.id);
    expect(statSync(created).mode & 0o777).toBe(0o666 & ~process.umask());
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('refuses an existing read-only destination', async () => {
    const registry = new ExportSinkRegistry();
    chmodSync(target, 0o400);
    await expect(registry.open(target)).rejects.toThrow();
    expect(readFileSync(target, 'utf8')).toBe(previous);
    expect(readdirSync(directory)).toEqual(['out.mp4']);
  });

  it('retirement fences new work synchronously, coalesces, and drains admitted writes before aborting', async () => {
    const gate = deferred();
    io.writeGate = gate.promise;
    const registry = new ExportSinkRegistry();
    const sink = await registry.open(target);
    const writing = registry.write(sink.id, 0, Buffer.from('partial'));
    const retiring = registry.retire();
    expect(registry.retire()).toBe(retiring);
    await expect(registry.open(path.join(directory, 'late.mp4'))).rejects.toThrow(/retired/);
    await expect(registry.write(sink.id, 0, Buffer.from('late'))).rejects.toThrow(/retired/);
    await expect(registry.close(sink.id)).rejects.toThrow(/retired/);
    const aborting = registry.abort(sink.id); // Cleanup joins the retirement drain.
    expect(readFileSync(target, 'utf8')).toBe(previous);
    gate.resolve();
    await Promise.all([writing, aborting, retiring]);
    expectClean(registry, sink.id);
    expect(io.events.filter((event) => event === 'close')).toHaveLength(1);
    expect(io.events).not.toContain('rename');
    expect(registry.retire()).toBe(retiring);
  });

  it('retirement awaits an accepted close while aborting other live destinations', async () => {
    const gate = deferred();
    io.syncGate = gate.promise;
    const other = path.join(directory, 'other.mp4');
    writeFileSync(other, 'other successful export');
    const registry = new ExportSinkRegistry();
    const committing = await registry.open(target);
    const abandoned = await registry.open(other);
    await registry.write(committing.id, 0, Buffer.from('committed'));
    await registry.write(abandoned.id, 0, Buffer.from('partial'));
    const closing = registry.close(committing.id);
    const retiring = registry.retire();
    await untilEvent('sync');
    await expect(registry.abort(committing.id)).rejects.toThrow(/closing/);
    expect(readFileSync(target, 'utf8')).toBe(previous);
    gate.resolve();
    await Promise.all([closing, retiring]);
    expect(readFileSync(target, 'utf8')).toBe('committed');
    expect(readFileSync(other, 'utf8')).toBe('other successful export');
    expect(io.handles.every((handle) => handle.fd === -1)).toBe(true);
    expect(readdirSync(directory).sort()).toEqual(['other.mp4', 'out.mp4']);
  });

  it('retirement prevents a pending metadata/open request from creating an orphan sink', async () => {
    const registry = new ExportSinkRegistry();
    const opening = registry.open(target).catch((error: unknown) => error);
    const retiring = registry.retire();
    await retiring;
    expect(await opening).toBeInstanceOf(Error);
    expect((await opening as Error).message).toMatch(/retired/);
    expect(io.handles).toHaveLength(0);
    expect(io.events).not.toContain('open');
    expect(readFileSync(target, 'utf8')).toBe(previous);
    expect(readdirSync(directory)).toEqual(['out.mp4']);
  });

  it('retirement owns an open that completes after the fence, including a failed-open cleanup retry', async () => {
    const gate = deferred();
    io.openGate = gate.promise;
    const registry = new ExportSinkRegistry();
    const opening = registry.open(target).catch((error: unknown) => error);
    await untilEvent('open');
    const retiring = registry.retire();
    io.closeErrors = [new Error('first cleanup close refused')];
    gate.resolve();
    await retiring;
    const error = await opening;
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as Error).message).toMatch(/retired.*first cleanup close refused/);
    expect(io.handles).toHaveLength(1);
    expect(io.handles[0].fd).toBe(-1);
    expect(readFileSync(target, 'utf8')).toBe(previous);
    expect(readdirSync(directory)).toEqual(['out.mp4']);
  });

  it('retirement reports cleanup refusal and permits explicit retry without reopening admission', async () => {
    const registry = new ExportSinkRegistry();
    const sink = await registry.open(target);
    io.unlinkError = new Error('retirement cleanup refused');
    const first = registry.retire();
    await expect(first).rejects.toThrow(/retirement cleanup refused/);
    expect(registry.isOpen(sink.id)).toBe(true);
    await expect(registry.open(target)).rejects.toThrow(/retired/);
    io.unlinkError = null;
    const retry = registry.retire();
    expect(retry).not.toBe(first);
    await retry;
    expectClean(registry, sink.id);
    await expect(registry.open(target)).rejects.toThrow(/retired/);
  });

  it('retirement preserves accepted close failure and never retries its publication', async () => {
    const registry = new ExportSinkRegistry();
    const sink = await registry.open(target);
    io.syncError = new Error('accepted export flush failed');
    const closing = registry.close(sink.id).catch((error: unknown) => error);
    const retiring = registry.retire().catch((error: unknown) => error);
    expect(await closing).toBe(io.syncError);
    const failure = await retiring;
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toContain(io.syncError);
    await registry.retire(); // Cleanup already completed; retry only drains ownership.
    expectClean(registry, sink.id);
    expect(io.events).not.toContain('rename');
  });

  it('an old registry retirement cannot fence a fresh renderer owner', async () => {
    const old = new ExportSinkRegistry();
    const abandoned = await old.open(target);
    await old.retire();
    expect(old.isOpen(abandoned.id)).toBe(false);
    const replacement = new ExportSinkRegistry();
    const current = await replacement.open(target);
    await old.retire(); // Late old close/quit/destroy notification stays with its owner.
    await replacement.write(current.id, 0, Buffer.from('fresh renderer export'));
    await replacement.close(current.id);
    expect(readFileSync(target, 'utf8')).toBe('fresh renderer export');
    expect(io.handles.every((handle) => handle.fd === -1)).toBe(true);
  });
});
