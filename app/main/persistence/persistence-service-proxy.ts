import {
  PERSISTENCE_METHODS,
  cloneForPersistenceTransport,
  deserializePersistenceError,
  type PersistenceHostCommand,
  type PersistenceHostEvent,
  type PersistenceMethodName,
  type PersistenceProgress,
  type PersistenceServiceLike,
  type PersistenceRepositoryOptions,
} from './persistence-protocol';

export interface PersistenceHostTransport {
  postMessage(command: PersistenceHostCommand): void;
  onMessage(listener: (event: PersistenceHostEvent) => void): () => void;
  onExit(listener: (code: number | null) => void): () => void;
  kill(): void;
}

export interface PersistenceServiceProxyOptions {
  transport: PersistenceHostTransport;
  repositoryOptions: PersistenceRepositoryOptions;
  onFatal?: (error: Error) => void;
  onShutdownDelayed?: (elapsedMs: number) => void;
}

interface PendingRequest {
  command: Extract<PersistenceHostCommand, { type: 'call' }>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  sent: boolean;
}

type ProgressListener = (progress: PersistenceProgress) => void;

export class PersistenceServiceProxy {
  private readonly transport: PersistenceHostTransport;
  private readonly onFatal: ((error: Error) => void) | undefined;
  private readonly onShutdownDelayed: ((elapsedMs: number) => void) | undefined;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly readyQueue: number[] = [];
  private readonly progressListeners = new Set<ProgressListener>();
  private latestProgress: PersistenceProgress | null = null;
  private nextRequestId = 1;
  private ready = false;
  private fatalError: Error | null = null;
  private destroying = false;
  private destroyed = false;
  private shutdownRequestId: number | null = null;
  private resolveDestroy: (() => void) | null = null;
  private destroyPromise: Promise<void> | null = null;
  private destroyTimer: ReturnType<typeof setTimeout> | null = null;
  private shutdownDelayReported = false;

  constructor(options: PersistenceServiceProxyOptions) {
    this.transport = options.transport;
    this.onFatal = options.onFatal;
    this.onShutdownDelayed = options.onShutdownDelayed;
    for (const method of PERSISTENCE_METHODS) {
      Object.defineProperty(this, method, {
        configurable: false,
        enumerable: false,
        value: (...args: unknown[]) => this.invoke(method, args),
      });
    }
    this.transport.onMessage((event) => this.handleEvent(event));
    this.transport.onExit((code) => this.handleExit(code));
    try {
      this.transport.postMessage({
        type: 'initialize',
        options: cloneForPersistenceTransport(options.repositoryOptions, 'Repository options'),
      });
    } catch (error) {
      this.enterFatal(error instanceof Error ? error : new Error(String(error)));
    }
  }

  onProgress(listener: ProgressListener): () => void {
    this.progressListeners.add(listener);
    if (this.latestProgress) this.notifyProgressListener(listener, this.latestProgress);
    return () => this.progressListeners.delete(listener);
  }

  destroy(timeoutMs = 2_000): Promise<void> {
    if (this.destroyPromise) return this.destroyPromise;
    this.destroying = true;
    if (this.fatalError) {
      this.finishDestroy();
      this.destroyPromise = Promise.resolve();
      return this.destroyPromise;
    }

    const requestId = this.nextRequestId++;
    this.shutdownRequestId = requestId;
    this.destroyPromise = new Promise<void>((resolve) => {
      this.resolveDestroy = resolve;
      this.destroyTimer = setTimeout(() => {
        this.reportShutdownDelay(timeoutMs);
      }, timeoutMs);
      if (this.ready) this.sendShutdown();
    });
    return this.destroyPromise;
  }

  private invoke(method: PersistenceMethodName, rawArgs: unknown[]): Promise<unknown> {
    if (this.fatalError) {
      return Promise.reject(new Error(`Persistence service is fatal: ${this.fatalError.message}`));
    }
    if (this.destroying) return Promise.reject(new Error('Persistence service is shutting down'));

    let args: unknown[];
    try {
      args = cloneForPersistenceTransport(rawArgs, `${method} arguments`);
    } catch (error) {
      return Promise.reject(error);
    }
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const request: PendingRequest = {
        command: { type: 'call', requestId, method, args },
        resolve,
        reject,
        sent: false,
      };
      this.pending.set(requestId, request);
      if (!this.ready) {
        this.readyQueue.push(requestId);
        return;
      }
      this.sendRequest(request);
    });
  }

  private sendRequest(request: PendingRequest): void {
    if (request.sent) return;
    request.sent = true;
    try {
      this.transport.postMessage(request.command);
    } catch (error) {
      const fatal = error instanceof Error ? error : new Error(String(error));
      this.enterFatal(fatal);
    }
  }

  private handleEvent(event: PersistenceHostEvent): void {
    if (this.fatalError && event.type !== 'closed') return;
    switch (event.type) {
      case 'ready':
        this.ready = true;
        for (const requestId of this.readyQueue.splice(0)) {
          const request = this.pending.get(requestId);
          if (request) this.sendRequest(request);
        }
        if (this.destroying) this.sendShutdown();
        break;
      case 'result': {
        const request = this.pending.get(event.requestId);
        if (!request) return;
        this.pending.delete(event.requestId);
        request.resolve(event.result);
        break;
      }
      case 'error': {
        const request = this.pending.get(event.requestId);
        if (!request) return;
        this.pending.delete(event.requestId);
        request.reject(deserializePersistenceError(event.error));
        break;
      }
      case 'progress': {
        const progress: PersistenceProgress = {
          ...event.progress,
          ...(event.requestId === undefined ? {} : { requestId: event.requestId }),
        };
        this.latestProgress = progress;
        for (const listener of this.progressListeners) this.notifyProgressListener(listener, progress);
        break;
      }
      case 'fatal':
        this.enterFatal(deserializePersistenceError(event.error));
        break;
      case 'closed':
        if (event.requestId === this.shutdownRequestId) this.finishDestroy();
        break;
    }
  }

  private handleExit(code: number | null): void {
    if (this.destroyed) return;
    if (this.destroying) {
      this.rejectAll(new Error(
        `Persistence host exited before graceful shutdown completed with code ${String(code)}`,
      ));
      this.finishDestroy();
      return;
    }
    this.enterFatal(new Error(`Persistence host exited unexpectedly with code ${String(code)}`));
  }

  private notifyProgressListener(listener: ProgressListener, progress: PersistenceProgress): void {
    try {
      listener(progress);
    } catch {
      // Progress is observational and cannot change request or host state.
    }
  }

  private sendShutdown(): void {
    if (this.shutdownRequestId === null) return;
    try {
      this.transport.postMessage({ type: 'shutdown', requestId: this.shutdownRequestId });
    } catch (error) {
      this.rejectAll(error instanceof Error ? error : new Error(String(error)));
      // A failed control-message send leaves the host's current operation
      // unknown. Do not kill it: that could interrupt restore promotion after
      // the active database has been renamed. The UI may hide, while the main
      // process waits for the transport's eventual exit.
      this.reportShutdownDelay(0);
    }
  }

  private reportShutdownDelay(elapsedMs: number): void {
    if (this.shutdownDelayReported) return;
    this.shutdownDelayReported = true;
    try {
      this.onShutdownDelayed?.(elapsedMs);
    } catch {
      // UI shutdown reporting cannot make an in-flight database swap unsafe.
    }
  }

  private enterFatal(error: Error): void {
    if (this.fatalError) return;
    this.fatalError = error;
    this.rejectAll(error);
    try {
      this.onFatal?.(error);
    } catch {
      // A reporting callback cannot recover the host or change fatal state.
    }
    try {
      this.transport.kill();
    } catch {
      // The transport may already have exited; fatal state is authoritative.
    }
  }

  private rejectAll(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
    this.readyQueue.splice(0);
  }

  private finishDestroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.destroyTimer) clearTimeout(this.destroyTimer);
    this.destroyTimer = null;
    try {
      this.transport.kill();
    } finally {
      const resolve = this.resolveDestroy;
      this.resolveDestroy = null;
      resolve?.();
    }
  }
}

export interface PersistenceServiceProxy extends PersistenceServiceLike {}

export type { PersistenceProgress, PersistenceServiceLike } from './persistence-protocol';
