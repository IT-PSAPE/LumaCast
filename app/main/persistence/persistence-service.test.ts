import { describe, expect, it, vi } from 'vitest';
import type { RepositoryOptions } from '@lumacast/persistence-sqlite';
import {
  PersistenceHostDispatcher,
  type PersistenceRepository,
} from './persistence-host-dispatcher';
import {
  PersistenceServiceProxy,
  type PersistenceHostTransport,
} from './persistence-service-proxy';
import type {
  PersistenceHostEvent,
  PersistenceHostCommand,
  PersistenceProgress,
} from './persistence-protocol';

const repositoryOptions: RepositoryOptions = {
  dbPath: '/tmp/lumacast.sqlite',
  userDataPath: '/tmp/user-data',
  documentsPath: '/tmp/documents',
  seed: false,
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

class FakeTransport implements PersistenceHostTransport {
  readonly sent: PersistenceHostCommand[] = [];
  killed = false;
  throwOnSend: Error | null = null;
  private messageListeners: Array<(event: PersistenceHostEvent) => void> = [];
  private exitListeners: Array<(code: number | null) => void> = [];

  postMessage(message: PersistenceHostCommand): void {
    if (this.throwOnSend) throw this.throwOnSend;
    this.sent.push(message);
  }

  onMessage(listener: (event: PersistenceHostEvent) => void): () => void {
    this.messageListeners.push(listener);
    return () => {
      this.messageListeners = this.messageListeners.filter((candidate) => candidate !== listener);
    };
  }

  onExit(listener: (code: number | null) => void): () => void {
    this.exitListeners.push(listener);
    return () => {
      this.exitListeners = this.exitListeners.filter((candidate) => candidate !== listener);
    };
  }

  kill(): void {
    this.killed = true;
  }

  emit(event: PersistenceHostEvent): void {
    for (const listener of this.messageListeners) listener(event);
  }

  exit(code: number | null): void {
    for (const listener of this.exitListeners) listener(code);
  }
}

describe('PersistenceHostDispatcher', () => {
  it('serializes repository calls so a later call cannot observe an in-flight mutation', async () => {
    const first = deferred<string>();
    const order: string[] = [];
    const repository = {
      createPlaylist: async (name: string) => {
        order.push(`start:${name}`);
        const result = await first.promise;
        order.push(`finish:${name}`);
        return result;
      },
      getSnapshot: () => {
        order.push('snapshot');
        return { presentations: [] };
      },
    } as unknown as PersistenceRepository;
    const events: PersistenceHostEvent[] = [];
    const dispatcher = new PersistenceHostDispatcher({
      createRepository: () => ({ repository, close: vi.fn() }),
      emit: (event) => events.push(event),
    });

    dispatcher.accept({ type: 'initialize', options: repositoryOptions });
    dispatcher.accept({ type: 'call', requestId: 1, method: 'createPlaylist', args: ['First'] });
    dispatcher.accept({ type: 'call', requestId: 2, method: 'getSnapshot', args: [] });
    await flushMicrotasks();

    expect(order).toEqual(['start:First']);
    first.resolve('mutation-result');
    await dispatcher.whenIdle();
    expect(order).toEqual(['start:First', 'finish:First', 'snapshot']);
    expect(events).toContainEqual({ type: 'result', requestId: 1, result: 'mutation-result' });
    expect(events).toContainEqual({ type: 'result', requestId: 2, result: { presentations: [] } });
  });

  it('rejects methods outside the explicit repository vocabulary without invoking them', async () => {
    const dropDatabase = vi.fn();
    const repository = { dropDatabase } as unknown as PersistenceRepository;
    const events: PersistenceHostEvent[] = [];
    const dispatcher = new PersistenceHostDispatcher({
      createRepository: () => ({ repository, close: vi.fn() }),
      emit: (event) => events.push(event),
    });

    dispatcher.accept({ type: 'initialize', options: repositoryOptions });
    dispatcher.accept({
      type: 'call',
      requestId: 3,
      method: 'dropDatabase' as never,
      args: [],
    });
    await dispatcher.whenIdle();

    expect(dropDatabase).not.toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({
      type: 'error',
      requestId: 3,
      error: expect.objectContaining({ name: 'TypeError' }),
    }));
  });

  it('turns an uncloneable repository result into a request error and continues the queue', async () => {
    const repository = {
      getSnapshot: vi.fn()
        .mockReturnValueOnce({ invalid: () => undefined })
        .mockReturnValueOnce({ presentations: [] }),
    } as unknown as PersistenceRepository;
    const events: PersistenceHostEvent[] = [];
    const dispatcher = new PersistenceHostDispatcher({
      createRepository: () => ({ repository, close: vi.fn() }),
      emit: (event) => events.push(event),
    });

    dispatcher.accept({ type: 'initialize', options: repositoryOptions });
    dispatcher.accept({ type: 'call', requestId: 4, method: 'getSnapshot', args: [] });
    dispatcher.accept({ type: 'call', requestId: 5, method: 'getSnapshot', args: [] });
    await dispatcher.whenIdle();

    expect(events).toContainEqual(expect.objectContaining({ type: 'error', requestId: 4 }));
    expect(events).toContainEqual({ type: 'result', requestId: 5, result: { presentations: [] } });
  });

  it('serializes FutureSchemaVersionError metadata during initialization', async () => {
    const events: PersistenceHostEvent[] = [];
    const error = Object.assign(new Error('newer schema'), {
      name: 'FutureSchemaVersionError',
      foundVersion: 42,
      supportedVersion: 29,
    });
    const dispatcher = new PersistenceHostDispatcher({
      createRepository: () => { throw error; },
      emit: (event) => events.push(event),
    });

    dispatcher.accept({ type: 'initialize', options: repositoryOptions });
    await dispatcher.whenIdle();

    expect(events).toContainEqual({
      type: 'fatal',
      error: expect.objectContaining({
        name: 'FutureSchemaVersionError',
        foundVersion: 42,
        supportedVersion: 29,
      }),
    });
  });

  it('never retries initialization after a fatal startup failure', async () => {
    const events: PersistenceHostEvent[] = [];
    const createRepository = vi.fn(() => { throw new Error('migration failed'); });
    const dispatcher = new PersistenceHostDispatcher({
      createRepository,
      emit: (event) => events.push(event),
    });

    dispatcher.accept({ type: 'initialize', options: repositoryOptions });
    dispatcher.accept({ type: 'initialize', options: repositoryOptions });
    await dispatcher.whenIdle();

    expect(createRepository).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.type === 'ready')).toHaveLength(0);
  });

  it('waits for an active restore before closing and acknowledging shutdown', async () => {
    const restore = deferred<void>();
    const order: string[] = [];
    const repository = {
      restoreProjectBackup: async () => {
        order.push('restore');
        await restore.promise;
      },
    } as unknown as PersistenceRepository;
    const events: PersistenceHostEvent[] = [];
    const dispatcher = new PersistenceHostDispatcher({
      createRepository: () => ({
        repository,
        close: () => { order.push('close'); },
      }),
      emit: (event) => events.push(event),
    });

    dispatcher.accept({ type: 'initialize', options: repositoryOptions });
    dispatcher.accept({ type: 'call', requestId: 6, method: 'restoreProjectBackup', args: [{}] });
    dispatcher.accept({ type: 'shutdown', requestId: 7 });
    await flushMicrotasks();
    expect(order).toEqual(['restore']);

    restore.resolve();
    await dispatcher.whenIdle();
    expect(order).toEqual(['restore', 'close']);
    expect(events.at(-1)).toEqual({ type: 'closed', requestId: 7 });
  });

  it('emits initialization and long-operation progress with request identity', async () => {
    const repository = {
      restoreProjectBackup: () => ({ snapshot: {}, retainedDatabasePath: '/tmp/old.sqlite' }),
    } as unknown as PersistenceRepository;
    const events: PersistenceHostEvent[] = [];
    const dispatcher = new PersistenceHostDispatcher({
      createRepository: () => ({ repository, close: vi.fn() }),
      emit: (event) => events.push(event),
    });

    dispatcher.accept({ type: 'initialize', options: repositoryOptions });
    dispatcher.accept({ type: 'call', requestId: 8, method: 'restoreProjectBackup', args: [{}] });
    await dispatcher.whenIdle();

    expect(events).toContainEqual(expect.objectContaining({
      type: 'progress',
      progress: { operation: 'initialize', phase: 'opening', completed: 0, total: 1 },
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'progress',
      requestId: 8,
      progress: { operation: 'restoreProjectBackup', phase: 'running', completed: 0, total: 1 },
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'progress',
      requestId: 8,
      progress: { operation: 'restoreProjectBackup', phase: 'complete', completed: 1, total: 1 },
    }));
  });

  it('forwards detailed repository restore progress through the active request', async () => {
    const repository = {
      restoreProjectBackup: (_backup: unknown, options: { onProgress: (progress: { operation: 'restoreProjectBackup'; phase: string; completed: number; total: number }) => void }) => {
        options.onProgress({ operation: 'restoreProjectBackup', phase: 'insertion', completed: 3, total: 6 });
        return { snapshot: {}, retainedDatabasePath: '/tmp/old.sqlite' };
      },
    } as unknown as PersistenceRepository;
    const events: PersistenceHostEvent[] = [];
    const dispatcher = new PersistenceHostDispatcher({
      createRepository: () => ({ repository, close: vi.fn() }),
      emit: (event) => events.push(event),
    });

    dispatcher.accept({ type: 'initialize', options: repositoryOptions });
    dispatcher.accept({ type: 'call', requestId: 9, method: 'restoreProjectBackup', args: [{}] });
    await dispatcher.whenIdle();

    expect(events).toContainEqual({
      type: 'progress',
      requestId: 9,
      progress: { operation: 'restoreProjectBackup', phase: 'insertion', completed: 3, total: 6 },
    });
  });
});

describe('PersistenceServiceProxy', () => {
  it('queues calls until ready, then sends them in call order with monotonic ids', async () => {
    const transport = new FakeTransport();
    const proxy = new PersistenceServiceProxy({ transport, repositoryOptions });
    const first = proxy.createPlaylist('One');
    const second = proxy.getSnapshot();

    expect(transport.sent).toEqual([{ type: 'initialize', options: repositoryOptions }]);
    transport.emit({ type: 'ready' });
    expect(transport.sent.slice(1)).toEqual([
      { type: 'call', requestId: 1, method: 'createPlaylist', args: ['One'] },
      { type: 'call', requestId: 2, method: 'getSnapshot', args: [] },
    ]);

    transport.emit({ type: 'result', requestId: 1, result: { patchVersion: 1 } });
    transport.emit({ type: 'result', requestId: 2, result: { presentations: [] } });
    await expect(first).resolves.toEqual({ patchVersion: 1 });
    await expect(second).resolves.toEqual({ presentations: [] });
  });

  it('rejects an uncloneable argument before posting it', async () => {
    const transport = new FakeTransport();
    const proxy = new PersistenceServiceProxy({ transport, repositoryOptions });
    transport.emit({ type: 'ready' });

    const result = proxy.restoreProjectBackup({ invalid: () => undefined } as never);

    await expect(result).rejects.toThrow(/structured clone/i);
    expect(transport.sent).toHaveLength(1);
  });

  it('cleans up a request when postMessage throws and enters a fatal state', async () => {
    const transport = new FakeTransport();
    const proxy = new PersistenceServiceProxy({ transport, repositoryOptions });
    transport.emit({ type: 'ready' });
    transport.throwOnSend = new Error('channel closed');

    await expect(proxy.getSnapshot()).rejects.toThrow('channel closed');
    expect(transport.killed).toBe(true);
    transport.throwOnSend = null;
    await expect(proxy.getSnapshot()).rejects.toThrow(/fatal/i);
  });

  it('rejects ready-waiting and in-flight calls after an unexpected host exit without replay', async () => {
    const transport = new FakeTransport();
    const onFatal = vi.fn();
    const proxy = new PersistenceServiceProxy({ transport, repositoryOptions, onFatal });
    const queued = proxy.createPlaylist('Before ready');
    transport.emit({ type: 'ready' });
    const inFlight = proxy.getSnapshot();
    const sentBeforeExit = [...transport.sent];

    transport.exit(9);

    await expect(queued).rejects.toThrow(/exited unexpectedly.*9/i);
    await expect(inFlight).rejects.toThrow(/exited unexpectedly.*9/i);
    expect(transport.sent).toEqual(sentBeforeExit);
    expect(onFatal).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/exited unexpectedly.*9/i) }));
  });

  it('forwards progress events to subscribers', () => {
    const transport = new FakeTransport();
    const proxy = new PersistenceServiceProxy({ transport, repositoryOptions });
    const seen: PersistenceProgress[] = [];
    const unsubscribe = proxy.onProgress((progress) => seen.push(progress));

    transport.emit({
      type: 'progress',
      requestId: 12,
      progress: { operation: 'restoreProjectBackup', phase: 'running', completed: 0, total: 1 },
    });
    unsubscribe();
    transport.emit({
      type: 'progress',
      requestId: 12,
      progress: { operation: 'restoreProjectBackup', phase: 'complete', completed: 1, total: 1 },
    });

    expect(seen).toEqual([{
      requestId: 12,
      operation: 'restoreProjectBackup',
      phase: 'running',
      completed: 0,
      total: 1,
    }]);
  });

  it('isolates progress observer failures from the persistence service', () => {
    const transport = new FakeTransport();
    const proxy = new PersistenceServiceProxy({ transport, repositoryOptions });
    const healthyListener = vi.fn();
    proxy.onProgress(() => { throw new Error('observer failed'); });
    proxy.onProgress(healthyListener);

    expect(() => transport.emit({
      type: 'progress',
      progress: { operation: 'initialize', phase: 'migration', completed: 1, total: 2 },
    })).not.toThrow();
    expect(healthyListener).toHaveBeenCalledOnce();
  });

  it('replays the latest progress to a late subscriber', () => {
    const transport = new FakeTransport();
    const proxy = new PersistenceServiceProxy({ transport, repositoryOptions });
    transport.emit({
      type: 'progress',
      progress: { operation: 'initialize', phase: 'migration', completed: 4, total: 8 },
    });
    const seen: PersistenceProgress[] = [];

    proxy.onProgress((progress) => seen.push(progress));

    expect(seen).toEqual([{ operation: 'initialize', phase: 'migration', completed: 4, total: 8 }]);
  });

  it('waits for the host to drain and close during graceful destroy', async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    const proxy = new PersistenceServiceProxy({ transport, repositoryOptions });
    transport.emit({ type: 'ready' });

    const destroying = proxy.destroy(500);
    expect(transport.sent.at(-1)).toEqual({ type: 'shutdown', requestId: 1 });
    expect(transport.killed).toBe(false);
    transport.emit({ type: 'closed', requestId: 1 });

    await destroying;
    expect(transport.killed).toBe(true);
    vi.useRealTimers();
  });

  it('flushes calls queued before ready ahead of a requested shutdown', async () => {
    const transport = new FakeTransport();
    const proxy = new PersistenceServiceProxy({ transport, repositoryOptions });
    const pending = proxy.createPlaylist('Queued');

    const destroying = proxy.destroy(500);
    expect(transport.sent).toEqual([{ type: 'initialize', options: repositoryOptions }]);
    transport.emit({ type: 'ready' });

    expect(transport.sent.slice(1)).toEqual([
      { type: 'call', requestId: 1, method: 'createPlaylist', args: ['Queued'] },
      { type: 'shutdown', requestId: 2 },
    ]);
    transport.emit({ type: 'result', requestId: 1, result: { patchVersion: 1 } });
    transport.emit({ type: 'closed', requestId: 2 });

    await expect(pending).resolves.toEqual({ patchVersion: 1 });
    await destroying;
  });

  it('never kills the host when the UI shutdown bound expires during an active restore', async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    const onShutdownDelayed = vi.fn();
    const proxy = new PersistenceServiceProxy({ transport, repositoryOptions, onShutdownDelayed });
    transport.emit({ type: 'ready' });
    const pending = proxy.restoreProjectBackup({} as never);
    const destroying = proxy.destroy(50);
    let destroyFinished = false;
    void destroying.then(() => { destroyFinished = true; });

    transport.emit({
      type: 'progress',
      requestId: 1,
      progress: { operation: 'restoreProjectBackup', phase: 'promotion', completed: 5, total: 6 },
    });

    await vi.advanceTimersByTimeAsync(50);

    expect(onShutdownDelayed).toHaveBeenCalledWith(50);
    expect(transport.killed).toBe(false);
    expect(destroyFinished).toBe(false);

    transport.emit({
      type: 'result',
      requestId: 1,
      result: { snapshot: {}, retainedDatabasePath: '/tmp/retained.sqlite' },
    });
    transport.emit({ type: 'closed', requestId: 2 });
    await expect(pending).resolves.toEqual({ snapshot: {}, retainedDatabasePath: '/tmp/retained.sqlite' });
    await expect(destroying).resolves.toBeUndefined();
    expect(transport.killed).toBe(true);
    vi.useRealTimers();
  });

  it('does not kill a possibly active restore when the shutdown message cannot be sent', async () => {
    const transport = new FakeTransport();
    const onShutdownDelayed = vi.fn();
    const proxy = new PersistenceServiceProxy({ transport, repositoryOptions, onShutdownDelayed });
    transport.emit({ type: 'ready' });
    const pending = proxy.restoreProjectBackup({} as never);
    const pendingRejection = expect(pending).rejects.toThrow('shutdown channel failed');
    transport.emit({
      type: 'progress',
      requestId: 1,
      progress: { operation: 'restoreProjectBackup', phase: 'promotion', completed: 5, total: 6 },
    });
    transport.throwOnSend = new Error('shutdown channel failed');

    const destroying = proxy.destroy(50);

    await pendingRejection;
    expect(onShutdownDelayed).toHaveBeenCalledWith(0);
    expect(transport.killed).toBe(false);
    transport.exit(1);
    await expect(destroying).resolves.toBeUndefined();
    expect(transport.killed).toBe(true);
  });

  it('rejects in-flight work if the host exits while graceful shutdown is draining', async () => {
    const transport = new FakeTransport();
    const proxy = new PersistenceServiceProxy({ transport, repositoryOptions });
    transport.emit({ type: 'ready' });
    const pending = proxy.getSnapshot();
    const pendingRejection = expect(pending).rejects.toThrow(/exited before graceful shutdown completed.*17/i);
    const destroying = proxy.destroy(500);

    transport.exit(17);

    await pendingRejection;
    await expect(destroying).resolves.toBeUndefined();
  });
});
