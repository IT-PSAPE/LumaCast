import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { createDefaultNdiOutputConfigs } from '@core/ndi';
import {
  applyPatch,
  invertPatch,
  type SnapshotPatch,
} from '@core/snapshot-patch';
import type {
  AppSnapshot,
  NdiDiagnostics,
  NdiOutputConfig,
  NdiOutputConfigMap,
  NdiOutputName,
  NdiOutputState,
} from '@core/types';
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
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  runOperation: <T>(text: string, action: () => Promise<T>) => Promise<T>;
  setStatusText: (text: string) => void;
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

function pushUndoEntry(entry: HistoryEntry) {
  undoStack.push(entry);
  if (undoStack.length > UNDO_STACK_LIMIT) undoStack.shift();
  redoStack = [];
}

function syncHistoryFlags(set: (partial: Partial<AppStoreState>) => void) {
  set({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });
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
        if (prev) pushUndoEntry({ kind: 'snapshot', snapshot: prev });
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
    const queued = mutateQueue.then(run, run);
    mutateQueue = queued.then(() => undefined, () => undefined);
    return queued;
  },

  mutatePatch: (action) => {
    const run = async (): Promise<AppSnapshot> => {
      const prev = snapshotMirror;
      try {
        const patch = await action();
        if (!prev) throw new Error('Snapshot not loaded before mutatePatch call');
        const next = applyPatch(prev, patch);
        pushUndoEntry({ kind: 'patch', undoPatch: invertPatch(prev, patch), redoPatch: patch });
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
    const queued = mutateQueue.then(run, run);
    mutateQueue = queued.then(() => undefined, () => undefined);
    return queued;
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
        const restored = await window.castApi.restoreFromSnapshot(nextSnapshot);
        redoStack.push(
          target.kind === 'patch'
            ? target
            : { kind: 'snapshot', snapshot: current },
        );
        if (redoStack.length > UNDO_STACK_LIMIT) redoStack.shift();
        snapshotMirror = restored;
        set({ snapshot: restored });
      } catch (error) {
        undoStack.push(target);
        console.error('[AppStore] Undo failed:', error);
        set({ statusText: 'Undo failed' });
      } finally {
        syncHistoryFlags(set);
      }
    };
    const queued = mutateQueue.then(run, run);
    mutateQueue = queued.then(() => undefined, () => undefined);
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
        const restored = await window.castApi.restoreFromSnapshot(
          target.kind === 'patch' ? applyPatch(current, target.redoPatch) : target.snapshot,
        );
        undoStack.push(
          target.kind === 'patch'
            ? target
            : { kind: 'snapshot', snapshot: current },
        );
        if (undoStack.length > UNDO_STACK_LIMIT) undoStack.shift();
        snapshotMirror = restored;
        set({ snapshot: restored });
      } catch (error) {
        redoStack.push(target);
        console.error('[AppStore] Redo failed:', error);
        set({ statusText: 'Redo failed' });
      } finally {
        syncHistoryFlags(set);
      }
    };
    const queued = mutateQueue.then(run, run);
    mutateQueue = queued.then(() => undefined, () => undefined);
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

  setStatusText: (text) => set({ statusText: text }),

  retrySnapshotLoad: async () => {
    set({ isLoadingSnapshot: true, snapshotLoadError: null });
    try {
      const loaded = await Promise.race<AppSnapshot>([
        window.castApi.getSnapshot(),
        new Promise<AppSnapshot>((_, reject) => {
          window.setTimeout(() => reject(new Error('Timed out while loading project data.')), 15000);
        }),
      ]);
      snapshotMirror = loaded;
      set({ snapshot: loaded, statusText: 'Ready' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[AppStore] Failed to load snapshot:', error);
      snapshotMirror = null;
      set({
        snapshot: null,
        snapshotLoadError: message,
        statusText: 'Failed to load data',
      });
    } finally {
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
    void window.castApi
      .setNdiOutputEnabled(name, enabled)
      .then((next) => set({ ndiOutputState: next }))
      .catch((error) => {
        console.error('[AppStore] Failed to update output state:', error);
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
      });
  },
}));

// Re-export shallow helper so callers don't import from zustand directly.
export { useShallow };

// Synchronous getter for non-React code.
export function getAppSnapshot(): AppSnapshot | null {
  return snapshotMirror;
}
