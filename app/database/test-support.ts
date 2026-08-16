import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CastRepository } from './store';
import type { RepositoryOptions } from './store';

const TEMP_PREFIX = 'lumacast-test-';

export interface TestRepositoryPaths {
  root: string;
  dbPath: string;
  userDataPath: string;
  documentsPath: string;
}

export interface TestRepositoryHandle {
  repository: CastRepository;
  paths: TestRepositoryPaths;
  close: () => void;
  reopen: () => CastRepository;
  cleanup: (target?: string) => void;
}

function closeRepository(repository: CastRepository): void {
  (repository as unknown as { db: { close(): void } }).db.close();
}

function isSafeCleanupTarget(target: string): boolean {
  const resolved = path.resolve(target);
  const parent = path.dirname(resolved);

  if (resolved === path.parse(resolved).root) return false;
  if (resolved === path.resolve(os.homedir())) return false;
  if (resolved === path.resolve(process.cwd())) return false;
  if (resolved === path.resolve(os.tmpdir())) return false;
  if (parent !== path.resolve(os.tmpdir())) return false;

  let realTarget: string;
  let realParent: string;
  try {
    realTarget = fs.realpathSync(resolved);
    realParent = fs.realpathSync(parent);
  } catch {
    return false;
  }
  if (realTarget === realParent) return false;
  if (!realTarget.startsWith(realParent + path.sep)) return false;

  return true;
}

export function createTestRepository(): TestRepositoryHandle {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
  const options: RepositoryOptions = {
    dbPath: path.join(root, 'lumacast.sqlite'),
    userDataPath: root,
    documentsPath: path.join(root, 'documents'),
  };

  let repository = new CastRepository(options);
  let closed = false;

  const handle: TestRepositoryHandle = {
    repository,
    paths: {
      root,
      dbPath: options.dbPath,
      userDataPath: options.userDataPath,
      documentsPath: options.documentsPath,
    },
    close: () => {
      closeRepository(handle.repository);
      closed = true;
    },
    reopen: () => {
      repository = new CastRepository(options);
      handle.repository = repository;
      closed = false;
      return repository;
    },
    cleanup: (target?: string) => {
      const resolvedTarget = target === undefined ? root : path.resolve(target);
      if (resolvedTarget !== path.resolve(root)) {
        throw new Error('cleanup: refuses a caller-supplied replacement path');
      }
      if (!closed) {
        throw new Error('cleanup: repository must be closed before cleanup');
      }
      if (!isSafeCleanupTarget(resolvedTarget)) {
        throw new Error('cleanup: refuses unsafe target');
      }
      fs.rmSync(resolvedTarget, { recursive: true, force: true });
    },
  };

  return handle;
}