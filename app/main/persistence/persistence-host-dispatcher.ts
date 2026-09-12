import {
  cloneForPersistenceTransport,
  isPersistenceMethodName,
  serializePersistenceError,
  type PersistenceHostCommand,
  type PersistenceHostEvent,
  type PersistenceMethodName,
  type PersistenceProgressPayload,
  type PersistenceRepositoryOptions,
} from './persistence-protocol';

export type PersistenceRepository = Record<PersistenceMethodName, (...args: unknown[]) => unknown>;

export interface PersistenceRepositoryHandle {
  repository: PersistenceRepository;
  close: () => void | Promise<void>;
}

export interface PersistenceHostDispatcherOptions {
  createRepository: (
    options: PersistenceRepositoryOptions,
    onProgress: (progress: PersistenceProgressPayload) => void,
  ) => PersistenceRepositoryHandle | Promise<PersistenceRepositoryHandle>;
  emit: (event: PersistenceHostEvent) => void;
}

const PROGRESS_METHODS = new Set<PersistenceMethodName>([
  'restoreProjectBackup',
  'restoreFromSnapshot',
  'finalizeImportBundle',
  'exportProjectBackup',
]);

export class PersistenceHostDispatcher {
  private readonly createRepository: PersistenceHostDispatcherOptions['createRepository'];
  private readonly emit: PersistenceHostDispatcherOptions['emit'];
  private handle: PersistenceRepositoryHandle | null = null;
  private tail: Promise<void> = Promise.resolve();
  private initializationAttempted = false;
  private shutdownRequested = false;

  constructor(options: PersistenceHostDispatcherOptions) {
    this.createRepository = options.createRepository;
    this.emit = options.emit;
  }

  accept(command: PersistenceHostCommand): void {
    if (this.shutdownRequested) {
      if (command.type === 'call') {
        this.emit({
          type: 'error',
          requestId: command.requestId,
          error: serializePersistenceError(new Error('Persistence host is shutting down')),
        });
      }
      return;
    }
    if (command.type === 'shutdown') this.shutdownRequested = true;

    this.tail = this.tail.then(async () => {
      switch (command.type) {
        case 'initialize':
          await this.initialize(command.options);
          return;
        case 'call':
          await this.execute(command.requestId, command.method, command.args);
          return;
        case 'shutdown':
          await this.close(command.requestId);
      }
    }).catch((error: unknown) => {
      this.emit({ type: 'fatal', error: serializePersistenceError(error) });
    });
  }

  whenIdle(): Promise<void> {
    return this.tail;
  }

  private async initialize(options: PersistenceRepositoryOptions): Promise<void> {
    if (this.initializationAttempted) throw new Error('Persistence host was initialized more than once');
    this.initializationAttempted = true;
    this.emitProgress(undefined, 'initialize', 'opening', 0, 1);
    try {
      this.handle = await this.createRepository(options, (progress) => {
        this.emit({ type: 'progress', progress });
      });
      this.emitProgress(undefined, 'initialize', 'ready', 1, 1);
      this.emit({ type: 'ready' });
    } catch (error) {
      this.emit({ type: 'fatal', error: serializePersistenceError(error) });
    }
  }

  private async execute(requestId: number, method: string, args: unknown[]): Promise<void> {
    try {
      if (!this.handle) throw new Error('Persistence host is not ready');
      if (!isPersistenceMethodName(method)) throw new TypeError(`Unsupported persistence method: ${method}`);
      const operation = this.handle.repository[method];
      if (typeof operation !== 'function') throw new TypeError(`Persistence method is unavailable: ${method}`);
      if (PROGRESS_METHODS.has(method)) this.emitProgress(requestId, method, 'running', 0, 1);
      const operationArgs = method === 'restoreProjectBackup'
        ? [args[0], {
          onProgress: (progress: PersistenceProgressPayload) => {
            this.emit({ type: 'progress', requestId, progress });
          },
        }]
        : args;
      const result = await operation.apply(this.handle.repository, operationArgs);
      const cloned = cloneForPersistenceTransport(result, `${method} result`);
      if (PROGRESS_METHODS.has(method)) this.emitProgress(requestId, method, 'complete', 1, 1);
      this.emit({ type: 'result', requestId, result: cloned });
    } catch (error) {
      this.emit({ type: 'error', requestId, error: serializePersistenceError(error) });
    }
  }

  private async close(requestId: number): Promise<void> {
    if (this.handle) {
      const handle = this.handle;
      this.handle = null;
      await handle.close();
    }
    this.emit({ type: 'closed', requestId });
  }

  private emitProgress(
    requestId: number | undefined,
    operation: 'initialize' | PersistenceMethodName,
    phase: string,
    completed: number,
    total: number,
  ): void {
    this.emit({
      type: 'progress',
      ...(requestId === undefined ? {} : { requestId }),
      progress: { operation, phase, completed, total },
    });
  }
}
