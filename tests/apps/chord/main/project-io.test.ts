import { mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PROJECT_DIALOG_FILTERS,
  RecentProjectsStore,
  readProjectFile,
  readTextFileWithLimit,
  writeProjectFile,
  writeTextFile,
} from '../../../../apps/chord/main/project-io';
import { createEmptyProject } from '../../../../apps/chord/shared/project-schema';
import { PROJECT_FILE_EXTENSION } from '../../../../apps/chord/shared/project';
import type { RecentProject } from '../../../../apps/chord/shared/project';

describe('apps/chord project dialog filters', () => {
  it('filters on the .lumachord extension', () => {
    expect(PROJECT_DIALOG_FILTERS).toEqual([{ name: 'LumaChord Project', extensions: [PROJECT_FILE_EXTENSION] }]);
    expect(PROJECT_FILE_EXTENSION).toBe('lumachord');
  });
});

describe('apps/chord readProjectFile / writeProjectFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'lumachord-project-io-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a project through write then read', async () => {
    const filePath = path.join(dir, `song.${PROJECT_FILE_EXTENSION}`);
    const project = createEmptyProject('2026-09-26T00:00:00.000Z', 'project-1');

    await writeProjectFile(filePath, project);
    const document = await readProjectFile(filePath);

    expect(document.path).toBe(filePath);
    expect(document.project).toEqual(project);
  });

  it('writes atomically: no tmp file survives a successful write', async () => {
    const filePath = path.join(dir, `song.${PROJECT_FILE_EXTENSION}`);
    await writeProjectFile(filePath, createEmptyProject('2026-09-26T00:00:00.000Z', 'project-1'));

    const entries = readdirSync(dir);
    expect(entries).toEqual([`song.${PROJECT_FILE_EXTENSION}`]);
  });

  it('serializes with a stable, readable format', async () => {
    const filePath = path.join(dir, `song.${PROJECT_FILE_EXTENSION}`);
    await writeProjectFile(filePath, createEmptyProject('2026-09-26T00:00:00.000Z', 'project-1'));

    const text = readFileSync(filePath, 'utf8');
    expect(text).toContain('"formatVersion"');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('rejects a file that is not a LumaChord project', async () => {
    const filePath = path.join(dir, `bad.${PROJECT_FILE_EXTENSION}`);
    writeFileSync(filePath, 'not json');
    await expect(readProjectFile(filePath)).rejects.toThrow();
  });
});

describe('apps/chord readTextFileWithLimit / writeTextFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'lumachord-text-io-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads a file at or under the limit', async () => {
    const filePath = path.join(dir, 'cues.lrc');
    await writeTextFile(filePath, '[00:01.00]Hello');
    await expect(readTextFileWithLimit(filePath, 1024)).resolves.toBe('[00:01.00]Hello');
  });

  it('rejects a file over the limit without reading its contents', async () => {
    const filePath = path.join(dir, 'cues.lrc');
    await writeTextFile(filePath, 'x'.repeat(100));
    await expect(readTextFileWithLimit(filePath, 10)).rejects.toThrow(/limit/);
  });

  it('writeTextFile is atomic', async () => {
    const filePath = path.join(dir, 'cues.lrc');
    await writeTextFile(filePath, 'hello');
    const entries = readdirSync(dir);
    expect(entries).toEqual(['cues.lrc']);
    expect(readFileSync(filePath, 'utf8')).toBe('hello');
  });
});

describe('apps/chord RecentProjectsStore', () => {
  let dir: string;
  let storePath: string;
  let store: RecentProjectsStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'lumachord-recent-'));
    storePath = path.join(dir, 'recent-projects.json');
    store = new RecentProjectsStore(storePath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function makeProjectFile(name: string): string {
    const filePath = path.join(dir, name);
    writeFileSync(filePath, 'x');
    return filePath;
  }

  it('returns an empty list before anything has been saved', async () => {
    await expect(store.list()).resolves.toEqual([]);
  });

  it('adds an entry and lists it newest first', async () => {
    const a = makeProjectFile('a.lumachord');
    const b = makeProjectFile('b.lumachord');

    await store.push({ path: a, title: 'A', openedAt: '2026-01-01T00:00:00.000Z' });
    await store.push({ path: b, title: 'B', openedAt: '2026-01-02T00:00:00.000Z' });

    const list = await store.list();
    expect(list.map((entry) => entry.path)).toEqual([b, a]);
  });

  it('dedupes by path, moving the re-opened entry to the front', async () => {
    const a = makeProjectFile('a.lumachord');
    const b = makeProjectFile('b.lumachord');

    await store.push({ path: a, title: 'A', openedAt: '2026-01-01T00:00:00.000Z' });
    await store.push({ path: b, title: 'B', openedAt: '2026-01-02T00:00:00.000Z' });
    await store.push({ path: a, title: 'A (renamed)', openedAt: '2026-01-03T00:00:00.000Z' });

    const list = await store.list();
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({ path: a, title: 'A (renamed)', openedAt: '2026-01-03T00:00:00.000Z' });
    expect(list[1].path).toBe(b);
  });

  it('caps the list at 10 entries', async () => {
    const paths = Array.from({ length: 12 }, (_, i) => makeProjectFile(`p${i}.lumachord`));
    for (const [index, filePath] of paths.entries()) {
      await store.push({ path: filePath, title: `P${index}`, openedAt: `2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z` });
    }

    const list = await store.list();
    expect(list).toHaveLength(10);
    // Newest first: the last two pushed (indices 10, 11) survive; the
    // earliest two (0, 1) are evicted.
    expect(list[0].path).toBe(paths[11]);
    expect(list.map((entry) => entry.path)).not.toContain(paths[0]);
    expect(list.map((entry) => entry.path)).not.toContain(paths[1]);
  });

  it('drops entries whose file no longer exists, and persists the pruned list', async () => {
    const a = makeProjectFile('a.lumachord');
    const b = makeProjectFile('b.lumachord');
    await store.push({ path: a, title: 'A', openedAt: '2026-01-01T00:00:00.000Z' });
    await store.push({ path: b, title: 'B', openedAt: '2026-01-02T00:00:00.000Z' });

    unlinkSync(a);

    const list = await store.list();
    expect(list.map((entry) => entry.path)).toEqual([b]);

    // Persisted: a fresh store reading the same file also only sees b.
    const reopened = new RecentProjectsStore(storePath);
    await expect(reopened.list()).resolves.toEqual(list);
  });

  it('tolerates a missing or corrupt store file', async () => {
    await expect(store.list()).resolves.toEqual([]);

    writeFileSync(storePath, 'not json');
    await expect(store.list()).resolves.toEqual([]);

    writeFileSync(storePath, '{"not":"an array"}');
    await expect(store.list()).resolves.toEqual([]);
  });

  it('ignores malformed entries mixed in with good ones', async () => {
    const a = makeProjectFile('a.lumachord');
    writeFileSync(
      storePath,
      JSON.stringify([{ path: a, title: 'A', openedAt: '2026-01-01T00:00:00.000Z' }, { garbage: true }, 42, null]),
    );

    const list: RecentProject[] = await store.list();
    expect(list).toEqual([{ path: a, title: 'A', openedAt: '2026-01-01T00:00:00.000Z' }]);
  });
});
