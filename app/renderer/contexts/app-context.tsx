import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { recordObsEvent } from '../features/observability/metrics-store';
import type {
  AppSnapshot,
  NdiDiagnostics,
  NdiOutputConfig,
  NdiOutputConfigMap,
  NdiOutputName,
  NdiOutputState,
} from '@core/types';
import type { SnapshotPatch } from '@core/snapshot-patch';
import type { ThemeMode } from '../types/ui';
import { useAppStore, useShallow } from './app-store';

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

// ─── Provider (bootstrap-only; state lives in zustand store) ────────

export function AppProvider({ children }: { children: ReactNode }) {
  const retrySnapshotLoad = useAppStore((s) => s.retrySnapshotLoad);
  const setSystemPref = useAppStore((s) => s.setSystemPref);
  const setNdiDiagnostics = useAppStore((s) => s.setNdiDiagnostics);
  const setNdiOutputConfigsState = useAppStore((s) => s.setNdiOutputConfigsState);
  const setNdiOutputStateValue = useAppStore((s) => s.setNdiOutputStateValue);
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);

  // Initial snapshot load.
  useEffect(() => {
    void retrySnapshotLoad();
  }, [retrySnapshotLoad]);

  // System theme preference subscription.
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    function handleChange(e: MediaQueryListEvent) {
      setSystemPref(e.matches ? 'dark' : 'light');
    }
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [setSystemPref]);

  // Apply theme attribute to document root.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme);
  }, [resolvedTheme]);

  // NDI diagnostics + output state subscriptions.
  const lastSenderNamesRef = useRef<{ audience: string | null; stage: string | null }>({ audience: null, stage: null });
  const lastErrorRef = useRef<string | null>(null);
  useEffect(() => {
    void window.castApi.getNdiDiagnostics().then(setNdiDiagnostics).catch((error) => {
      console.error('[AppProvider] Failed to get NDI diagnostics:', error);
    });
    void window.castApi.getNdiOutputConfigs().then(setNdiOutputConfigsState).catch((error) => {
      console.error('[AppProvider] Failed to get output config:', error);
    });
    void window.castApi.getNdiOutputState().then(setNdiOutputStateValue).catch((error) => {
      console.error('[AppProvider] Failed to get output state:', error);
    });

    const unsubscribeOutput = window.castApi.onNdiOutputStateChanged(setNdiOutputStateValue);
    const unsubscribeDiagnostics = window.castApi.onNdiDiagnosticsChanged((diagnostics) => {
      // Synthesize sender lifecycle events by diffing current diagnostics
      // against the previous snapshot — keeps the timeline in sync with
      // the main process without needing dedicated IPC events.
      const prev = lastSenderNamesRef.current;
      for (const name of ['audience', 'stage'] as const) {
        const sender = diagnostics.senders[name];
        const previousName = prev[name];
        const nextName = sender?.senderName ?? null;
        if (previousName === nextName) continue;
        if (!previousName && nextName) {
          recordObsEvent('ndi', 'Sender created', { output: name, senderName: nextName });
        } else if (previousName && !nextName) {
          recordObsEvent('ndi', 'Sender destroyed', { output: name, senderName: previousName });
        } else if (previousName && nextName) {
          recordObsEvent('ndi', 'Sender renamed', { output: name, from: previousName, to: nextName });
        }
        prev[name] = nextName;
      }
      if (diagnostics.lastError && diagnostics.lastError !== lastErrorRef.current) {
        recordObsEvent('error', 'NDI error', { error: diagnostics.lastError }, 'error');
      }
      lastErrorRef.current = diagnostics.lastError;
      setNdiDiagnostics(diagnostics);
    });
    return () => {
      unsubscribeOutput();
      unsubscribeDiagnostics();
    };
  }, [setNdiDiagnostics, setNdiOutputConfigsState, setNdiOutputStateValue]);

  return <>{children}</>;
}

// ─── Hooks ──────────────────────────────────────────────────────────

export function useApp(): AppContextValue {
  const state = useAppStore(
    useShallow((s) => ({
      snapshot: s.snapshot,
      isLoadingSnapshot: s.isLoadingSnapshot,
      snapshotLoadError: s.snapshotLoadError,
      isRunningOperation: s.isRunningOperation,
      operationText: s.operationText,
      statusText: s.statusText,
      canUndo: s.canUndo,
      canRedo: s.canRedo,
      themeMode: s.themeMode,
      resolvedTheme: s.resolvedTheme,
      ndiDiagnostics: s.ndiDiagnostics,
      ndiOutputConfigs: s.ndiOutputConfigs,
      ndiOutputState: s.ndiOutputState,
    })),
  );
  const actions = useAppStore(
    useShallow((s) => ({
      mutate: s.mutate,
      mutatePatch: s.mutatePatch,
      undo: s.undo,
      redo: s.redo,
      runOperation: s.runOperation,
      setStatusText: s.setStatusText,
      retrySnapshotLoad: s.retrySnapshotLoad,
      setThemeMode: s.setThemeMode,
      setNdiOutputEnabled: s.setNdiOutputEnabled,
      toggleAudienceOutput: s.toggleAudienceOutput,
      toggleStageOutput: s.toggleStageOutput,
      updateNdiOutputConfig: s.updateNdiOutputConfig,
    })),
  );
  return useMemo(() => ({ state, actions }), [state, actions]);
}

export function useCast(): CastSlice {
  return useAppStore(
    useShallow((s) => ({
      snapshot: s.snapshot,
      isLoadingSnapshot: s.isLoadingSnapshot,
      snapshotLoadError: s.snapshotLoadError,
      isRunningOperation: s.isRunningOperation,
      operationText: s.operationText,
      statusText: s.statusText,
      canUndo: s.canUndo,
      canRedo: s.canRedo,
      mutate: s.mutate,
      mutatePatch: s.mutatePatch,
      undo: s.undo,
      redo: s.redo,
      runOperation: s.runOperation,
      setStatusText: s.setStatusText,
      retrySnapshotLoad: s.retrySnapshotLoad,
    })),
  );
}

export function useTheme(): ThemeSlice {
  const themeMode = useAppStore((s) => s.themeMode);
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);
  const setThemeMode = useAppStore((s) => s.setThemeMode);
  return useMemo(
    () => ({
      state: { themeMode, resolvedTheme },
      actions: { setThemeMode },
    }),
    [themeMode, resolvedTheme, setThemeMode],
  );
}

export function useNdi(): NdiSlice {
  const diagnostics = useAppStore((s) => s.ndiDiagnostics);
  const outputConfigs = useAppStore((s) => s.ndiOutputConfigs);
  const outputState = useAppStore((s) => s.ndiOutputState);
  const setOutputEnabled = useAppStore((s) => s.setNdiOutputEnabled);
  const toggleAudienceOutput = useAppStore((s) => s.toggleAudienceOutput);
  const toggleStageOutput = useAppStore((s) => s.toggleStageOutput);
  const updateOutputConfig = useAppStore((s) => s.updateNdiOutputConfig);
  return useMemo(
    () => ({
      state: { diagnostics, outputConfigs, outputState },
      actions: {
        setOutputEnabled,
        toggleAudienceOutput,
        toggleStageOutput,
        updateOutputConfig,
      },
    }),
    [diagnostics, outputConfigs, outputState, setOutputEnabled, toggleAudienceOutput, toggleStageOutput, updateOutputConfig],
  );
}

export { useAppStore } from './app-store';
