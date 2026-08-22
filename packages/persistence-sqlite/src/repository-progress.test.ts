import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CastRepository, type RepositoryProgress } from './store';
import { LATEST_SCHEMA_VERSION, runMigrations, type MigrationProgress } from './migrations';
import { SqliteDatabase } from './sqlite';

const temporaryDirectories: string[] = [];

function makeTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-progress-'));
  temporaryDirectories.push(directory);
  return directory;
}

function makeRepository(
  directory: string,
  onProgress?: (progress: RepositoryProgress) => void,
): CastRepository {
  return new CastRepository({
    dbPath: path.join(directory, 'lumacast.sqlite'),
    userDataPath: directory,
    documentsPath: directory,
    seed: false,
    onProgress,
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('CastRepository lifecycle', () => {
  it('closes its database explicitly and idempotently', () => {
    const repository = makeRepository(makeTemporaryDirectory());

    expect(() => repository.close()).not.toThrow();
    expect(() => repository.close()).not.toThrow();
  });
});

describe('migration progress', () => {
  it('reports every pending migration with bounded progress', () => {
    const directory = makeTemporaryDirectory();
    const databasePath = path.join(directory, 'migration.sqlite');
    const database = new SqliteDatabase(databasePath);
    const progress: MigrationProgress[] = [];

    runMigrations(database, databasePath, { onProgress: (event) => progress.push(event) });

    const migrationEvents = progress.filter((event) => event.phase === 'migration');
    expect(migrationEvents).toHaveLength(LATEST_SCHEMA_VERSION);
    expect(migrationEvents.map((event) => event.migrationVersion)).toEqual(
      Array.from({ length: LATEST_SCHEMA_VERSION }, (_, index) => index + 1),
    );
    expect(progress.at(-1)).toEqual({
      phase: 'complete',
      completed: LATEST_SCHEMA_VERSION,
      total: LATEST_SCHEMA_VERSION,
    });
    expect(progress.every((event) => event.completed >= 0 && event.completed <= event.total)).toBe(true);
    database.close();
  });

  it('reports a bounded completion event when no migrations are pending', () => {
    const directory = makeTemporaryDirectory();
    const databasePath = path.join(directory, 'current.sqlite');
    const database = new SqliteDatabase(databasePath);
    runMigrations(database, databasePath);
    const progress: MigrationProgress[] = [];

    runMigrations(database, databasePath, { onProgress: (event) => progress.push(event) });

    expect(progress).toEqual([{ phase: 'complete', completed: 1, total: 1 }]);
    database.close();
  });

  it('ignores observer exceptions without changing migration semantics', () => {
    const directory = makeTemporaryDirectory();
    const databasePath = path.join(directory, 'observer.sqlite');
    const database = new SqliteDatabase(databasePath);

    expect(() => runMigrations(database, databasePath, {
      onProgress() {
        throw new Error('observer failure');
      },
    })).not.toThrow();
    expect(database.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION);
    database.close();
  });
});

describe('repository progress', () => {
  it('reports constructor migration progress', () => {
    const progress: RepositoryProgress[] = [];
    const repository = makeRepository(makeTemporaryDirectory(), (event) => progress.push(event));

    expect(progress.some((event) => event.operation === 'initialize' && event.phase === 'migration')).toBe(true);
    expect(progress.at(-1)).toMatchObject({
      operation: 'initialize',
      phase: 'complete',
    });
    repository.close();
  });

  it('reports every restore phase in order and observer exceptions cannot abort the restore', () => {
    const source = makeRepository(makeTemporaryDirectory());
    const target = makeRepository(makeTemporaryDirectory());
    const backup = source.exportProjectBackup();
    const phases: string[] = [];

    const result = target.restoreProjectBackup(backup, {
      onProgress(event) {
        phases.push(event.phase);
        throw new Error('observer failure');
      },
    });

    expect(phases).toEqual([
      'validation',
      'preparation',
      'migration',
      'insertion',
      'verification',
      'promotion',
      'complete',
    ]);
    expect(result.snapshot).toEqual(source.getSnapshot());
    source.close();
    target.close();
  });
});
