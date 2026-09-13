import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { recordObsEvent } from '../features/observability/metrics-store';
import { createDefaultNdiOutputConfigs } from '@lumacast/protocol';
import {
  applyPatch,
  invertPatch,
  type SnapshotPatch,
} from '@lumacast/protocol';
import type { AppSnapshot, NdiDiagnostics, NdiOutputConfig, NdiOutputConfigMap, NdiOutputName, NdiOutputState, PersistenceProgress } from '@lumacast/protocol';
import type { ThemeMode } from '../types/ui';

// ─── Types ──────────────────────────────────────────────────────────

export type HistoryEntry =
  | { kind: 'snapshot'; snapshot: AppSnapshot }
  | { kind: 'patch'; undoPatch: SnapshotPatch; redoPatch: SnapshotPatch };

export const UNDO_STACK_LIMIT = 50;

interface AppStoreState {
  // Snapshot
  snapshot: AppSnapshot | null;
  isLoadingSnapshot: boolean;
  snapshotLoadError: string | null;
  isRunningOperation: boolean;
  operationText: string | null;
  statusText: string;
  statusTextSource: 'default' | 'media-derivatives' | 'persistence';
  canUndo: boolean;
  canRedo: boolean;
  // Theme
  themeMode: ThemeMode;
  systemPref: 'light' | 'dark';
  resolvedTheme: 'light' | 'dark';
  // NDI
  ndiDiagnostics: NdiDiagnostics | null;
  ndiOutputConfigs: NdiOutputConfigMap;
  ndiOutputState: NdiOutputState;

  // Actions
  mutate: (action: () => Promise<AppSnapshot>) => Promise<AppSnapshot>;
  mutatePatch: (action: () => Promise<SnapshotPatch>) => Promise<AppSnapshot>;
  applyPatchLocally: (patch: SnapshotPatch) => Promise<AppSnapshot | null>;
  beginHistoryBatch: () => void;
  endHistoryBatch: () => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  runOperation: <T>(text: string, action: () => Promise<T>) => Promise<T>;
  setStatusText: (text: string) => void;
  setMediaDerivativeStatusText: (text: string | null) => void;
  handlePersistenceProgress: (progress: PersistenceProgress) => void;
  retrySnapshotLoad: () => Promise<void>;
  setThemeMode: (mode: ThemeMode) => void;
  setSystemPref: (pref: 'light' | 'dark') => void;
  setNdiDiagnostics: (diagnostics: NdiDiagnostics | null) => void;
  setNdiOutputConfigsState: (configs: NdiOutputConfigMap) => void;
  setNdiOutputStateValue: (state: NdiOutputState) => void;
  setNdiOutputEnabled: (name: NdiOutputName, enabled: boolean) => void;
  toggleAudienceOutput: () => void;
  toggleStageOutput: () => void;
  updateNdiOutputConfig: (name: NdiOutputName, config: Partial<NdiOutputConfig>) => void;
}

// ─── Local persistence helpers (theme) ─────────────────────────────

const THEME_STORAGE_KEY = 'cast-theme-mode';
const VALID_THEME_MODES = new Set<ThemeMode>(['light', 'dark', 'system']);

function readStoredThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (raw && VALID_THEME_MODES.has(raw as ThemeMode)) return raw as ThemeMode;
  return 'dark';
}

function readSystemPref(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(mode: ThemeMode, pref: 'light' | 'dark'): 'light' | 'dark' {
  return mode === 'system' ? pref : mode;
}

// ─── Module-level mutation queue & history (replaces useRef) ───────

let mutateQueue: Promise<void> = Promise.resolve();
let snapshotMirror: AppSnapshot | null = null;
let undoStack: HistoryEntry[] = [];
let redoStack: HistoryEntry[] = [];
let operationDepth = 0;
let snapshotInactivityWatchdog: { reset: () => void; dispose: () => void } | null = null;
let deferredLocalPatches: SnapshotPatch[] = [];
const SNAPSHOT_INACTIVITY_TIMEOUT_MS = 15_000;

function createSnapshotInactivityWatchdog(onTimeout: () => void) {
  let timeoutId: number | null = null;
  const reset = () => {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(onTimeout, SNAPSHOT_INACTIVITY_TIMEOUT_MS);
  };
  const dispose = () => {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
    timeoutId = null;
  };
  reset();
  return { reset, dispose };
}

function pushUndoEntry(entry: HistoryEntry) {
  undoStack.push(entry);
  if (undoStack.length > UNDO_STACK_LIMIT) undoStack.shift();
  redoStack = [];
}

// ─── History batching ──────────────────────────────────────────────
//
// An agent turn can issue many mutations that the user thinks of as one
// change ("rebuild this deck"), and a per-mutation undo stack makes that
// change take twenty Cmd-Zs to walk back. `beginHistoryBatch`/
// `endHistoryBatch` collapse the run into a single `{ kind: 'snapshot' }`
// entry holding the pre-batch state.
//
// A snapshot entry is already symmetric in `undo`/`redo` below: undoing one
// restores the stored snapshot and pushes the *current* snapshot onto the
// opposite stack, so redo restores the post-batch state without the entry
// having to carry both sides. That is why no `snapshot-range` entry kind was
// needed.
//
// Begin calls nest and only the outermost `end` commits, so a batch opened
// around a nested batch still produces exactly one entry.
let historyBatchDepth = 0;
let historyBatchSnapshot: AppSnapshot | null = null;
let historyBatchMutated = false;

/**
 * Records that a mutation happened inside the open batch. Returns whether a
 * batch is open — when it is, the caller must skip its own undo entry.
 *
 * The pre-batch snapshot is (re)captured from the first mutation's own `prev`
 * rather than trusted from `beginHistoryBatch`, because `begin` is
 * synchronous while mutations run through `enqueueStoreWork`: `prev` is the
 * authoritative state immediately before the first batched write.
 */
function noteBatchedMutation(previousSnapshot: AppSnapshot | null): boolean {
  if (historyBatchDepth === 0) return false;
  if (!historyBatchMutated) {
    historyBatchSnapshot = previousSnapshot;
    historyBatchMutated = true;
  }
  return true;
}

function syncHistoryFlags(set: (partial: Partial<AppStoreState>) => void) {
  set({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });
}

function isNoopDerivativePatch(patch: SnapshotPatch): boolean {
  return Object.values(patch.upserts).every((rows) => rows === undefined || rows.length === 0)
    && Object.values(patch.deletes).every((ids) => ids === undefined || ids.length === 0);
}

function guardMediaDerivativePatch(snapshot: AppSnapshot | null, patch: SnapshotPatch): SnapshotPatch | null {
  if (!snapshot) return patch;
  if (!patch.upserts.mediaAssets && !patch.deletes.mediaAssets) return patch;

  const currentById = new Map(snapshot.mediaAssets.map((asset) => [asset.id, asset]));
  let nextUpserts = patch.upserts;
  let nextDeletes = patch.deletes;

  if (patch.upserts.mediaAssets) {
    const filtered = patch.upserts.mediaAssets.filter((asset) => {
      const current = currentById.get(asset.id);
      return current?.src === asset.src;
    });
    if (filtered.length !== patch.upserts.mediaAssets.length) {
      nextUpserts = { ...nextUpserts };
      if (filtered.length > 0) nextUpserts.mediaAssets = filtered;
      else delete nextUpserts.mediaAssets;
    }
  }

  if (patch.deletes.mediaAssets && patch.deletes.mediaAssets.length > 0) {
    nextDeletes = { ...nextDeletes, mediaAssets: [] };
  }

  const guarded = nextUpserts === patch.upserts && nextDeletes === patch.deletes
    ? patch
    : { ...patch, upserts: nextUpserts, deletes: nextDeletes };
  return isNoopDerivativePatch(guarded) ? null : guarded;
}

function enqueueStoreWork<T>(work: () => Promise<T>): Promise<T> {
  const queued = mutateQueue.then(work, work);
  mutateQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

async function flushDeferredLocalPatches(set: (partial: Partial<AppStoreState>) => void): Promise<AppSnapshot | null> {
  if (!snapshotMirror || deferredLocalPatches.length === 0) return snapshotMirror;
  let next = snapshotMirror;
  const pending = deferredLocalPatches;
  deferredLocalPatches = [];
  for (const patch of pending) {
    const guarded = guardMediaDerivativePatch(next, patch);
    if (!guarded) continue;
    next = applyPatch(next, guarded);
  }
  snapshotMirror = next;
  set({ snapshot: next });
  return next;
}

// ─── Store ─────────────────────────────────────────────────────────

const initialThemeMode = readStoredThemeMode();
const initialSystemPref = readSystemPref();

export const useAppStore = create<AppStoreState>()((set, get) => ({
  snapshot: null,
  isLoadingSnapshot: true,
  snapshotLoadError: null,
  isRunningOperation: false,
  operationText: null,
  statusText: 'Ready',
  statusTextSource: 'default',
  canUndo: false,
  canRedo: false,
  themeMode: initialThemeMode,
  systemPref: initialSystemPref,
  resolvedTheme: resolveTheme(initialThemeMode, initialSystemPref),
  ndiDiagnostics: null,
  ndiOutputConfigs: createDefaultNdiOutputConfigs(),
  ndiOutputState: { audience: false, stage: false },

  mutate: (action) => {
    const run = async () => {
      const prev = snapshotMirror;
      try {
        const next = await action();
        if (noteBatchedMutation(prev)) redoStack = [];
        else if (prev) pushUndoEntry({ kind: 'snapshot', snapshot: prev });
        snapshotMirror = next;
        set({ snapshot: next });
        syncHistoryFlags(set);
        return next;
      } catch (error) {
        console.error('[AppStore] Mutation failed:', error);
        set({ statusText: 'Operation failed' });
        throw error;
      }
    };
    return enqueueStoreWork(run);
  },

  mutatePatch: (action) => {
    const run = async (): Promise<AppSnapshot> => {
      const prev = snapshotMirror;
      try {
        const patch = await action();
        if (!prev) throw new Error('Snapshot not loaded before mutatePatch call');
        const next = applyPatch(prev, patch);
        if (noteBatchedMutation(prev)) redoStack = [];
        else pushUndoEntry({ kind: 'patch', undoPatch: invertPatch(prev, patch), redoPatch: patch });
        snapshotMirror = next;
        set({ snapshot: next });
        syncHistoryFlags(set);
        return next;
      } catch (error) {
        console.error('[AppStore] Patch mutation failed:', error);
        set({ statusText: 'Operation failed' });
        throw error;
      }
    };
    return enqueueStoreWork(run);
  },

  applyPatchLocally: (patch) => {
    return enqueueStoreWork(async () => {
      if (!snapshotMirror) {
        deferredLocalPatches.push(patch);
        return null;
      }
      const guarded = guardMediaDerivativePatch(snapshotMirror, patch);
      if (!guarded) return snapshotMirror;
      const next = applyPatch(snapshotMirror, guarded);
      snapshotMirror = next;
      set({ snapshot: next });
      return next;
    });
  },

  beginHistoryBatch: () => {
    if (historyBatchDepth === 0) {
      historyBatchSnapshot = snapshotMirror;
      historyBatchMutated = false;
    }
    historyBatchDepth += 1;
  },

  endHistoryBatch: () => {
    if (historyBatchDepth === 0) return;
    historyBatchDepth -= 1;
    if (historyBatchDepth > 0) return;

    const before = historyBatchSnapshot;
    const mutated = historyBatchMutated;
    historyBatchSnapshot = null;
    historyBatchMutated = false;
    // An empty batch leaves history untouched — an agent turn that only read
    // state should not put an undo step in the user's way.
    if (!mutated || !before) return;

    undoStack.push({ kind: 'snapshot', snapshot: before });
    if (undoStack.length > UNDO_STACK_LIMIT) undoStack.shift();
    redoStack = [];
    syncHistoryFlags(set);
  },

  undo: async () => {
    const run = async () => {
      const target = undoStack.pop();
      const current = snapshotMirror;
      if (!target || !current) {
        syncHistoryFlags(set);
        return;
      }
      try {
        const nextSnapshot = target.kind === 'patch'
          ? applyPatch(current, target.undoPatch)
          : target.snapshot;
        if (target.kind === 'patch') {
          await window.castApi.applySnapshotPatch(target.undoPatch);
        } else {
          await window.castApi.restoreFromSnapshot(nextSnapshot);
        }
        redoStack.push(
          target.kind === 'patch'
            ? target
            : { kind: 'snapshot', snapshot: current },
        );
        if (redoStack.length > UNDO_STACK_LIMIT) redoStack.shift();
        snapshotMirror = nextSnapshot;
        set({ snapshot: nextSnapshot });
      } catch (error) {
        undoStack.push(target);
        console.error('[AppStore] Undo failed:', error);
        set({ statusText: 'Undo failed' });
      } finally {
        syncHistoryFlags(set);
      }
    };
    const queued = enqueueStoreWork(run);
    await queued;
  },

  redo: async () => {
    const run = async () => {
      const target = redoStack.pop();
      const current = snapshotMirror;
      if (!target || !current) {
        syncHistoryFlags(set);
        return;
      }
      try {
        const nextSnapshot = target.kind === 'patch'
          ? applyPatch(current, target.redoPatch)
          : target.snapshot;
        if (target.kind === 'patch') {
          await window.castApi.applySnapshotPatch(target.redoPatch);
        } else {
          await window.castApi.restoreFromSnapshot(nextSnapshot);
        }
        undoStack.push(
          target.kind === 'patch'
            ? target
            : { kind: 'snapshot', snapshot: current },
        );
        if (undoStack.length > UNDO_STACK_LIMIT) undoStack.shift();
        snapshotMirror = nextSnapshot;
        set({ snapshot: nextSnapshot });
      } catch (error) {
        redoStack.push(target);
        console.error('[AppStore] Redo failed:', error);
        set({ statusText: 'Redo failed' });
      } finally {
        syncHistoryFlags(set);
      }
    };
    const queued = enqueueStoreWork(run);
    await queued;
  },

  runOperation: async <T,>(text: string, action: () => Promise<T>) => {
    operationDepth += 1;
    set({ operationText: text, isRunningOperation: true });
    try {
      return await action();
    } finally {
      operationDepth = Math.max(0, operationDepth - 1);
      if (operationDepth === 0) {
        set({ isRunningOperation: false, operationText: null });
      }
    }
  },

  setStatusText: (text) => set({ statusText: text, statusTextSource: 'default' }),

  setMediaDerivativeStatusText: (text) => {
    const state = get();
    if (text) {
      if (state.isRunningOperation || state.statusTextSource === 'persistence') return;
      set({ statusText: text, statusTextSource: 'media-derivatives' });
      return;
    }
    if (state.statusTextSource === 'media-derivatives') {
      set({ statusText: 'Ready', statusTextSource: 'default' });
    }
  },

  handlePersistenceProgress: (progress) => {
    snapshotInactivityWatchdog?.reset();
    if (progress.operation === 'restoreProjectBackup') {
      if (progress.phase === 'complete') {
        if (get().statusTextSource === 'persistence') {
          set({ statusText: 'Ready', statusTextSource: 'default' });
        }
        return;
      }
      set({ statusText: 'Restoring project', statusTextSource: 'persistence' });
    } else if (get().isLoadingSnapshot) {
      set({ statusText: 'Loading project data', statusTextSource: 'persistence' });
    }
  },

  retrySnapshotLoad: async () => {
    set({ isLoadingSnapshot: true, snapshotLoadError: null });
    let rejectForInactivity!: (error: Error) => void;
    const inactivity = new Promise<AppSnapshot>((_, reject) => {
      rejectForInactivity = reject;
    });
    const watchdog = createSnapshotInactivityWatchdog(() => {
      rejectForInactivity(new Error('Timed out while loading project data.'));
    });
    snapshotInactivityWatchdog?.dispose();
    snapshotInactivityWatchdog = watchdog;
    try {
      const loaded = await Promise.race<AppSnapshot>([
        window.castApi.getSnapshot(),
        inactivity,
      ]);
      await enqueueStoreWork(async () => {
        snapshotMirror = loaded;
        await flushDeferredLocalPatches(set);
        set({ snapshot: snapshotMirror, statusText: 'Ready', statusTextSource: 'default' });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[AppStore] Failed to load snapshot:', error);
      snapshotMirror = null;
      deferredLocalPatches = [];
      set({
        snapshot: null,
        snapshotLoadError: message,
        statusText: 'Failed to load data',
        statusTextSource: 'default',
      });
    } finally {
      watchdog.dispose();
      if (snapshotInactivityWatchdog === watchdog) snapshotInactivityWatchdog = null;
      set({ isLoadingSnapshot: false });
    }
  },

  setThemeMode: (mode) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    }
    const pref = get().systemPref;
    set({ themeMode: mode, resolvedTheme: resolveTheme(mode, pref) });
  },

  setSystemPref: (pref) => {
    const mode = get().themeMode;
    set({ systemPref: pref, resolvedTheme: resolveTheme(mode, pref) });
  },

  setNdiDiagnostics: (diagnostics) => set({ ndiDiagnostics: diagnostics }),
  setNdiOutputConfigsState: (configs) => set({ ndiOutputConfigs: configs }),
  setNdiOutputStateValue: (value) => set({ ndiOutputState: value }),

  setNdiOutputEnabled: (name, enabled) => {
    recordObsEvent('ndi', `NDI output ${enabled ? 'enabled' : 'disabled'}`, { name });
    void window.castApi
      .setNdiOutputEnabled(name, enabled)
      .then((next) => set({ ndiOutputState: next }))
      .catch((error) => {
        console.error('[AppStore] Failed to update output state:', error);
        recordObsEvent('error', 'Failed to toggle NDI output', { name, enabled, error: String(error) }, 'error');
        set({ statusText: `Failed to toggle ${name} output` });
      });
  },

  toggleAudienceOutput: () => {
    const current = get().ndiOutputState;
    get().setNdiOutputEnabled('audience', !current.audience);
  },

  toggleStageOutput: () => {
    const current = get().ndiOutputState;
    get().setNdiOutputEnabled('stage', !current.stage);
  },

  updateNdiOutputConfig: (name, config) => {
    void window.castApi
      .updateNdiOutputConfig(name, config)
      .then((next) => set({ ndiOutputConfigs: next }))
      .catch((error) => {
        console.error('[AppStore] Failed to update output config:', error);
        set({ statusText: `Failed to update ${name} config` });
      });
  },
}));

// Re-export shallow helper so callers don't import from zustand directly.
export { useShallow };

// Synchronous getter for non-React code.
export function getAppSnapshot(): AppSnapshot | null {
  return snapshotMirror;
}
