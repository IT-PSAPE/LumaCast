import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestRepository } from './test-support';

describe('createTestRepository', () => {
  it('reads back the same data after close and reopen', () => {
    const { repository, paths, close, reopen, cleanup } = createTestRepository();
    const created = repository.createLibrary('Round Trip Library');
    const libraryId = created.upserts.libraries?.[0]?.id;
    expect(libraryId).toBeTruthy();
    expect(paths.dbPath).toBe(path.join(paths.root, 'lumacast.sqlite'));

    close();
    const reopened = reopen();
    expect(reopened.getSnapshot().libraries.some((library) => library.id === libraryId)).toBe(true);

    close();
    cleanup();
    expect(fs.existsSync(paths.root)).toBe(false);
  });

  it('isolates two concurrent repositories to separate directories and databases', () => {
    const first = createTestRepository();
    const second = createTestRepository();
    try {
      expect(first.paths.root).not.toBe(second.paths.root);
      expect(first.paths.dbPath).not.toBe(second.paths.dbPath);

      first.repository.createLibrary('Isolation Library');
      expect(first.repository.getSnapshot().libraries.some((library) => library.name === 'Isolation Library')).toBe(true);
      expect(second.repository.getSnapshot().libraries.some((library) => library.name === 'Isolation Library')).toBe(false);
    } finally {
      first.close();
      second.close();
      first.cleanup();
      second.cleanup();
    }
  });

  it('cleanup removes only the test-owned directory', () => {
    const { paths, close, cleanup } = createTestRepository();
    const sentinel = path.join(path.dirname(paths.root), `lumacast-test-sentinel-${Date.now()}`);
    fs.writeFileSync(sentinel, 'keep');
    try {
      close();
      cleanup();
      expect(fs.existsSync(paths.root)).toBe(false);
      expect(fs.existsSync(sentinel)).toBe(true);
    } finally {
      fs.rmSync(sentinel, { force: true });
    }
  });

  it('cleanup refuses the filesystem root', () => {
    const { paths, cleanup } = createTestRepository();
    try {
      expect(() => cleanup(path.parse(paths.root).root)).toThrow(/refuses/);
    } finally {
      fs.rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('cleanup refuses the home directory', () => {
    const { paths, cleanup } = createTestRepository();
    try {
      expect(() => cleanup(os.homedir())).toThrow(/refuses/);
    } finally {
      fs.rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('cleanup refuses the workspace root', () => {
    const { paths, cleanup } = createTestRepository();
    try {
      expect(() => cleanup(process.cwd())).toThrow(/refuses/);
    } finally {
      fs.rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('cleanup refuses the shared temp parent', () => {
    const { paths, cleanup } = createTestRepository();
    try {
      expect(() => cleanup(os.tmpdir())).toThrow(/refuses/);
    } finally {
      fs.rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('cleanup refuses a caller-supplied replacement path', () => {
    const { paths, cleanup } = createTestRepository();
    try {
      expect(() => cleanup(path.join(os.tmpdir(), 'lumacast-test-unrelated'))).toThrow(/refuses/);
    } finally {
      fs.rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('cleanup refuses a symlink escape from the canonical directory', () => {
    const { paths, close, cleanup } = createTestRepository();
    try {
      close();
      fs.rmSync(paths.root, { recursive: true, force: true });
      fs.symlinkSync(os.homedir(), paths.root);
      expect(() => cleanup()).toThrow(/unsafe target/);
    } finally {
      fs.rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it('cleanup refuses to run before the repository is closed', () => {
    const { paths, cleanup } = createTestRepository();
    try {
      expect(() => cleanup()).toThrow(/must be closed/);
    } finally {
      fs.rmSync(paths.root, { recursive: true, force: true });
    }
  });
});