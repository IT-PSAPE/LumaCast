// The three import flows the top bar's "Audio…"/"Lyrics…"/"Background…"
// buttons (and the matching menu commands) call into, each split into a
// dialog-driven entry point (`importAudio`, `importBackground`,
// `importLyrics`) and an `*FromFile` variant that takes an already-admitted
// `ImportedFile` — the shape `workspace.tsx`'s window drag-and-drop handler
// gets back from `api.admitFiles`, so a dropped file and a picked file run
// through exactly the same logic. Every entry point is a plain async
// function: no component, so nothing here needs a render tree of its own. A
// `confirmChoice`/`pushNotice` call renders through the singleton hosts
// mounted once in `App.tsx`.
import { createId } from '@lumacast/kernel';
import { detectCueFormat, parseCues } from '@lumacast/markers';
import { cuesFromPlainLyrics, cuesFromTimedCues } from '../../../shared/cue-model';
import type { ImportedFile } from '../../../shared/desktop-api';
import type { ChordMediaRef } from '../../../shared/project';
import { getApi } from '../../api';
import { confirmChoice } from '../../components/confirm-dialog';
import { pushNotice } from '../../components/notice';
import { useChordStore } from '../../store';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Resolves once the element has metadata (or fails to load); never rejects. */
function probeMediaDuration(url: string, kind: 'audio' | 'video'): Promise<number | null> {
  return new Promise((resolve) => {
    const element = document.createElement(kind);
    element.preload = 'metadata';

    function settle(durationMs: number | null) {
      element.removeAttribute('src');
      element.load();
      resolve(durationMs);
    }

    element.addEventListener('loadedmetadata', () => {
      settle(Number.isFinite(element.duration) ? element.duration * 1000 : null);
    });
    element.addEventListener('error', () => settle(null));
    element.src = url;
  });
}

export async function importAudioFromFile(imported: ImportedFile): Promise<void> {
  const durationMs = imported.url ? await probeMediaDuration(imported.url, 'audio') : null;
  const media: ChordMediaRef = { path: imported.path, name: imported.name, durationMs };
  useChordStore.getState().setAudio(media, imported.url);
}

export async function importAudio(): Promise<void> {
  try {
    const imported = await getApi().importMedia('audio');
    if (!imported) return;
    await importAudioFromFile(imported);
  } catch (error) {
    pushNotice(errorMessage(error, 'Could not import that audio file.'), 'error');
  }
}

export async function importBackgroundFromFile(imported: ImportedFile): Promise<void> {
  if (imported.kind !== 'image' && imported.kind !== 'video') return;
  const store = useChordStore.getState();

  if (imported.kind === 'image') {
    const media: ChordMediaRef = { path: imported.path, name: imported.name, durationMs: null };
    store.setBackground({ kind: 'image', media, fit: 'cover', dim: 0, blur: 0, loop: false }, imported.url);
    return;
  }

  const durationMs = imported.url ? await probeMediaDuration(imported.url, 'video') : null;
  const media: ChordMediaRef = { path: imported.path, name: imported.name, durationMs };
  store.setBackground({ kind: 'video', media, fit: 'cover', dim: 0, blur: 0, loop: true }, imported.url);
}

/**
 * Asks for a background image or video in one dialog; which one the user
 * picked is read back from `ImportedFile.kind`, not from what was requested.
 */
export async function importBackground(): Promise<void> {
  try {
    const imported = await getApi().importMedia('image');
    if (!imported) return;
    await importBackgroundFromFile(imported);
  } catch (error) {
    pushNotice(errorMessage(error, 'Could not import that background file.'), 'error');
  }
}

export async function importLyricsFromFile(imported: ImportedFile): Promise<void> {
  const text = await getApi().readCueFile(imported.path);
  const store = useChordStore.getState();
  const format = detectCueFormat(text, imported.name);

  if (format) {
    const { cues: timed, warnings } = parseCues(text, format);
    for (const warning of warnings) pushNotice(warning, 'error');
    const parsedCues = cuesFromTimedCues(timed, createId);

    const hasExisting = store.document.project.cues.length > 0;
    if (hasExisting) {
      const choice = await confirmChoice(
        'Import lyrics',
        [
          { value: 'append', label: 'Append' },
          { value: 'replace', label: 'Replace', variant: 'danger' },
        ],
        'This project already has lyrics.',
      );
      if (choice === null) return;
      if (choice === 'append') {
        store.replaceCues([...store.document.project.cues, ...parsedCues]);
        return;
      }
    }
    store.replaceCues(parsedCues);
    return;
  }

  // Plain text (or an undetected format): one cue per line, timed by tapping.
  store.replaceCues(cuesFromPlainLyrics(text, createId));
  store.setTool('tap');
}

export async function importLyrics(): Promise<void> {
  try {
    const imported = await getApi().importMedia('cues');
    if (!imported) return;
    await importLyricsFromFile(imported);
  } catch (error) {
    pushNotice(errorMessage(error, 'Could not import that lyrics file.'), 'error');
  }
}
