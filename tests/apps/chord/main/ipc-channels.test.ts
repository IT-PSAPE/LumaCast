import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  IPC_CHANNELS,
  INVOKED_CHANNELS,
  MENU_COMMAND_CHANNEL,
  OPEN_DOCUMENT_CHANNEL,
} from '../../../../apps/chord/main/ipc-channels';

const APP_DIR = path.resolve(__dirname, '../../../../apps/chord');

describe('apps/chord IPC channel identity', () => {
  it('names every privileged channel once, with no duplicates', () => {
    const names = INVOKED_CHANNELS;
    expect(new Set(names).size).toBe(names.length);
  });

  it('uses the channel names main and the renderer have always used', () => {
    expect(INVOKED_CHANNELS).toEqual([
      'project-new',
      'project-open',
      'project-save',
      'project-recent',
      'project-document-state',
      'media-import',
      'media-admit',
      'media-url',
      'cues-read',
      'cues-export',
      'export-choose-path',
      'export-open',
      'export-write',
      'export-close',
      'export-abort',
      'reveal-path',
    ]);
  });

  it('keeps the two push channels out of the invoked set', () => {
    // If the renderer could invoke either, a compromised renderer could forge
    // a menu command or a "the OS opened this file" event.
    expect(MENU_COMMAND_CHANNEL).toBe('menu-command');
    expect(OPEN_DOCUMENT_CHANNEL).toBe('open-document');
    expect(INVOKED_CHANNELS).not.toContain(MENU_COMMAND_CHANNEL);
    expect(INVOKED_CHANNELS).not.toContain(OPEN_DOCUMENT_CHANNEL);
  });

  it('keeps one channel per ChordDesktopAPI capability that needs main', () => {
    // `pathsForFiles` is resolved entirely in preload (webUtils); every other
    // invoked capability has a channel. `onMenuCommand`/`onOpenDocument` are
    // push-only and use the two channels above instead.
    const expected: Record<string, string> = {
      newProject: IPC_CHANNELS.newProject,
      openProject: IPC_CHANNELS.openProject,
      saveProject: IPC_CHANNELS.saveProject,
      recentProjects: IPC_CHANNELS.recentProjects,
      setDocumentState: IPC_CHANNELS.setDocumentState,
      importMedia: IPC_CHANNELS.importMedia,
      admitFiles: IPC_CHANNELS.admitFiles,
      mediaUrl: IPC_CHANNELS.mediaUrl,
      readCueFile: IPC_CHANNELS.readCueFile,
      exportCues: IPC_CHANNELS.exportCues,
      chooseExportPath: IPC_CHANNELS.chooseExportPath,
      exportOpen: IPC_CHANNELS.exportOpen,
      exportWrite: IPC_CHANNELS.exportWrite,
      exportClose: IPC_CHANNELS.exportClose,
      exportAbort: IPC_CHANNELS.exportAbort,
      revealPath: IPC_CHANNELS.revealPath,
    };

    for (const channel of Object.values(expected)) {
      expect(INVOKED_CHANNELS).toContain(channel);
    }
    expect(Object.keys(expected)).toHaveLength(INVOKED_CHANNELS.length);
  });

  it('exposes exactly one global, under the name window.lumachord reads', () => {
    const preload = readFileSync(path.join(APP_DIR, 'main/preload.ts'), 'utf8');
    const exposed = [...preload.matchAll(/exposeInMainWorld\(\s*'([^']+)'/g)].map((m) => m[1]);

    expect(exposed).toEqual(['lumachord']);
  });

  it('registers a handler for every invoked channel, and no others', () => {
    const ipc = readFileSync(path.join(APP_DIR, 'main/ipc.ts'), 'utf8');
    const registered = [...ipc.matchAll(/\[IPC_CHANNELS\.(\w+)\]:/g)].map((m) => m[1]);
    const expected = Object.keys(IPC_CHANNELS);

    expect(registered.sort()).toEqual(expected.sort());
  });

  it('preload invokes every channel it exposes exactly once', () => {
    const preload = readFileSync(path.join(APP_DIR, 'main/preload.ts'), 'utf8');
    for (const channel of Object.keys(IPC_CHANNELS)) {
      const matches = [...preload.matchAll(new RegExp(`IPC_CHANNELS\\.${channel}\\b`, 'g'))];
      expect(matches.length).toBeGreaterThanOrEqual(1);
    }
  });
});
