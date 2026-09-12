import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { recordObsEvent } from '../features/observability/metrics-store';
import type { AppSnapshot, NdiDiagnostics, NdiOutputConfig, NdiOutputConfigMap, NdiOutputName, NdiOutputState } from '@lumacast/protocol';
import type { SnapshotPatch } from '@lumacast/protocol';
import type { ThemeMode } from '../types/ui';
import { useAppStore, useShallow } from './app-store';

// ─── Types ──────────────────────────────────────────────────────────

interface CastSlice {
  snapshot: AppSnapshot | null;
  isLoadingSnapshot: boolean;
  snapshotLoadError: string | null;
  canUndo: boolean;
  canRedo: boolean;
  mutate: (action: () => Promise<AppSnapshot>) => Promise<AppSnapshot>;
  mutatePatch: (action: () => Promise<SnapshotPatch>) => Promise<AppSnapshot>;
  applyPatchLocally: (patch: SnapshotPatch) => Promise<AppSnapshot | null>;
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
  state: { outputConfigs: NdiOutputConfigMap; outputState: NdiOutputState };
  actions: {
    setOutputEnabled: (name: NdiOutputName, enabled: boolean) => void;
    toggleAudienceOutput: () => void;
    toggleStageOutput: () => void;
    updateOutputConfig: (name: NdiOutputName, config: Partial<NdiOutputConfig>) => void;
  };
}

interface StatusBarStateSlice {
  isRunningOperation: boolean;
  operationText: string | null;
  statusText: string;
}

interface NdiLiveStateSlice {
  audienceLive: boolean;
  stageLive: boolean;
}

// ─── Provider (bootstrap-only; state lives in zustand store) ────────

export function AppProvider({ children }: { children: ReactNode }) {
  const retrySnapshotLoad = useAppStore((s) => s.retrySnapshotLoad);
  const setSystemPref = useAppStore((s) => s.setSystemPref);
  const setNdiDiagnostics = useAppStore((s) => s.setNdiDiagnostics);
  const setNdiOutputConfigsState = useAppStore((s) => s.setNdiOutputConfigsState);
  const setNdiOutputStateValue = useAppStore((s) => s.setNdiOutputStateValue);
  const setMediaDerivativeStatusText = useAppStore((s) => s.setMediaDerivativeStatusText);
  const applyPatchLocally = useAppStore((s) => s.applyPatchLocally);
  const handlePersistenceProgress = useAppStore((s) => s.handlePersistenceProgress);
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
    const unsubscribeDerivativeProgress = window.castApi.onMediaDerivativeProgress((progress) => {
      if (progress.patch) {
        void applyPatchLocally(progress.patch).catch((error) => {
          console.error('[AppProvider] Failed to apply media derivative patch:', error);
        });
      }
      setMediaDerivativeStatusText(progress.statusText);
    });
    // Reuses the media-derivatives status slot rather than adding a new one:
    // both are the same kind of message to the user (an ambient background
    // media task is running), and the slot already has exactly the wanted
    // behavior — subordinate to an explicit operation or persistence
    // messaging, and reset to "Ready" once its own statusText goes null.
    const unsubscribeLibraryProgress = window.castApi.onMediaLibraryProgress((progress) => {
      if (progress.patch) {
        // Applying the patch is what keeps the renderer's snapshot in step
        // with the rows main just repointed to their library copy — without
        // it, undo could resurrect a stale external path.
        void applyPatchLocally(progress.patch).catch((error) => {
          console.error('[AppProvider] Failed to apply media library patch:', error);
        });
      }
      setMediaDerivativeStatusText(progress.statusText);
    });
    const unsubscribePersistenceProgress = window.castApi.onPersistenceProgress(handlePersistenceProgress);
    return () => {
      unsubscribeOutput();
      unsubscribeDiagnostics();
      unsubscribeDerivativeProgress();
      unsubscribeLibraryProgress();
      unsubscribePersistenceProgress();
    };
  }, [applyPatchLocally, handlePersistenceProgress, setMediaDerivativeStatusText, setNdiDiagnostics, setNdiOutputConfigsState, setNdiOutputStateValue]);

  return <>{children}</>;
}

// ─── Hooks ──────────────────────────────────────────────────────────

export function useCast(): CastSlice {
  return useAppStore(
    useShallow((s) => ({
      snapshot: s.snapshot,
      isLoadingSnapshot: s.isLoadingSnapshot,
      snapshotLoadError: s.snapshotLoadError,
      canUndo: s.canUndo,
      canRedo: s.canRedo,
      mutate: s.mutate,
      mutatePatch: s.mutatePatch,
      applyPatchLocally: s.applyPatchLocally,
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
  const outputConfigs = useAppStore((s) => s.ndiOutputConfigs);
  const outputState = useAppStore((s) => s.ndiOutputState);
  const setOutputEnabled = useAppStore((s) => s.setNdiOutputEnabled);
  const toggleAudienceOutput = useAppStore((s) => s.toggleAudienceOutput);
  const toggleStageOutput = useAppStore((s) => s.toggleStageOutput);
  const updateOutputConfig = useAppStore((s) => s.updateNdiOutputConfig);
  return useMemo(
    () => ({
      state: { outputConfigs, outputState },
      actions: {
        setOutputEnabled,
        toggleAudienceOutput,
        toggleStageOutput,
        updateOutputConfig,
      },
    }),
    [outputConfigs, outputState, setOutputEnabled, toggleAudienceOutput, toggleStageOutput, updateOutputConfig],
  );
}

export { useAppStore } from './app-store';

export function useStatusBarState(): StatusBarStateSlice {
  return useAppStore(
    useShallow((s) => ({
      isRunningOperation: s.isRunningOperation,
      operationText: s.operationText,
      statusText: s.statusText,
    })),
  );
}

export function useNdiDiagnostics(): NdiDiagnostics | null {
  return useAppStore((s) => s.ndiDiagnostics);
}

export function useNdiLiveState(): NdiLiveStateSlice {
  return useAppStore(
    useShallow((s) => ({
      audienceLive: isSenderLive(s.ndiDiagnostics?.senders.audience ?? null),
      stageLive: isSenderLive(s.ndiDiagnostics?.senders.stage ?? null),
    })),
  );
}

function isSenderLive(sender: NdiDiagnostics['senders']['audience'] | null): boolean {
  if (!sender) return false;
  if (sender.connectionCount === 0) return false;
  return sender.performance.framesSent > 0;
}
