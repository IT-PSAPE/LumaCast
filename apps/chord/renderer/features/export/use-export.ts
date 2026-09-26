// Wires the export engine to the desktop API's file sink and the store's
// exportJob state. export-engine.ts never touches Electron or the
// filesystem directly — this hook is the only place that does.
import { useCallback, useRef } from 'react';
import { useChordStore } from '../../store';
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
    const api = window.lumachord;
    if (!api) throw new Error('The desktop bridge is unavailable.');

    const { document, media } = useChordStore.getState();
    const { project } = document;
    const suggestedName = exportFileName(project.title, settings);
    const path = options.outputPath ?? await api.chooseExportPath(suggestedName, extensionFor(settings));
    if (!path) return;

    useChordStore.getState().setExportJob({ status: 'preparing', percent: 0, etaMs: null, outputPath: path, error: null });

    const opened = await api.exportOpen(path);
    const sink: ExportSink = {
      write: (position, bytes) => api.exportWrite(opened.id, position, bytes),
    };

    try {
      await runExport({
        project,
        settings,
        audioUrl: media.audioUrl,
        backgroundUrl: media.backgroundUrl,
        sink,
        signal: controller.signal,
        onProgress: (progress) => {
          useChordStore.getState().setExportJob({
            status: progress.stage,
            percent: progress.percent,
            etaMs: progress.etaMs,
          });
        },
      });

      if (controller.signal.aborted) {
        await api.exportAbort(opened.id);
        useChordStore.getState().setExportJob({ status: 'cancelled', percent: 0, etaMs: null });
        return;
      }

      await api.exportClose(opened.id);
      useChordStore.getState().setExportJob({ status: 'done', percent: 100, etaMs: 0, outputPath: path });
    } catch (error) {
      await api.exportAbort(opened.id).catch(() => undefined);
      useChordStore.getState().setExportJob({
        status: 'failed',
        error: error instanceof Error ? error.message : 'Export failed.',
      });
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

  const start = useCallback(async (settings: ExportSettings): Promise<void> => {
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      await startExport(settings, controller);
    } finally {
      controllerRef.current = null;
    }
  }, []);

  const cancel = useCallback((): void => {
    controllerRef.current?.abort();
  }, []);

  return { start, cancel };
}
