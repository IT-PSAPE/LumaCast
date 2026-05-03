import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createDefaultNdiOutputConfigs } from '@core/ndi';
import type { AppSnapshot, NdiDiagnostics, NdiOutputConfig, NdiOutputConfigMap, NdiOutputName, NdiOutputState } from '@core/types';
import { applyPatch, invertPatch, type SnapshotPatch } from '@core/snapshot-patch';
import type { ThemeMode } from '../types/ui';
import { useLocalStorage } from '../hooks/use-local-storage';

// ─── Types ──────────────────────────────────────────────────────────

interface AppContextValue {
  state: {
    snapshot: AppSnapshot | null;
    isLoadingSnapshot: boolean;
    snapshotLoadError: string | null;
    isRunningOperation: boolean;
    operationText: string | null;
    statusText: string;
    canUndo: boolean;
    canRedo: boolean;
    themeMode: ThemeMode;
    resolvedTheme: 'light' | 'dark';
    ndiDiagnostics: NdiDiagnostics | null;
    ndiOutputConfigs: NdiOutputConfigMap;
    ndiOutputState: NdiOutputState;
  };
  actions: {
    mutate: (action: () => Promise<AppSnapshot>) => Promise<AppSnapshot>;
    mutatePatch: (action: () => Promise<SnapshotPatch>) => Promise<AppSnapshot>;
    undo: () => Promise<void>;
    redo: () => Promise<void>;
    runOperation: <T>(text: string, action: () => Promise<T>) => Promise<T>;
    setStatusText: (text: string) => void;
    retrySnapshotLoad: () => Promise<void>;
    setThemeMode: (mode: ThemeMode) => void;
    setNdiOutputEnabled: (name: NdiOutputName, enabled: boolean) => void;
    toggleAudienceOutput: () => void;
    toggleStageOutput: () => void;
    updateNdiOutputConfig: (name: NdiOutputName, config: Partial<NdiOutputConfig>) => void;
  };
}

// ─── Convenience slice types ────────────────────────────────────────

interface CastSlice {
  snapshot: AppSnapshot | null;
  isLoadingSnapshot: boolean;
  snapshotLoadError: string | null;
  isRunningOperation: boolean;
  operationText: string | null;
  statusText: string;
  canUndo: boolean;
  canRedo: boolean;
  mutate: (action: () => Promise<AppSnapshot>) => Promise<AppSnapshot>;
  mutatePatch: (action: () => Promise<SnapshotPatch>) => Promise<AppSnapshot>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  runOperation: <T>(text: string, action: () => Promise<T>) => Promise<T>;
  setStatusText: (text: string) => void;
  retrySnapshotLoad: () => Promise<void>;
}

interface ThemeSlice {
  state: { themeMode: ThemeMode; resolvedTheme: 'light' | 'dark' };
  actions: { setThemeMode: (mode: ThemeMode) => void };
}

interface NdiSlice {
  state: { diagnostics: NdiDiagnostics | null; outputConfigs: NdiOutputConfigMap; outputState: NdiOutputState };
  actions: {
    setOutputEnabled: (name: NdiOutputName, enabled: boolean) => void;
    toggleAudienceOutput: () => void;
    toggleStageOutput: () => void;
    updateOutputConfig: (name: NdiOutputName, config: Partial<NdiOutputConfig>) => void;
  };
}

// ─── Constants ──────────────────────────────────────────────────────

const THEME_STORAGE_KEY = 'cast-theme-mode';
const VALID_THEME_MODES = new Set<ThemeMode>(['light', 'dark', 'system']);
const UNDO_STACK_LIMIT = 50;

type HistoryEntry =
  | { kind: 'snapshot'; snapshot: AppSnapshot }
  | { kind: 'patch'; undoPatch: SnapshotPatch; redoPatch: SnapshotPatch };

function parseThemeMode(raw: string): ThemeMode | null {
  return VALID_THEME_MODES.has(raw as ThemeMode) ? (raw as ThemeMode) : null;
}

function getSystemPreference(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// ─── Context ────────────────────────────────────────────────────────

const AppContext = createContext<AppContextValue | null>(null);

// ─── Provider ───────────────────────────────────────────────────────

export function AppProvider({ children }: { children: ReactNode }) {
  // ── Snapshot & mutation queue ──
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(true);
  const [snapshotLoadError, setSnapshotLoadError] = useState<string | null>(null);
  const [isRunningOperation, setIsRunningOperation] = useState(false);
  const [operationText, setOperationText] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('Ready');
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const mutateQueueRef = useRef<Promise<void>>(Promise.resolve());
  const operationDepthRef = useRef(0);
  // Mirrors the `snapshot` React state synchronously so `mutatePatch` can
  // apply a patch to the post-state and return the up-to-date AppSnapshot
  // to its caller without waiting for the React commit.
  const snapshotRef = useRef<AppSnapshot | null>(null);
  // Stacks hold pre-mutation snapshots. Each entry is the state to revert
  // to; new mutations clear redo, and overflow trims the oldest entry.
  const undoStackRef = useRef<HistoryEntry[]>([]);
  const redoStackRef = useRef<HistoryEntry[]>([]);
  const setSnapshotBoth = useCallback((value: AppSnapshot) => {
    snapshotRef.current = value;
    setSnapshot(value);
  }, []);
  const syncHistoryFlags = useCallback(() => {
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
  }, []);
  const pushUndoEntry = useCallback((entry: HistoryEntry) => {
    undoStackRef.current.push(entry);
    if (undoStackRef.current.length > UNDO_STACK_LIMIT) {
      undoStackRef.current.shift();
    }
    redoStackRef.current = [];
    syncHistoryFlags();
  }, [syncHistoryFlags]);

  const loadInitialSnapshot = useCallback(async () => {
    setIsLoadingSnapshot(true);
    setSnapshotLoadError(null);

    try {
      const loaded = await Promise.race<AppSnapshot>([
        window.castApi.getSnapshot(),
        new Promise<AppSnapshot>((_, reject) => {
          window.setTimeout(() => reject(new Error('Timed out while loading project data.')), 15000);
        }),
      ]);
      snapshotRef.current = loaded;
      setSnapshot(loaded);
      setStatusText('Ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[AppProvider] Failed to load snapshot:', error);
      snapshotRef.current = null;
      setSnapshot(null);
      setSnapshotLoadError(message);
      setStatusText('Failed to load data');
    } finally {
      setIsLoadingSnapshot(false);
    }
  }, []);

  useEffect(() => {
    void loadInitialSnapshot();
  }, [loadInitialSnapshot]);

  const mutate = useCallback((action: () => Promise<AppSnapshot>) => {
    const run = async () => {
      const prev = snapshotRef.current;
      try {
        const next = await action();
        if (prev) pushUndoEntry({ kind: 'snapshot', snapshot: prev });
        setSnapshotBoth(next);
        return next;
      } catch (error) {
        console.error('[AppProvider] Mutation failed:', error);
        setStatusText('Operation failed');
        throw error;
      }
    };
    const queued = mutateQueueRef.current.then(run, run);
    mutateQueueRef.current = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }, [setSnapshotBoth, pushUndoEntry]);

  // Like `mutate` but the action returns a `SnapshotPatch` instead of a
  // full AppSnapshot. Applies the patch to the current snapshot and
  // returns the updated AppSnapshot so existing callers that do
  // `const next = await mutate(() => castApi.fooAction())` keep working.
  const mutatePatch = useCallback((action: () => Promise<SnapshotPatch>) => {
    const run = async (): Promise<AppSnapshot> => {
      const prev = snapshotRef.current;
      try {
        const patch = await action();
        if (!prev) throw new Error('Snapshot not loaded before mutatePatch call');
        const next = applyPatch(prev, patch);
        pushUndoEntry({ kind: 'patch', undoPatch: invertPatch(prev, patch), redoPatch: patch });
        setSnapshotBoth(next);
        return next;
      } catch (error) {
        console.error('[AppProvider] Patch mutation failed:', error);
        setStatusText('Operation failed');
        throw error;
      }
    };
    const queued = mutateQueueRef.current.then(run, run);
    mutateQueueRef.current = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }, [setSnapshotBoth, pushUndoEntry]);

  const undo = useCallback(async (): Promise<void> => {
    const run = async () => {
      const target = undoStackRef.current.pop();
      const current = snapshotRef.current;
      if (!target || !current) {
        syncHistoryFlags();
        return;
      }
      try {
        const nextSnapshot = target.kind === 'patch'
          ? applyPatch(current, target.undoPatch)
          : target.snapshot;
        const restored = await window.castApi.restoreFromSnapshot(nextSnapshot);
        redoStackRef.current.push(
          target.kind === 'patch'
            ? target
            : { kind: 'snapshot', snapshot: current },
        );
        if (redoStackRef.current.length > UNDO_STACK_LIMIT) {
          redoStackRef.current.shift();
        }
        setSnapshotBoth(restored);
      } catch (error) {
        undoStackRef.current.push(target);
        console.error('[AppProvider] Undo failed:', error);
        setStatusText('Undo failed');
      } finally {
        syncHistoryFlags();
      }
    };
    const queued = mutateQueueRef.current.then(run, run);
    mutateQueueRef.current = queued.then(
      () => undefined,
      () => undefined,
    );
    await queued;
  }, [setSnapshotBoth, syncHistoryFlags]);

  const redo = useCallback(async (): Promise<void> => {
    const run = async () => {
      const target = redoStackRef.current.pop();
      const current = snapshotRef.current;
      if (!target || !current) {
        syncHistoryFlags();
        return;
      }
      try {
        const restored = await window.castApi.restoreFromSnapshot(
          target.kind === 'patch'
            ? applyPatch(current, target.redoPatch)
            : target.snapshot,
        );
        undoStackRef.current.push(
          target.kind === 'patch'
            ? target
            : { kind: 'snapshot', snapshot: current },
        );
        if (undoStackRef.current.length > UNDO_STACK_LIMIT) {
          undoStackRef.current.shift();
        }
        setSnapshotBoth(restored);
      } catch (error) {
        redoStackRef.current.push(target);
        console.error('[AppProvider] Redo failed:', error);
        setStatusText('Redo failed');
      } finally {
        syncHistoryFlags();
      }
    };
    const queued = mutateQueueRef.current.then(run, run);
    mutateQueueRef.current = queued.then(
      () => undefined,
      () => undefined,
    );
    await queued;
  }, [setSnapshotBoth, syncHistoryFlags]);

  const runOperation = useCallback(async <T,>(text: string, action: () => Promise<T>) => {
    operationDepthRef.current += 1;
    setOperationText(text);
    setIsRunningOperation(true);
    try {
      return await action();
    } finally {
      operationDepthRef.current = Math.max(0, operationDepthRef.current - 1);
      if (operationDepthRef.current === 0) {
        setIsRunningOperation(false);
        setOperationText(null);
      }
    }
  }, []);

  // ── Theme ──
  const [themeMode, setThemeMode] = useLocalStorage<ThemeMode>(THEME_STORAGE_KEY, 'dark', parseThemeMode);
  const [systemPref, setSystemPref] = useState<'light' | 'dark'>(getSystemPreference);
  const resolvedTheme = themeMode === 'system' ? systemPref : themeMode;

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    function handleChange(e: MediaQueryListEvent) {
      setSystemPref(e.matches ? 'dark' : 'light');
    }
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme);
  }, [resolvedTheme]);

  // ── NDI ──
  const [ndiDiagnostics, setNdiDiagnostics] = useState<NdiDiagnostics | null>(null);
  const [ndiOutputConfigs, setNdiOutputConfigs] = useState<NdiOutputConfigMap>(createDefaultNdiOutputConfigs);
  const [ndiOutputState, setNdiOutputState] = useState<NdiOutputState>({ audience: false, stage: false });
  const ndiOutputStateRef = useRef(ndiOutputState);
  ndiOutputStateRef.current = ndiOutputState;

  useEffect(() => {
    void window.castApi.getNdiDiagnostics().then(setNdiDiagnostics).catch((error) => {
      console.error('[AppProvider] Failed to get NDI diagnostics:', error);
    });
    void window.castApi.getNdiOutputConfigs().then(setNdiOutputConfigs).catch((error) => {
      console.error('[AppProvider] Failed to get output config:', error);
    });
    void window.castApi.getNdiOutputState().then(setNdiOutputState).catch((error) => {
      console.error('[AppProvider] Failed to get output state:', error);
    });

    const unsubscribeOutput = window.castApi.onNdiOutputStateChanged(setNdiOutputState);
    const unsubscribeDiagnostics = window.castApi.onNdiDiagnosticsChanged(setNdiDiagnostics);
    return () => {
      unsubscribeOutput();
      unsubscribeDiagnostics();
    };
  }, []);

  const setNdiOutputEnabled = useCallback((name: NdiOutputName, enabled: boolean) => {
    void window.castApi.setNdiOutputEnabled(name, enabled).then(setNdiOutputState).catch((error) => {
      console.error('[AppProvider] Failed to update output state:', error);
    });
  }, []);

  const toggleAudienceOutput = useCallback(() => {
    setNdiOutputEnabled('audience', !ndiOutputStateRef.current.audience);
  }, [setNdiOutputEnabled]);

  const toggleStageOutput = useCallback(() => {
    setNdiOutputEnabled('stage', !ndiOutputStateRef.current.stage);
  }, [setNdiOutputEnabled]);

  const updateNdiOutputConfig = useCallback((name: NdiOutputName, config: Partial<NdiOutputConfig>) => {
    void window.castApi.updateNdiOutputConfig(name, config).then(setNdiOutputConfigs).catch((error) => {
      console.error('[AppProvider] Failed to update output config:', error);
    });
  }, []);

  // ── Context value ──
  const state = useMemo<AppContextValue['state']>(() => ({
    snapshot,
    isLoadingSnapshot,
    snapshotLoadError,
    isRunningOperation,
    operationText,
    statusText,
    canUndo,
    canRedo,
    themeMode,
    resolvedTheme,
    ndiDiagnostics,
    ndiOutputConfigs,
    ndiOutputState,
  }), [snapshot, isLoadingSnapshot, snapshotLoadError, isRunningOperation, operationText, statusText, canUndo, canRedo, themeMode, resolvedTheme, ndiDiagnostics, ndiOutputConfigs, ndiOutputState]);

  const actions = useMemo<AppContextValue['actions']>(() => ({
    mutate,
    mutatePatch,
    undo,
    redo,
    runOperation,
    setStatusText,
    retrySnapshotLoad: loadInitialSnapshot,
    setThemeMode,
    setNdiOutputEnabled,
    toggleAudienceOutput,
    toggleStageOutput,
    updateNdiOutputConfig,
  }), [mutate, mutatePatch, undo, redo, runOperation, loadInitialSnapshot, setThemeMode, setNdiOutputEnabled, toggleAudienceOutput, toggleStageOutput, updateNdiOutputConfig]);

  const value = useMemo<AppContextValue>(() => ({ state, actions }), [state, actions]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// ─── Hooks ──────────────────────────────────────────────────────────

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

export function useCast(): CastSlice {
  const { state, actions } = useApp();
  return {
    snapshot: state.snapshot,
    isLoadingSnapshot: state.isLoadingSnapshot,
    snapshotLoadError: state.snapshotLoadError,
    isRunningOperation: state.isRunningOperation,
    operationText: state.operationText,
    statusText: state.statusText,
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    mutate: actions.mutate,
    mutatePatch: actions.mutatePatch,
    undo: actions.undo,
    redo: actions.redo,
    runOperation: actions.runOperation,
    setStatusText: actions.setStatusText,
    retrySnapshotLoad: actions.retrySnapshotLoad,
  };
}

export function useTheme(): ThemeSlice {
  const { state, actions } = useApp();
  return {
    state: { themeMode: state.themeMode, resolvedTheme: state.resolvedTheme },
    actions: { setThemeMode: actions.setThemeMode },
  };
}

export function useNdi(): NdiSlice {
  const { state, actions } = useApp();
  return {
    state: { diagnostics: state.ndiDiagnostics, outputConfigs: state.ndiOutputConfigs, outputState: state.ndiOutputState },
    actions: {
      setOutputEnabled: actions.setNdiOutputEnabled,
      toggleAudienceOutput: actions.toggleAudienceOutput,
      toggleStageOutput: actions.toggleStageOutput,
      updateOutputConfig: actions.updateNdiOutputConfig,
    },
  };
}
