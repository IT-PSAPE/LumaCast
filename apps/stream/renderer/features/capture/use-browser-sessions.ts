import { useEffect, useRef } from 'react';
import type { BrowserSourceActivity, StreamAPI } from '../../../shared/desktop-api';
import { friendlyError } from '../../shared/friendly-error';
import type { RuntimeSource } from '../../source-runtime';

export interface BrowserSessionStatus {
  state: 'starting' | 'ready' | 'unavailable';
  message?: string;
}

export interface UseBrowserSessionsParams {
  api: StreamAPI;
  /** Resource references from the merged draft, Program, and outgoing graphs. */
  sources: readonly RuntimeSource[];
  /** Resources visible in any current view, including previews and multiview. */
  activeSourceIds: ReadonlySet<string>;
  /** Resources retained by Program or an outgoing transition snapshot. */
  playbackSourceIds: ReadonlySet<string>;
  defaultViewport: { width: number; height: number };
  onError: (message: string) => void;
  onSourceStatus?: (id: string, status: BrowserSessionStatus) => void;
}

interface BrowserSessionConfig {
  id: string;
  url: string;
  width: number;
  height: number;
}

interface BrowserSessionDesired {
  api: StreamAPI;
  config: BrowserSessionConfig;
  activity: BrowserSourceActivity;
  generation: number;
}

type BrowserSessionRequest = Omit<BrowserSessionDesired, 'generation'>;

interface PendingBrowserCreate {
  desired: BrowserSessionDesired;
  cancelRequested: boolean;
  cancelPromise: Promise<void> | null;
  cancelError: unknown;
}

interface BrowserSessionEntry {
  id: string;
  desired: BrowserSessionDesired | null;
  pageApi: StreamAPI | null;
  pageConfig: BrowserSessionConfig | null;
  pageGeneration: number | null;
  pendingCreate: PendingBrowserCreate | null;
  lastActivityKey: string | null;
  attemptedActivityKey: string | null;
  failedCreate: BrowserSessionDesired | null;
  processing: boolean;
  dirty: boolean;
}

function normalizeUrl(url: string): string {
  try { return new URL(url).toString(); }
  catch { return url.trim(); }
}

function sameConfig(left: BrowserSessionConfig | null, right: BrowserSessionConfig): boolean {
  return left?.url === right.url && left.width === right.width && left.height === right.height;
}

function sameRequest(left: BrowserSessionDesired | null, right: BrowserSessionDesired): boolean {
  return left?.api === right.api && left.generation === right.generation && sameConfig(left.config, right.config);
}

function activityKey(activity: BrowserSourceActivity): string {
  return `${activity.active ? 1 : 0}:${activity.programActive ? 1 : 0}:${activity.resetOnEntry ? 1 : 0}`;
}

class BrowserSessionLifecycle {
  private readonly entries = new Map<string, BrowserSessionEntry>();
  private disposed = false;
  private generation = 0;

  constructor(
    private readonly onError: (message: string) => void,
    private readonly onSourceStatus?: (id: string, status: BrowserSessionStatus) => void,
  ) {}

  reconcile(desiredSources: readonly BrowserSessionRequest[]): void {
    if (this.disposed) return;
    const desired = new Map(desiredSources.map((source) => [source.config.id, { ...source, generation: this.generation }]));
    for (const [id, entry] of this.entries) {
      entry.desired = desired.get(id) ?? null;
      if (entry.pendingCreate && (!entry.desired || !sameRequest(entry.desired, entry.pendingCreate.desired))) {
        this.cancelPendingCreate(entry);
      }
      entry.dirty = true;
      this.schedule(entry);
      desired.delete(id);
    }
    for (const [id, source] of desired) {
      const entry: BrowserSessionEntry = {
        id,
        desired: source,
        pageApi: null,
        pageConfig: null,
        pageGeneration: null,
        pendingCreate: null,
        lastActivityKey: null,
        attemptedActivityKey: null,
        failedCreate: null,
        processing: false,
        dirty: true,
      };
      this.entries.set(id, entry);
      this.schedule(entry);
    }
  }

  reset(): void {
    this.generation += 1;
    for (const entry of this.entries.values()) {
      entry.desired = null;
      this.cancelPendingCreate(entry);
      entry.dirty = true;
      this.schedule(entry);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resetEntriesForDisposal();
  }

  private resetEntriesForDisposal(): void {
    for (const entry of this.entries.values()) {
      entry.desired = null;
      this.cancelPendingCreate(entry);
      entry.dirty = true;
      this.schedule(entry);
    }
  }

  private schedule(entry: BrowserSessionEntry): void {
    if (entry.processing) return;
    entry.processing = true;
    void this.drain(entry).catch((error: unknown) => {
      if (!this.disposed) this.reportError(error);
    }).finally(() => {
      entry.processing = false;
      if (entry.dirty) this.schedule(entry);
    });
  }

  private cancelPendingCreate(entry: BrowserSessionEntry): void {
    const pending = entry.pendingCreate;
    if (!pending || pending.cancelRequested) return;
    pending.cancelRequested = true;
    // Close immediately while createBrowserSource is still awaiting loadURL.
    // The drain remains serialized and will not start a same-ID replacement
    // until both this close and the old create invocation have settled.
    try {
      pending.cancelPromise = pending.desired.api.closeBrowserSource(entry.id).then(() => undefined, (error: unknown) => {
        pending.cancelError = error;
      });
    } catch (error) {
      pending.cancelError = error;
      pending.cancelPromise = Promise.resolve();
    }
  }

  private async drain(entry: BrowserSessionEntry): Promise<void> {
    while (true) {
      entry.dirty = false;
      const desired = this.disposed ? null : entry.desired;

      if (!desired) {
        if (entry.pageApi) {
          const pageApi = entry.pageApi;
          entry.pageApi = null;
          entry.pageConfig = null;
          entry.pageGeneration = null;
          entry.lastActivityKey = null;
          entry.attemptedActivityKey = null;
          try {
            await pageApi.closeBrowserSource(entry.id);
          } catch (error) {
            if (!this.disposed) this.reportError(error);
          }
          continue;
        }
        if (this.entries.get(entry.id) === entry) this.entries.delete(entry.id);
        return;
      }

      if (entry.pageApi && (entry.pageApi !== desired.api
        || !sameConfig(entry.pageConfig, desired.config)
        || entry.pageGeneration !== desired.generation)) {
        const pageApi = entry.pageApi;
        entry.pageApi = null;
        entry.pageConfig = null;
        entry.pageGeneration = null;
        entry.lastActivityKey = null;
        entry.attemptedActivityKey = null;
        try {
          await pageApi.closeBrowserSource(entry.id);
        } catch (error) {
          if (!this.disposed) this.reportError(error);
        }
        continue;
      }

      if (!entry.pageApi) {
        // Keep graph ownership even before the resource is visible. The first
        // active view starts loading; later inactive views retain and throttle it.
        if (!desired.activity.active) return;
        if (sameRequest(entry.failedCreate, desired)) return;
        if (entry.failedCreate && !sameRequest(entry.failedCreate, desired)) entry.failedCreate = null;
        this.notifyStatus(entry.id, { state: 'starting' });
        const pending: PendingBrowserCreate = {
          desired,
          cancelRequested: false,
          cancelPromise: null,
          cancelError: null,
        };
        entry.pendingCreate = pending;
        let createError: unknown;
        try {
          await desired.api.createBrowserSource(desired.config.id, desired.config.url, desired.config.width, desired.config.height);
        } catch (error) {
          createError = error;
        }

        if (pending.cancelRequested) {
          await pending.cancelPromise;
          if (pending.cancelError !== null) {
            if (!this.disposed) this.reportError(pending.cancelError);
            try {
              await pending.desired.api.closeBrowserSource(entry.id);
            } catch (error) {
              if (!this.disposed) this.reportError(error);
              const current = entry.desired;
              if (current && !this.disposed) entry.failedCreate = current;
              if (entry.pendingCreate === pending) entry.pendingCreate = null;
              return;
            }
          }
          if (entry.pendingCreate === pending) entry.pendingCreate = null;
          continue;
        }
        if (entry.pendingCreate === pending) entry.pendingCreate = null;

        if (createError !== undefined) {
          if (sameRequest(entry.desired, desired) && !this.disposed) {
            entry.failedCreate = desired;
            this.notifyStatus(entry.id, { state: 'unavailable', message: friendlyError(createError) });
            this.reportError(createError);
            return;
          }
          continue;
        }
        if (sameRequest(entry.desired, desired) && !this.disposed) {
          entry.pageApi = desired.api;
          entry.pageConfig = desired.config;
          entry.pageGeneration = desired.generation;
          entry.lastActivityKey = null;
          entry.attemptedActivityKey = null;
          entry.failedCreate = null;
          this.notifyStatus(entry.id, { state: 'ready' });
        } else {
          // A graph can release this resource while Electron is still loading it.
          // Record ownership so the next iteration closes the stale window.
          entry.pageApi = desired.api;
          entry.pageConfig = desired.config;
          entry.pageGeneration = desired.generation;
        }
        continue;
      }

      const key = activityKey(desired.activity);
      if (entry.lastActivityKey === key || entry.attemptedActivityKey === key) return;
      entry.attemptedActivityKey = key;
      try {
        await desired.api.setBrowserSourceActivity(desired.config.id, desired.activity);
      } catch (error) {
        const current = entry.desired;
        if (current && sameRequest(current, desired) && activityKey(current.activity) === key && !this.disposed) {
          this.reportError(error);
          return;
        }
        continue;
      }
      const current = entry.desired;
      if (current && sameRequest(current, desired) && activityKey(current.activity) === key && !this.disposed) {
        entry.lastActivityKey = key;
      }
    }
  }

  private notifyStatus(id: string, status: BrowserSessionStatus): void {
    try { this.onSourceStatus?.(id, status); }
    catch { /* A status observer must not interrupt native resource cleanup. */ }
  }

  private reportError(error: unknown): void {
    try { this.onError(friendlyError(error)); }
    catch { /* An error observer must not interrupt native resource cleanup. */ }
  }
}

export function useBrowserSessions({
  api,
  sources,
  activeSourceIds,
  playbackSourceIds,
  defaultViewport,
  onError,
  onSourceStatus,
}: UseBrowserSessionsParams): { reset: () => void } {
  const callbacks = useRef({ onError, onSourceStatus });
  callbacks.current = { onError, onSourceStatus };
  const lifecycle = useRef<BrowserSessionLifecycle | null>(null);
  if (!lifecycle.current) {
    lifecycle.current = new BrowserSessionLifecycle(
      (message) => callbacks.current.onError(message),
      (id, status) => callbacks.current.onSourceStatus?.(id, status),
    );
  }

  // StrictMode replays effect cleanup/setup. Defer disposal by one microtask so
  // the replay can reactivate the same coordinator without closing its pages.
  const lifetimeToken = useRef(0);
  useEffect(() => {
    const token = ++lifetimeToken.current;
    return () => {
      queueMicrotask(() => {
        if (lifetimeToken.current === token) lifecycle.current?.dispose();
      });
    };
  }, []);

  useEffect(() => {
    const desired: BrowserSessionRequest[] = [];
    for (const source of sources) {
      if (source.kind !== 'browser' || !source.url?.trim()) continue;
      desired.push({
        api,
        config: {
          id: source.id,
          url: normalizeUrl(source.url),
          width: source.browserViewportWidth ?? defaultViewport.width,
          height: source.browserViewportHeight ?? defaultViewport.height,
        },
        activity: {
          active: activeSourceIds.has(source.id),
          programActive: playbackSourceIds.has(source.id),
          resetOnEntry: source.restartPlaybackWhenActive === true,
        },
      });
    }
    lifecycle.current?.reconcile(desired);
  }, [api, sources, activeSourceIds, playbackSourceIds, defaultViewport.width, defaultViewport.height]);

  return {
    reset: () => lifecycle.current?.reset(),
  };
}
