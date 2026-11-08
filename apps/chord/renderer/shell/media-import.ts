// Picker and drop imports share three document-scoped channels. An action's
// order is allocated before its picker/admission, but only an accepted file
// supersedes previous work in that channel.
import { createId } from '@lumacast/kernel';
import { useToast } from '@lumacast/ui';
import { detectCueFormat, parseCues } from '@lumacast/markers';
import { cuesFromPlainLyrics, cuesFromTimedCues } from '../../shared/cue-model';
import type { ImportedFile } from '../../shared/desktop-api';
import type { ChordMediaRef } from '../../shared/project';
import { getApi } from '../api';
import { confirmChoice } from '../components/confirm-dialog';
import { useChordStore } from '../store';

// useToast exposes the shared imperative toast API without using React state.
// eslint-disable-next-line react-hooks/rules-of-hooks
const { toast } = useToast();

type ImportChannel = 'audio' | 'background' | 'lyrics';
interface ImportAction {
  session: number;
  order: number;
  signal: AbortSignal;
  isCurrent: () => boolean;
  dispose: () => void;
}
interface AcceptedImport {
  action: ImportAction;
  index: number;
  controller: AbortController;
  isCurrent: () => boolean;
  dispose: () => void;
}
let nextActionOrder = 0;
const accepted: Partial<Record<ImportChannel, AcceptedImport>> = {};
const importFailure: Record<ImportChannel, string> = {
  audio: 'Could not import that audio file.',
  background: 'Could not import that background file.',
  lyrics: 'Could not import that lyrics file.',
};

function beginImport(): ImportAction {
  const session = useChordStore.getState().getDocumentSession();
  const controller = new AbortController();
  const unsubscribe = useChordStore.subscribe((state) => {
    if (state.getDocumentSession() !== session) controller.abort();
  });
  controller.signal.addEventListener('abort', unsubscribe, { once: true });
  return {
    session,
    order: ++nextActionOrder,
    signal: controller.signal,
    isCurrent: () => !controller.signal.aborted && useChordStore.getState().getDocumentSession() === session,
    dispose: () => controller.abort(),
  };
}

function canAccept(action: ImportAction, channel: ImportChannel, index: number): boolean {
  if (!action.isCurrent()) return false;
  const previous = accepted[channel];
  if (previous?.action.session === action.session &&
    (previous.action.order > action.order || (previous.action.order === action.order && previous.index >= index))) return false;
  return true;
}

function acceptFile(action: ImportAction, channel: ImportChannel, index: number): AcceptedImport | null {
  if (!canAccept(action, channel, index)) return null;
  const previous = accepted[channel];

  const controller = new AbortController();
  const cancel = () => controller.abort();
  const request: AcceptedImport = {
    action, index, controller,
    isCurrent: () => action.isCurrent() && accepted[channel] === request && !controller.signal.aborted,
    dispose: () => {
      action.signal.removeEventListener('abort', cancel);
      controller.abort();
    },
  };
  // Retain the watermark after settlement: older pickers/batch remainders
  // must not regain authority if this accepted file fails or is dismissed.
  accepted[channel] = request;
  action.signal.addEventListener('abort', cancel, { once: true });
  previous?.controller.abort();
  return request;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Always settles once; cancellation releases the detached metadata element. */
function probeMediaDuration(url: string, kind: 'audio' | 'video', signal: AbortSignal): Promise<number | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const element = document.createElement(kind);
    let settled = false;
    element.preload = 'metadata';
    const metadata = () => settle(Number.isFinite(element.duration) ? element.duration * 1000 : null);
    const failed = () => settle(null);
    function settle(durationMs: number | null) {
      if (settled) return;
      settled = true;
      element.removeEventListener('loadedmetadata', metadata);
      element.removeEventListener('error', failed);
      signal.removeEventListener('abort', failed);
      element.removeAttribute('src');
      element.load();
      resolve(durationMs);
    }
    element.addEventListener('loadedmetadata', metadata);
    element.addEventListener('error', failed);
    signal.addEventListener('abort', failed, { once: true });
    element.src = url;
  });
}

async function applyAudio(imported: ImportedFile, request: AcceptedImport): Promise<void> {
  const durationMs = imported.url ? await probeMediaDuration(imported.url, 'audio', request.controller.signal) : null;
  if (!request.isCurrent()) return;
  const media: ChordMediaRef = { path: imported.path, name: imported.name, durationMs };
  useChordStore.getState().setAudio(media, imported.url);
}

async function applyBackground(imported: ImportedFile, request: AcceptedImport): Promise<void> {
  if (imported.kind !== 'image' && imported.kind !== 'video') return;
  const durationMs = imported.kind === 'video' && imported.url
    ? await probeMediaDuration(imported.url, 'video', request.controller.signal) : null;
  if (!request.isCurrent()) return;
  const media: ChordMediaRef = { path: imported.path, name: imported.name, durationMs };
  useChordStore.getState().setBackground({
    kind: imported.kind, media, fit: 'cover', dim: 0, blur: 0, loop: imported.kind === 'video',
  }, imported.url);
}

/** Stop waiting locally when superseded; the IPC reply/rejection stays observed. */
async function readCueText(path: string, signal: AbortSignal): Promise<string | null> {
  if (signal.aborted) return null;
  let cancel!: () => void;
  const cancelled = new Promise<null>((resolve) => {
    cancel = () => resolve(null);
    signal.addEventListener('abort', cancel, { once: true });
  });
  try {
    return await Promise.race([getApi().readCueFile(path), cancelled]);
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

async function applyLyrics(imported: ImportedFile, request: AcceptedImport): Promise<void> {
  const text = await readCueText(imported.path, request.controller.signal);
  if (text === null || !request.isCurrent()) return;
  const format = detectCueFormat(text, imported.name);
  if (format) {
    const { cues: timed, warnings } = parseCues(text, format);
    for (const warning of warnings) {
      if (!request.isCurrent()) return;
      toast({ description: warning, tone: 'warning' });
    }
    const parsedCues = cuesFromTimedCues(timed, createId);
    if (useChordStore.getState().document.project.cues.length > 0) {
      const choice = await confirmChoice(
        'Import lyrics',
        [
          { value: 'append', label: 'Append' },
          { value: 'replace', label: 'Replace', variant: 'danger' },
        ],
        'This project already has lyrics.',
        { signal: request.controller.signal },
      );
      if (!request.isCurrent() || choice === null) return;
      if (choice === 'append') {
        const current = useChordStore.getState();
        current.replaceCues([...current.document.project.cues, ...parsedCues]);
        return;
      }
    }
    if (request.isCurrent()) useChordStore.getState().replaceCues(parsedCues);
    return;
  }

  useChordStore.getState().replaceCues(cuesFromPlainLyrics(text, createId));
  if (request.isCurrent()) useChordStore.getState().setTool('tap');
}

function channelFor(imported: ImportedFile): ImportChannel | null {
  return imported.kind === 'audio' ? 'audio'
    : imported.kind === 'image' || imported.kind === 'video' ? 'background'
      : imported.kind === 'cues' ? 'lyrics' : null;
}

async function applyFile(imported: ImportedFile, action: ImportAction, index = 0): Promise<void> {
  const channel = channelFor(imported);
  if (!channel) return;
  const request = acceptFile(action, channel, index);
  if (!request) return;
  try {
    if (channel === 'audio') await applyAudio(imported, request);
    else if (channel === 'background') await applyBackground(imported, request);
    else await applyLyrics(imported, request);
  } catch (error) {
    if (request.isCurrent()) toast({ description: errorMessage(error, importFailure[channel]), tone: 'error' });
  } finally {
    request.dispose();
  }
}

async function importFromFile(imported: ImportedFile): Promise<void> {
  const action = beginImport();
  try { await applyFile(imported, action); }
  finally { action.dispose(); }
}

export function importAudioFromFile(imported: ImportedFile): Promise<void> {
  return imported.kind === 'audio' ? importFromFile(imported) : Promise.resolve();
}
export function importBackgroundFromFile(imported: ImportedFile): Promise<void> {
  return imported.kind === 'image' || imported.kind === 'video' ? importFromFile(imported) : Promise.resolve();
}
export function importLyricsFromFile(imported: ImportedFile): Promise<void> {
  return imported.kind === 'cues' ? importFromFile(imported) : Promise.resolve();
}

async function pickImport(kind: 'audio' | 'image' | 'cues'): Promise<void> {
  const action = beginImport();
  const channel = kind === 'audio' ? 'audio' : kind === 'image' ? 'background' : 'lyrics';
  try {
    const imported = await getApi().importMedia(kind);
    if (imported && channelFor(imported) === channel && action.isCurrent()) await applyFile(imported, action);
  } catch (error) {
    if (canAccept(action, channel, 0)) toast({ description: errorMessage(error, importFailure[channel]), tone: 'error' });
  } finally {
    action.dispose();
  }
}

export function importAudio(): Promise<void> {
  return pickImport('audio');
}
export function importBackground(): Promise<void> {
  return pickImport('image');
}
export function importLyrics(): Promise<void> {
  return pickImport('cues');
}

/** Capture ownership before admission, retaining one action order across a batch. */
export async function importDroppedFiles(files: File[]): Promise<void> {
  const action = beginImport();
  try {
    const api = getApi();
    const paths = api.pathsForFiles(files);
    if (paths.length === 0) return;
    const admitted = await api.admitFiles(paths);
    if (!action.isCurrent()) return;
    for (const [index, file] of admitted.entries()) {
      if (!action.isCurrent()) return;
      await applyFile(file, action, index);
    }
  } catch (error) {
    if (action.isCurrent()) toast({ description: errorMessage(error, 'Could not import the dropped file(s).'), tone: 'error' });
  } finally {
    action.dispose();
  }
}
