// A window's renderer and file sinks retire together. Document consent stays
// in the renderer; main owns draining and the final native close replay.
import type { IpcExportSinks } from './ipc';

export interface RetirableExportSinks extends IpcExportSinks { retire(): Promise<void> }
interface SinkOwner { sinks: RetirableExportSinks; retired: boolean; draining?: Promise<void> }
interface CloseAttempt { resolve(value: boolean): void; reject(error: unknown): void; promise: Promise<boolean> }

interface WindowLifetimeOptions {
  createSinks(): RetirableExportSinks;
  sendCloseRequest(): void;
  replayClose(): void;
  onCloseSettled?(closed: boolean): void;
}

export class WindowLifetime {
  private owner: SinkOwner;
  private renderer = 0;
  private ready = false;
  private bridgeMounted = false;
  private live = true;
  private rendererGone = false;
  private requested = false;
  private replaying = false;
  private attempt: CloseAttempt | null = null;

  constructor(private readonly options: WindowLifetimeOptions) {
    this.owner = { sinks: options.createSinks(), retired: false };
  }

  get sinks(): IpcExportSinks { return this.owner.sinks; }

  private drain(owner: SinkOwner): Promise<void> {
    owner.retired = true;
    if (!owner.draining) {
      const draining = owner.sinks.retire();
      owner.draining = draining;
      void draining.catch(() => { if (owner.draining === draining) owner.draining = undefined; });
    }
    return owner.draining;
  }

  retire(): Promise<void> { return this.drain(this.owner); }

  /** Called by the mounted renderer after its push listeners are installed. */
  async rendererReady(): Promise<boolean> {
    // Repeated mounts/readiness reports cannot rotate a registry currently
    // draining for an approved close. Only its final veto creates a successor.
    if (this.ready) return true;
    const renderer = this.renderer;
    const owner = this.owner;
    this.bridgeMounted = true;
    if (owner.retired) await this.drain(owner);
    if (!this.live || renderer !== this.renderer) return false;
    if (this.owner === owner && owner.retired) this.owner = { sinks: this.options.createSinks(), retired: false };
    this.ready = true;
    this.rendererGone = false;
    if (this.requested) this.options.sendCloseRequest();
    return true;
  }

  /** Reload/process loss fences the old renderer before a successor is ready. */
  rendererLost(gone = false): Promise<void> {
    // WebContents destruction precedes BrowserWindow.closed on an allowed
    // replay. Keep that close's completion alive until the window closes.
    if (gone && this.replaying) {
      this.ready = false;
      this.rendererGone = true;
      return this.retire();
    }
    this.renderer += 1;
    this.ready = false;
    this.bridgeMounted = false;
    this.rendererGone = gone;
    this.replaying = false;
    this.settle(false, false);
    return this.retire();
  }

  nativeClose(event: { preventDefault(): void }): void {
    if (this.replaying) return;
    event.preventDefault();
    this.requested = true;
    if (this.ready) this.options.sendCloseRequest();
    else if (this.rendererGone) void this.finishClose(true).catch(() => {});
    else if (this.bridgeMounted) this.options.sendCloseRequest();
    // A cold close waits for readiness; an unsent dirty state is never
    // interpreted as proof that the renderer is clean.
  }

  finishClose(approved: boolean): Promise<boolean> {
    if (!approved) {
      if (!this.attempt) this.settle(false);
      return Promise.resolve(false);
    }
    if (this.attempt) return this.attempt.promise;
    if (!this.live || !this.requested || (!this.ready && !this.rendererGone)) return Promise.resolve(false);
    const owner = this.owner;
    const renderer = this.renderer;
    let resolve!: (value: boolean) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<boolean>((done, fail) => { resolve = done; reject = fail; });
    const attempt: CloseAttempt = { promise, resolve, reject };
    this.attempt = attempt;
    void this.drain(owner).then(() => {
      if (!this.live || this.owner !== owner || this.renderer !== renderer || this.attempt !== attempt) return;
      this.replaying = true;
      this.options.replayClose();
    }, (error: unknown) => {
      if (this.attempt !== attempt) return;
      this.attempt = null;
      this.requested = false;
      this.options.onCloseSettled?.(false);
      reject(error);
    });
    return promise;
  }

  /** Respect the renderer's final synchronous revision veto. */
  unloadPrevented(): void {
    if (!this.replaying) return;
    this.replaying = false;
    // Replay is reached only after a successful drain. The old registry is
    // permanently fenced; the still-open editor receives a fresh owner.
    this.owner = { sinks: this.options.createSinks(), retired: false };
    this.settle(false, false);
    this.requested = true;
  }

  closed(): Promise<void> {
    this.live = false;
    this.ready = false;
    this.bridgeMounted = false;
    this.settle(true);
    return this.retire();
  }

  private settle(closed: boolean, notify = true): void {
    const attempt = this.attempt;
    this.attempt = null;
    this.requested = false;
    attempt?.resolve(closed);
    if (notify) this.options.onCloseSettled?.(closed);
  }
}
