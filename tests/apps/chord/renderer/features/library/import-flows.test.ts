// import-flows.ts is plain `.ts` (no component), so these tests call its
// exported async functions directly and assert on the store/api/confirm/
// notice mocks they drive. `@lumacast/markers` and the shared `cue-model`
// pure helpers are real (both are stable, already-built) — only the desktop
// API, the store, and the two singleton UI hosts (confirm/notice) are
// mocked.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestStore, type TestChordStore } from '../../test-store';
import type { ChordDesktopAPI, ImportedFile } from '../../../../../../apps/chord/shared/desktop-api';

const apiMock: ChordDesktopAPI = {
  newProject: vi.fn(),
  openProject: vi.fn(),
  saveProject: vi.fn(),
  recentProjects: vi.fn(),
  setDocumentState: vi.fn(),
  importMedia: vi.fn(),
  admitFiles: vi.fn(),
  pathsForFiles: vi.fn(),
  mediaUrl: vi.fn(),
  readCueFile: vi.fn(),
  exportCues: vi.fn(),
  chooseExportPath: vi.fn(),
  exportOpen: vi.fn(),
  exportWrite: vi.fn(),
  exportClose: vi.fn(),
  exportAbort: vi.fn(),
  revealPath: vi.fn(),
  onMenuCommand: vi.fn(),
  onOpenDocument: vi.fn(),
};

vi.mock('../../../../../../apps/chord/renderer/api', () => ({
  getApi: () => apiMock,
}));

let testStore: TestChordStore;

vi.mock('../../../../../../apps/chord/renderer/store', () => ({
  useChordStore: { getState: () => testStore },
}));

const confirmChoiceMock = vi.fn<(title: string, choices: unknown[], message?: string) => Promise<string | null>>();
vi.mock('../../../../../../apps/chord/renderer/components/confirm-dialog', () => ({
  confirmChoice: (...args: [string, unknown[], string?]) => confirmChoiceMock(...args),
}));

const pushNoticeMock = vi.fn();
vi.mock('../../../../../../apps/chord/renderer/components/notice', () => ({
  pushNotice: (...args: [string, string?]) => pushNoticeMock(...args),
}));

import { importAudio, importBackground, importLyrics } from '../../../../../../apps/chord/renderer/features/library/import-flows';

function importedFile(overrides: Partial<ImportedFile> = {}): ImportedFile {
  return { kind: 'audio', path: '/tmp/file', name: 'file', url: null, sizeBytes: 100, ...overrides };
}

describe('import-flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testStore = createTestStore();
  });

  describe('importAudio', () => {
    it('sets the audio track from the picked file', async () => {
      vi.mocked(apiMock.importMedia).mockResolvedValueOnce(importedFile({ kind: 'audio', path: '/song.mp3', name: 'song.mp3', url: null }));
      await importAudio();
      expect(testStore.setAudio).toHaveBeenCalledWith({ path: '/song.mp3', name: 'song.mp3', durationMs: null }, null);
    });

    it('does nothing when the user cancels the picker', async () => {
      vi.mocked(apiMock.importMedia).mockResolvedValueOnce(null);
      await importAudio();
      expect(testStore.setAudio).not.toHaveBeenCalled();
    });

    it('surfaces an error notice when the api rejects', async () => {
      vi.mocked(apiMock.importMedia).mockRejectedValueOnce(new Error('disk exploded'));
      await importAudio();
      expect(testStore.setAudio).not.toHaveBeenCalled();
      expect(pushNoticeMock).toHaveBeenCalledWith('disk exploded', 'error');
    });
  });

  describe('importBackground', () => {
    it('sets an image background for a picked image', async () => {
      vi.mocked(apiMock.importMedia).mockResolvedValueOnce(importedFile({ kind: 'image', path: '/bg.png', name: 'bg.png', url: 'lumachord://file/bg.png' }));
      await importBackground();
      expect(testStore.setBackground).toHaveBeenCalledWith(
        { kind: 'image', media: { path: '/bg.png', name: 'bg.png', durationMs: null }, fit: 'cover', dim: 0, blur: 0, loop: false },
        'lumachord://file/bg.png',
      );
    });

    it('sets a looping video background for a picked video (no url: skips duration probing)', async () => {
      vi.mocked(apiMock.importMedia).mockResolvedValueOnce(importedFile({ kind: 'video', path: '/bg.mp4', name: 'bg.mp4', url: null }));
      await importBackground();
      expect(testStore.setBackground).toHaveBeenCalledWith(
        { kind: 'video', media: { path: '/bg.mp4', name: 'bg.mp4', durationMs: null }, fit: 'cover', dim: 0, blur: 0, loop: true },
        null,
      );
    });

    it('ignores a picked file that is neither an image nor a video', async () => {
      vi.mocked(apiMock.importMedia).mockResolvedValueOnce(importedFile({ kind: 'audio' }));
      await importBackground();
      expect(testStore.setBackground).not.toHaveBeenCalled();
    });

    it('does nothing when cancelled', async () => {
      vi.mocked(apiMock.importMedia).mockResolvedValueOnce(null);
      await importBackground();
      expect(testStore.setBackground).not.toHaveBeenCalled();
    });
  });

  describe('importLyrics', () => {
    const csv = '1,00:00:01.000,Hello world\n2,00:00:05.000,Second line\n';

    it('parses a recognised format and replaces cues directly when the project is empty', async () => {
      vi.mocked(apiMock.importMedia).mockResolvedValueOnce(importedFile({ kind: 'cues', path: '/l.csv', name: 'l.csv' }));
      vi.mocked(apiMock.readCueFile).mockResolvedValueOnce(csv);
      testStore = createTestStore({ document: { project: { ...createTestStore().document.project, cues: [] }, path: null } });

      await importLyrics();

      expect(confirmChoiceMock).not.toHaveBeenCalled();
      expect(testStore.replaceCues).toHaveBeenCalledTimes(1);
      const cues = vi.mocked(testStore.replaceCues).mock.calls[0]![0];
      expect(cues.map((c) => c.text)).toEqual(['Hello world', 'Second line']);
      expect(cues[0]!.startMs).toBe(1000);
    });

    it('asks Replace/Append when the project already has cues, and appends on "append"', async () => {
      const existingProject = createTestStore().document.project;
      testStore = createTestStore({
        document: { project: { ...existingProject, cues: [{ id: 'existing', startMs: 0, endMs: null, text: 'Old', override: null }] }, path: null },
      });
      vi.mocked(apiMock.importMedia).mockResolvedValueOnce(importedFile({ kind: 'cues', path: '/l.csv', name: 'l.csv' }));
      vi.mocked(apiMock.readCueFile).mockResolvedValueOnce(csv);
      confirmChoiceMock.mockResolvedValueOnce('append');

      await importLyrics();

      expect(confirmChoiceMock).toHaveBeenCalledTimes(1);
      const cues = vi.mocked(testStore.replaceCues).mock.calls[0]![0];
      expect(cues.map((c) => c.text)).toEqual(['Old', 'Hello world', 'Second line']);
    });

    it('replaces (dropping the old cues) on "replace"', async () => {
      const existingProject = createTestStore().document.project;
      testStore = createTestStore({
        document: { project: { ...existingProject, cues: [{ id: 'existing', startMs: 0, endMs: null, text: 'Old', override: null }] }, path: null },
      });
      vi.mocked(apiMock.importMedia).mockResolvedValueOnce(importedFile({ kind: 'cues', path: '/l.csv', name: 'l.csv' }));
      vi.mocked(apiMock.readCueFile).mockResolvedValueOnce(csv);
      confirmChoiceMock.mockResolvedValueOnce('replace');

      await importLyrics();

      const cues = vi.mocked(testStore.replaceCues).mock.calls[0]![0];
      expect(cues.map((c) => c.text)).toEqual(['Hello world', 'Second line']);
    });

    it('does nothing when the Replace/Append prompt is dismissed', async () => {
      const existingProject = createTestStore().document.project;
      testStore = createTestStore({
        document: { project: { ...existingProject, cues: [{ id: 'existing', startMs: 0, endMs: null, text: 'Old', override: null }] }, path: null },
      });
      vi.mocked(apiMock.importMedia).mockResolvedValueOnce(importedFile({ kind: 'cues', path: '/l.csv', name: 'l.csv' }));
      vi.mocked(apiMock.readCueFile).mockResolvedValueOnce(csv);
      confirmChoiceMock.mockResolvedValueOnce(null);

      await importLyrics();

      expect(testStore.replaceCues).not.toHaveBeenCalled();
    });

    it('treats plain/undetected text as one cue per line and switches to tap mode', async () => {
      vi.mocked(apiMock.importMedia).mockResolvedValueOnce(importedFile({ kind: 'cues', path: '/l.txt', name: 'l.txt' }));
      vi.mocked(apiMock.readCueFile).mockResolvedValueOnce('First line\n\nSecond line\n');

      await importLyrics();

      expect(confirmChoiceMock).not.toHaveBeenCalled();
      const cues = vi.mocked(testStore.replaceCues).mock.calls[0]![0];
      expect(cues.map((c) => c.text)).toEqual(['First line', 'Second line']);
      expect(testStore.setTool).toHaveBeenCalledWith('tap');
    });

    it('does nothing when cancelled', async () => {
      vi.mocked(apiMock.importMedia).mockResolvedValueOnce(null);
      await importLyrics();
      expect(testStore.replaceCues).not.toHaveBeenCalled();
      expect(apiMock.readCueFile).not.toHaveBeenCalled();
    });

    it('surfaces an error notice when reading the file fails', async () => {
      vi.mocked(apiMock.importMedia).mockResolvedValueOnce(importedFile({ kind: 'cues', path: '/l.csv', name: 'l.csv' }));
      vi.mocked(apiMock.readCueFile).mockRejectedValueOnce(new Error('cannot read file'));
      await importLyrics();
      expect(pushNoticeMock).toHaveBeenCalledWith('cannot read file', 'error');
      expect(testStore.replaceCues).not.toHaveBeenCalled();
    });
  });
});
