import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CATALOG_CHANGE_CHANNEL,
  INVOKED_CHANNELS,
  IPC_CHANNELS,
} from '../../../../apps/flux/main/ipc-channels';

const APP_DIR = path.resolve(__dirname, '../../../../apps/flux');

describe('apps/flux IPC channel identity', () => {
  it('names every privileged channel once, with no duplicates', () => {
    const names = INVOKED_CHANNELS;
    expect(new Set(names).size).toBe(names.length);
  });

  it('uses the channel names the renderer and the source app have always used', () => {
    expect(INVOKED_CHANNELS).toEqual([
      'command',
      'preview',
      'choose-import',
      'choose-directory',
      'choose-relink',
      'agent-settings',
      'update-agent-settings',
    ]);
  });

  it('keeps the catalog-change push channel out of the invoked set', () => {
    // It is the one channel main pushes; if the renderer could invoke it, a
    // compromised renderer could forge a library change.
    expect(CATALOG_CHANGE_CHANNEL).toBe('catalog-change');
    expect(INVOKED_CHANNELS).not.toContain(CATALOG_CHANGE_CHANNEL);
  });

  it('keeps one channel per DesktopAPI capability that needs main', () => {
    // `assetUrl` and `pathsForFiles` are computed in the preload and so have no
    // channel; every other method does.
    const expected: Record<string, string> = {
      command: IPC_CHANNELS.command,
      chooseImport: IPC_CHANNELS.chooseImport,
      chooseDirectory: IPC_CHANNELS.chooseDirectory,
      chooseRelink: IPC_CHANNELS.chooseRelink,
      preview: IPC_CHANNELS.preview,
      settings: IPC_CHANNELS.agentSettings,
      updateSettings: IPC_CHANNELS.updateAgentSettings,
    };

    for (const channel of Object.values(expected)) {
      expect(INVOKED_CHANNELS).toContain(channel);
    }
    expect(Object.keys(expected)).toHaveLength(INVOKED_CHANNELS.length);
  });

  it('exposes exactly one global, under the name the Lumaflux UI already reads', () => {
    const preload = readFileSync(path.join(APP_DIR, 'main/preload.ts'), 'utf8');
    const exposed = [...preload.matchAll(/exposeInMainWorld\(\s*'([^']+)'/g)].map((m) => m[1]);

    expect(exposed).toEqual(['lumaflux']);
  });

  it('registers a main-process handler for every channel the renderer can invoke', () => {
    const main = readFileSync(path.join(APP_DIR, 'main/index.ts'), 'utf8');
    const registered = [...main.matchAll(/handle\(IPC_CHANNELS\.(\w+)/g)].map((m) => m[1]);
    const expected = Object.keys(IPC_CHANNELS);

    expect(registered.sort()).toEqual(expected.sort());
  });
});
