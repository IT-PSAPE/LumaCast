import { mkdtemp, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareUserDataDirectory } from '../../../../apps/soundboard/main/user-data';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('soundboard user data setup', () => {
  it('creates the first-launch directory before assigning Electron userData', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'soundboard-user-data-'));
    roots.push(root);
    const directory = path.join(root, 'nested', 'LumaSoundboard');
    let existedWhenAssigned = false;
    const setPath = vi.fn((_name: 'userData', _value: string) => { existedWhenAssigned = existsSync(directory); });

    prepareUserDataDirectory(directory, setPath);

    expect(setPath).toHaveBeenCalledWith('userData', directory);
    expect(existedWhenAssigned).toBe(true);
    expect((await stat(directory)).isDirectory()).toBe(true);
  });
});
