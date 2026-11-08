import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createEmptyProject } from '../../../../../apps/chord/shared/project-schema';
import type { ChordDesktopAPI, ImportedFile } from '../../../../../apps/chord/shared/desktop-api';

const mocks = vi.hoisted(() => ({
  api: {
    setEditableFocus: vi.fn<ChordDesktopAPI['setEditableFocus']>(),
    newProject: vi.fn<ChordDesktopAPI['newProject']>(),
    openProject: vi.fn<ChordDesktopAPI['openProject']>(),
    saveProject: vi.fn<ChordDesktopAPI['saveProject']>(),
    recentProjects: vi.fn<ChordDesktopAPI['recentProjects']>(),
    setDocumentState: vi.fn<ChordDesktopAPI['setDocumentState']>(),
    importMedia: vi.fn<ChordDesktopAPI['importMedia']>(),
    admitFiles: vi.fn<ChordDesktopAPI['admitFiles']>(),
    pathsForFiles: vi.fn<ChordDesktopAPI['pathsForFiles']>(),
    mediaUrl: vi.fn<ChordDesktopAPI['mediaUrl']>(),
    readCueFile: vi.fn<ChordDesktopAPI['readCueFile']>(),
    exportCues: vi.fn<ChordDesktopAPI['exportCues']>(),
    chooseExportPath: vi.fn<ChordDesktopAPI['chooseExportPath']>(),
    exportOpen: vi.fn<ChordDesktopAPI['exportOpen']>(),
    exportWrite: vi.fn<ChordDesktopAPI['exportWrite']>(),
    exportClose: vi.fn<ChordDesktopAPI['exportClose']>(),
    exportAbort: vi.fn<ChordDesktopAPI['exportAbort']>(),
    revealPath: vi.fn<ChordDesktopAPI['revealPath']>(),
    showApplicationMenu: vi.fn<ChordDesktopAPI['showApplicationMenu']>(),
    onMenuCommand: vi.fn<ChordDesktopAPI['onMenuCommand']>(),
    documentNavigationReady: vi.fn<ChordDesktopAPI['documentNavigationReady']>(),
    requestWindowClose: vi.fn<ChordDesktopAPI['requestWindowClose']>(),
    onOpenProjectRequest: vi.fn<ChordDesktopAPI['onOpenProjectRequest']>(),
  },
  toast: vi.fn(),
}));
vi.mock('../../../../../apps/chord/renderer/api', () => ({ getApi: () => mocks.api }));
vi.mock('@lumacast/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('@lumacast/ui')>(),
  useToast: () => ({ toast: mocks.toast }),
}));

import { useChordStore } from '../../../../../apps/chord/renderer/store';
import { ConfirmHost, confirmChoice } from '../../../../../apps/chord/renderer/components/confirm-dialog';
import {
  importAudio, importAudioFromFile, importBackgroundFromFile, importDroppedFiles,
  importLyricsFromFile,
} from '../../../../../apps/chord/renderer/shell/media-import';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function load(id = 'document', cues: string[] = []) {
  const project = createEmptyProject('2026-11-08T00:00:00.000Z', id);
  project.cues = cues.map((text, index) => ({
    id: `${id}-${index}`, text, startMs: index * 1000, endMs: null, override: null,
  }));
  useChordStore.getState().loadDocument({ project, path: null });
}
function file(name: string, kind: ImportedFile['kind'] = 'audio', url: string | null = null): ImportedFile {
  return { kind, path: `/tmp/${name}`, name, url, sizeBytes: 100 };
}
function probes() {
  const created: HTMLMediaElement[] = [];
  const original = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((name: string, options?: ElementCreationOptions) => {
    const element = original(name, options);
    if (name === 'audio' || name === 'video') {
      Object.defineProperty(element, 'duration', { configurable: true, value: 9 });
      vi.spyOn(element as HTMLMediaElement, 'load').mockImplementation(() => {});
      created.push(element as HTMLMediaElement);
    }
    return element;
  }) as Document['createElement']);
  return created;
}
const state = () => useChordStore.getState();
const cueTexts = () => state().document.project.cues.map((cue) => cue.text);
const csv = '1,00:00:05.000,Imported\n';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.api.mediaUrl.mockResolvedValue(null);
  mocks.api.setDocumentState.mockResolvedValue(undefined);
  mocks.api.pathsForFiles.mockImplementation((files) => files.map((entry) => `/tmp/${entry.name}`));
  mocks.api.admitFiles.mockResolvedValue([]);
  load();
});
afterEach(() => {
  act(() => load('cleanup'));
  cleanup();
  vi.restoreAllMocks();
});

describe('Chord real-store import ownership', () => {
  it('settles an overlapped visible confirmation instead of orphaning its caller', async () => {
    render(<ConfirmHost />);
    let first!: Promise<string | null>;
    let second!: Promise<string | null>;
    act(() => {
      first = confirmChoice('First', [{ value: 'first', label: 'Accept first' }]);
      second = confirmChoice('Second', [{ value: 'second', label: 'Accept second' }]);
    });
    await expect(first).resolves.toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Accept second' }));
    await expect(second).resolves.toBe('second');
  });

  it.each([false, true])('does not apply a picked file after document replacement (same ID: %s)', async (sameId) => {
    const chosen = deferred<ImportedFile | null>();
    mocks.api.importMedia.mockReturnValueOnce(chosen.promise);
    const pending = importAudio();
    load(sameId ? 'document' : 'other');
    chosen.resolve(file('old.wav'));
    await pending;
    expect(state().document.project.audio).toBeNull();
  });

  it.each(['audio', 'video'] as const)('cancels a detached %s probe when the same-ID document is reloaded', async (kind) => {
    const elements = probes();
    const pending = kind === 'audio'
      ? importAudioFromFile(file('old.wav', 'audio', 'lumachord://file/old.wav'))
      : importBackgroundFromFile(file('old.mp4', 'video', 'lumachord://file/old.mp4'));
    const element = elements[0]!;
    expect(element.getAttribute('src')).not.toBeNull();
    load('document');
    await pending;

    expect(element.getAttribute('src')).toBeNull();
    expect(element.load).toHaveBeenCalledTimes(1);
    element.dispatchEvent(new Event('loadedmetadata'));
    element.dispatchEvent(new Event('error'));
    expect(element.load).toHaveBeenCalledTimes(1);
    expect(state().document.project.audio).toBeNull();
    expect(state().document.project.background.kind).toBe('color');
  });

  it('keeps the newest accepted audio while retiring an unfinished older probe', async () => {
    const elements = probes();
    const older = importAudioFromFile(file('older.wav', 'audio', 'lumachord://file/older.wav'));
    const newer = importAudioFromFile(file('newer.wav', 'audio', 'lumachord://file/newer.wav'));
    await older;
    elements[1]!.dispatchEvent(new Event('loadedmetadata'));
    await newer;
    elements[0]!.dispatchEvent(new Event('loadedmetadata'));
    expect(state().document.project.audio?.name).toBe('newer.wav');
    expect(elements[0]!.getAttribute('src')).toBeNull();
  });

  it('does not let reverse picker replies restore an older user action', async () => {
    const first = deferred<ImportedFile | null>();
    const second = deferred<ImportedFile | null>();
    mocks.api.importMedia.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const older = importAudio();
    const newer = importAudio();
    second.resolve(file('newer.wav'));
    await newer;
    first.resolve(file('older.wav'));
    await older;
    expect(state().document.project.audio?.name).toBe('newer.wav');
  });

  it('does not retire an accepted probe when a newer picker is cancelled', async () => {
    const elements = probes();
    const accepted = importAudioFromFile(file('accepted.wav', 'audio', 'lumachord://file/accepted.wav'));
    mocks.api.importMedia.mockResolvedValueOnce(null);
    await importAudio();
    expect(elements[0]!.getAttribute('src')).not.toBeNull();
    elements[0]!.dispatchEvent(new Event('loadedmetadata'));
    await accepted;
    expect(state().document.project.audio?.name).toBe('accepted.wav');
  });

  it('preserves ordinary edits while an import is pending', async () => {
    const elements = probes();
    const session = state().getDocumentSession();
    const pending = importAudioFromFile(file('audio.wav', 'audio', 'lumachord://file/audio.wav'));
    state().setTitle('Edited while importing');
    expect(state().getDocumentSession()).toBe(session);
    elements[0]!.dispatchEvent(new Event('loadedmetadata'));
    await pending;
    expect(state().document.project.title).toBe('Edited while importing');
    expect(state().document.project.audio?.name).toBe('audio.wav');
  });

  it('does not replace another same-ID document with delayed plain lyrics', async () => {
    load('document', ['Original']);
    const read = deferred<string>();
    mocks.api.readCueFile.mockReturnValueOnce(read.promise);
    const pending = importLyricsFromFile(file('old.txt', 'cues'));
    load('document', ['Replacement']);
    read.resolve('Old imported line');
    await pending;
    expect(cueTexts()).toEqual(['Replacement']);
    expect(state().tool).toBe('select');
  });

  it('appends to the current cues, preserving edits made while the prompt was open', async () => {
    load('document', ['Original']);
    mocks.api.readCueFile.mockResolvedValueOnce(csv);
    render(<ConfirmHost />);
    let pending!: Promise<void>;
    await act(async () => { pending = importLyricsFromFile(file('lyrics.csv', 'cues')); });
    act(() => { state().addCue(2000, 'Added while prompt open'); });
    fireEvent.click(await screen.findByRole('button', { name: 'Append' }));
    await pending;
    expect(cueTexts()).toEqual(['Original', 'Added while prompt open', 'Imported']);
  });

  it('actively closes a lyric prompt on same-ID reload and ignores its stale choice', async () => {
    load('document', ['Original']);
    mocks.api.readCueFile.mockResolvedValueOnce(csv);
    render(<ConfirmHost />);
    let pending!: Promise<void>;
    await act(async () => { pending = importLyricsFromFile(file('lyrics.csv', 'cues')); });
    const replace = await screen.findByRole('button', { name: 'Replace' });
    act(() => load('document', ['Replacement']));
    await pending;
    fireEvent.click(replace);
    expect(screen.queryByRole('button', { name: 'Replace' })).not.toBeInTheDocument();
    expect(cueTexts()).toEqual(['Replacement']);
  });

  it('keeps a dismissed newer lyric selection authoritative over an older pending read', async () => {
    load('document', ['Original']);
    const olderRead = deferred<string>();
    mocks.api.readCueFile.mockReturnValueOnce(olderRead.promise).mockResolvedValueOnce(csv);
    const older = importLyricsFromFile(file('old.txt', 'cues'));
    render(<ConfirmHost />);
    let newer!: Promise<void>;
    await act(async () => { newer = importLyricsFromFile(file('new.csv', 'cues')); });
    fireEvent.click(await screen.findByLabelText('Close dialog'));
    await newer;
    olderRead.resolve('Older line');
    await older;
    expect(cueTexts()).toEqual(['Original']);
  });

  it('keeps accepted audio and background imports independent', async () => {
    const elements = probes();
    const audio = importAudioFromFile(file('audio.wav', 'audio', 'lumachord://file/audio.wav'));
    const background = importBackgroundFromFile(file('background.mp4', 'video', 'lumachord://file/background.mp4'));
    elements[1]!.dispatchEvent(new Event('loadedmetadata'));
    await background;
    expect(elements[0]!.getAttribute('src')).not.toBeNull();
    elements[0]!.dispatchEvent(new Event('loadedmetadata'));
    await audio;
    expect(state().document.project.audio?.name).toBe('audio.wav');
    expect(state().document.project.background.kind).toBe('video');
  });

  it('captures drop ownership before admission, including same-ID reloads', async () => {
    const admission = deferred<ImportedFile[]>();
    mocks.api.admitFiles.mockReturnValueOnce(admission.promise);
    const pending = importDroppedFiles([new File([], 'drop.wav')]);
    load('document');
    admission.resolve([file('drop.wav')]);
    await pending;
    expect(state().document.project.audio).toBeNull();
  });

  it('does not let a delayed old admission supersede a newer accepted audio', async () => {
    const admission = deferred<ImportedFile[]>();
    mocks.api.admitFiles.mockReturnValueOnce(admission.promise);
    const oldDrop = importDroppedFiles([new File([], 'drop.wav')]);
    await importAudioFromFile(file('newer.wav'));
    admission.resolve([file('drop.wav')]);
    await oldDrop;
    expect(state().document.project.audio?.name).toBe('newer.wav');
  });

  it('keeps later old-batch audio inert while allowing the batch background to finish', async () => {
    const elements = probes();
    mocks.api.admitFiles.mockResolvedValueOnce([
      file('first.wav', 'audio', 'lumachord://file/first.wav'),
      file('old-remainder.wav'),
      file('background.png', 'image'),
    ]);
    const oldBatch = importDroppedFiles([new File([], 'batch')]);
    await vi.waitFor(() => expect(elements).toHaveLength(1));
    await importAudioFromFile(file('newer.wav'));
    await oldBatch;
    expect(state().document.project.audio?.name).toBe('newer.wav');
    expect(state().document.project.background.kind).toBe('image');
    expect(elements[0]!.getAttribute('src')).toBeNull();
  });

  it('keeps the last same-channel file in one sequential batch', async () => {
    mocks.api.admitFiles.mockResolvedValueOnce([file('first.wav'), file('last.wav')]);
    await importDroppedFiles([new File([], 'batch')]);
    expect(state().document.project.audio?.name).toBe('last.wav');
  });

  it('suppresses stale read and picker failures after replacement or a newer accepted action', async () => {
    const read = deferred<string>();
    mocks.api.readCueFile.mockReturnValueOnce(read.promise);
    const oldLyrics = importLyricsFromFile(file('old.txt', 'cues'));
    load('other');
    read.reject(new Error('Old read failure'));
    await oldLyrics;

    const picker = deferred<ImportedFile | null>();
    mocks.api.importMedia.mockReturnValueOnce(picker.promise);
    const oldPicker = importAudio();
    await importAudioFromFile(file('accepted.wav'));
    picker.reject(new Error('Old picker failure'));
    await oldPicker;
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('keeps independent batch channels usable after one file fails', async () => {
    mocks.api.admitFiles.mockResolvedValueOnce([file('bad.txt', 'cues'), file('audio.wav')]);
    mocks.api.readCueFile.mockRejectedValueOnce(new Error('Unreadable lyrics'));
    await importDroppedFiles([new File([], 'batch')]);
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({ description: 'Unreadable lyrics', tone: 'error' });
    expect(state().document.project.audio?.name).toBe('audio.wav');
  });

  it('unsubscribes document observers after successful or invalidated work', async () => {
    const original = useChordStore.subscribe;
    const unsubscribe = vi.fn();
    vi.spyOn(useChordStore, 'subscribe').mockImplementation((listener) => {
      const stop = original(listener);
      return () => { unsubscribe(); stop(); };
    });
    await importAudioFromFile(file('audio.wav'));
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    const picker = deferred<ImportedFile | null>();
    mocks.api.importMedia.mockReturnValueOnce(picker.promise);
    const pending = importAudio();
    load('other');
    expect(unsubscribe).toHaveBeenCalledTimes(2);
    picker.resolve(null);
    await pending;
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });

  it('releases a superseded cue read so an old batch can finish independent media before the IPC reply', async () => {
    const original = useChordStore.subscribe;
    const stopped = vi.fn();
    vi.spyOn(useChordStore, 'subscribe').mockImplementation((listener) => {
      const stop = original(listener);
      return () => { stopped(); stop(); };
    });
    const stalled = deferred<string>();
    mocks.api.admitFiles.mockResolvedValueOnce([file('older.txt', 'cues'), file('background.png', 'image')]);
    mocks.api.readCueFile.mockReturnValueOnce(stalled.promise).mockResolvedValueOnce('Newer lyrics');
    const batch = importDroppedFiles([new File([], 'batch')]);
    await vi.waitFor(() => expect(mocks.api.readCueFile).toHaveBeenCalledWith('/tmp/older.txt'));
    try {
      await importLyricsFromFile(file('newer.txt', 'cues'));
      await vi.waitFor(() => expect(state().document.project.background.kind).toBe('image'));
      await batch;
      expect(cueTexts()).toEqual(['Newer lyrics']);
      expect(stopped).toHaveBeenCalledTimes(2);
    } finally {
      // A late rejection must stay observed after local cancellation settles.
      stalled.reject(new Error('Late stale cue read failure'));
      await batch;
    }
    await Promise.resolve();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
