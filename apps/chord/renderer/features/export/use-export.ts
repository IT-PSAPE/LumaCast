// Wires the export engine to the desktop API's file sink and the store's
// exportJob state. export-engine.ts never touches Electron or the
// filesystem directly — this hook is the only place that does.
import { useCallback, useEffect, useRef } from 'react';
import { useChordStore } from '../../store';
import type { ExportJobState } from '../../store/types';
import { exportFileName, type ExportSettings } from '../../../shared/export-presets';
import { runExport, type ExportSink } from './export-engine';

function extensionFor(settings: ExportSettings): string {
  if (settings.kind === 'video') return settings.container;
  if (settings.kind === 'audio') return settings.format;
  return 'png';
}

export interface UseExportResult {
  start(settings: ExportSettings): Promise<void>;
  cancel(): void;
}

export interface StartExportOptions {
  /** Skip the save dialog and write here (a re-export, or an automated run). */
  outputPath?: string;
}

interface ExportOperation {
  controller: AbortController;
  documentSession: number;
  sealed: boolean;
}

let activeOperation: ExportOperation | null = null;

function hasCurrentOperation(): boolean {
  return activeOperation?.documentSession === useChordStore.getState().getDocumentSession();
}

function cancelController(controller: AbortController | null): void {
  if (controller && activeOperation?.controller === controller && !activeOperation.sealed) controller.abort();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Export failed.';
}

/**
 * Runs one export to completion, cancellation, or failure, reporting through
 * the store's exportJob. Independent of React so the dialog hook and a dev
 * smoke test share the exact same path.
 */
export async function startExport(
  settings: ExportSettings,
  controller: AbortController,
  options: StartExportOptions = {},
): Promise<void> {
  if (hasCurrentOperation()) return;
  activeOperation?.controller.abort();
  const { document, media, getDocumentSession } = useChordStore.getState();
  const exportSettings = { ...settings };
  const operation: ExportOperation = { controller, documentSession: getDocumentSession(), sealed: false };
  activeOperation = operation;
  const api = window.lumachord;
  const ownsJob = () => activeOperation === operation
    && useChordStore.getState().getDocumentSession() === operation.documentSession;
  const canContinue = () => ownsJob() && !controller.signal.aborted;
  const updateJob = (patch: Partial<ExportJobState>) => {
    if (ownsJob()) useChordStore.getState().setExportJob(patch);
  };
  let openedId: string | null = null;
  let closed = false;
  let cleanup: Promise<void> | null = null;
  let cleanupFailure: unknown;
  let failed = false;
  let failure: unknown;
  const cleanupSink = (afterCloseFailure = false): Promise<void> => {
    if (!api || !openedId || closed || (operation.sealed && !afterCloseFailure)) return Promise.resolve();
    return cleanup ??= api.exportAbort(openedId).catch((error: unknown) => { cleanupFailure = error; });
  };
  const onAbort = () => { void cleanupSink(); };
  controller.signal.addEventListener('abort', onAbort);
  let unsubscribe = () => {};
  unsubscribe = useChordStore.subscribe(() => {
    if (useChordStore.getState().getDocumentSession() === operation.documentSession) return;
    if (activeOperation === operation) activeOperation = null;
    unsubscribe();
    controller.abort();
  });

  updateJob({ status: 'preparing', percent: 0, etaMs: null, outputPath: null, error: null });
  try {
    if (!api) throw new Error('The desktop bridge is unavailable.');
    if (!canContinue()) return;
    const path = options.outputPath ?? await api.chooseExportPath(exportFileName(document.project.title, exportSettings), extensionFor(exportSettings));
    if (!canContinue()) return;
    if (!path) {
      updateJob({ status: 'idle' });
      return;
    }
    updateJob({ outputPath: path });
    openedId = (await api.exportOpen(path)).id;
    if (!canContinue()) return;
    const sinkId = openedId;
    const sink: ExportSink = { write: (position, bytes) => api.exportWrite(sinkId, position, bytes) };
    await runExport({
      project: document.project, settings: exportSettings, audioUrl: media.audioUrl, backgroundUrl: media.backgroundUrl,
      sink, signal: controller.signal,
      onProgress: (progress) => {
        if (canContinue()) updateJob({ status: progress.stage, percent: progress.percent, etaMs: progress.etaMs });
      },
    });
    if (!canContinue()) return;

    // Main accepts the first terminal request. Once Close is admitted, a later
    // cancellation cannot undo publication or truthfully report "cancelled".
    operation.sealed = true;
    await api.exportClose(sinkId);
    closed = true;
    updateJob({ status: 'done', percent: 100, etaMs: 0, outputPath: path });
  } catch (error) {
    failed = operation.sealed || !controller.signal.aborted;
    failure = error;
  } finally {
    unsubscribe();
    controller.signal.removeEventListener('abort', onAbort);
    // After a failed Close, Abort is only a cleanup retry; Close is never retried.
    await cleanupSink(operation.sealed && failed);
    if (failed || cleanupFailure !== undefined) {
      const message = failed ? errorMessage(failure) : 'Export was cancelled.';
      updateJob({ status: 'failed', error: cleanupFailure === undefined ? message : `${message}\nCleanup failed: ${errorMessage(cleanupFailure)}` });
    } else if (controller.signal.aborted && !operation.sealed) {
      updateJob({ status: 'cancelled', percent: 0, etaMs: null });
    }
    if (activeOperation === operation) activeOperation = null;
  }
}

// Development only: lets the CDP smoke test run a real export without the
// native save dialog. Dead-code eliminated from production bundles.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __lumachordStartExport?: unknown }).__lumachordStartExport =
    (settings: ExportSettings, outputPath: string) => startExport(settings, new AbortController(), { outputPath });
}

export function useExport(): UseExportResult {
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => cancelController(controllerRef.current), []);

  const start = useCallback(async (settings: ExportSettings): Promise<void> => {
    // A rejected admission must not replace the controller of the running job.
    if (hasCurrentOperation()) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      await startExport(settings, controller);
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, []);

  const cancel = useCallback((): void => {
    cancelController(controllerRef.current);
  }, []);

  return { start, cancel };
}
