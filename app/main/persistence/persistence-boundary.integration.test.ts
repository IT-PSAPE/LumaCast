// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CastRepository } from '@lumacast/persistence-sqlite';
import type { Id } from '@lumacast/kernel';
import { PersistenceHostDispatcher, type PersistenceRepository } from './persistence-host-dispatcher';
import type { PersistenceHostCommand, PersistenceHostEvent, PersistenceProgress } from './persistence-protocol';
import { PersistenceServiceProxy, type PersistenceHostTransport } from './persistence-service-proxy';

class LoopbackPersistenceTransport implements PersistenceHostTransport {
  private readonly messageListeners = new Set<(event: PersistenceHostEvent) => void>();
  private readonly exitListeners = new Set<(code: number | null) => void>();
  private readonly dispatcher: PersistenceHostDispatcher;

  constructor() {
    this.dispatcher = new PersistenceHostDispatcher({
      createRepository: (options, onProgress) => {
        const repository = new CastRepository({ ...options, onProgress });
        return {
          repository: repository as unknown as PersistenceRepository,
          close: () => repository.close(),
        };
      },
      emit: (event) => {
        const cloned = structuredClone(event);
        queueMicrotask(() => {
          for (const listener of this.messageListeners) listener(cloned);
        });
      },
    });
  }

  postMessage(command: PersistenceHostCommand): void {
    const cloned = structuredClone(command);
    queueMicrotask(() => this.dispatcher.accept(cloned));
  }

  onMessage(listener: (event: PersistenceHostEvent) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onExit(listener: (code: number | null) => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  kill(): void {
    // The dispatcher has already closed the real repository before the proxy
    // terminates a production utility process.
  }
}

describe('real repository persistence boundary', () => {
  let tempRoot: string | null = null;
  let proxy: PersistenceServiceProxy | null = null;

  afterEach(async () => {
    await proxy?.destroy(2_000);
    proxy = null;
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  });

  function createProxy(): PersistenceServiceProxy {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-persistence-boundary-'));
    proxy = new PersistenceServiceProxy({
      transport: new LoopbackPersistenceTransport(),
      repositoryOptions: {
        dbPath: path.join(tempRoot, 'lumacast.sqlite'),
        userDataPath: tempRoot,
        documentsPath: tempRoot,
      },
    });
    return proxy;
  }

  it('reports first-launch migrations while calls wait for readiness', async () => {
    const service = createProxy();
    const progress: PersistenceProgress[] = [];
    service.onProgress((event) => progress.push(event));

    const snapshot = await service.getSnapshot();

    expect(snapshot.presentations.length).toBeGreaterThan(0);
    expect(progress).toContainEqual(expect.objectContaining({ operation: 'initialize', phase: 'opening' }));
    expect(progress).toContainEqual(expect.objectContaining({ operation: 'initialize', phase: 'migration' }));
    expect(progress).toContainEqual(expect.objectContaining({ operation: 'initialize', phase: 'ready' }));
  });

  it('keeps a failed batch transaction atomic and serializes a concurrent read after it', async () => {
    const service = createProxy();
    const before = await service.getSnapshot();
    const element = before.slideElements[0];
    expect(element).toBeDefined();

    const mutation = service.updateElementsBatch([
      { id: element!.id, x: element!.x + 100 },
      { id: 'missing-element' as Id, x: 0 },
    ]);
    const readQueuedAfterMutation = service.getSnapshot();

    await expect(mutation).rejects.toThrow('Slide element not found');
    const after = await readQueuedAfterMutation;
    expect(after.slideElements.find((candidate) => candidate.id === element!.id)?.x).toBe(element!.x);
  });
});
