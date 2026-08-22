// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqliteDatabase } from './sqlite';

const openDatabases: SqliteDatabase[] = [];

function openMemoryDatabase(): SqliteDatabase {
  const db = new SqliteDatabase(':memory:');
  openDatabases.push(db);
  return db;
}

function closeMemoryDatabase(db: SqliteDatabase): void {
  const index = openDatabases.indexOf(db);
  if (index >= 0) {
    openDatabases.splice(index, 1);
  }
  db.close();
}

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()?.close();
  }
});

describe('SqliteDatabase.prepare', () => {
  it('reuses the same prepared statement for identical SQL and prepares distinct SQL separately', () => {
    const db = openMemoryDatabase();
    const raw = (db as unknown as { database: { prepare: (sql: string) => unknown } }).database;
    const prepareSpy = vi.spyOn(raw, 'prepare');

    const first = db.prepare('SELECT 1 AS value');
    const second = db.prepare('SELECT 1 AS value');
    const third = db.prepare('SELECT 2 AS value');

    expect(first).toBe(second);
    expect(third).not.toBe(first);
    expect(prepareSpy).toHaveBeenCalledTimes(2);
    expect(prepareSpy.mock.calls.map(([sql]) => sql)).toEqual([
      'SELECT 1 AS value',
      'SELECT 2 AS value',
    ]);
  });

  it('closes cached statements with the database and rejects new prepares afterward', () => {
    const db = openMemoryDatabase();
    const raw = (db as unknown as { database: { close: () => void } }).database;
    const closeSpy = vi.spyOn(raw, 'close');

    db.prepare('SELECT 1 AS value');
    closeMemoryDatabase(db);

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(() => db.prepare('SELECT 1 AS value')).toThrow();
  });

  it('caps the cache with LRU eviction while keeping recently reused statements cached', () => {
    const db = openMemoryDatabase();
    const raw = (db as unknown as { database: { prepare: (sql: string) => unknown } }).database;
    const cache = (db as unknown as { statementCache: Map<string, unknown> }).statementCache;
    const prepareSpy = vi.spyOn(raw, 'prepare');

    const reusedSql = 'SELECT 0 AS value';
    db.prepare(reusedSql);
    for (let index = 1; index <= 127; index += 1) {
      db.prepare(`SELECT ${index} AS value`);
    }

    db.prepare(reusedSql);
    db.prepare('SELECT 128 AS value');

    expect(cache.size).toBe(128);
    expect(cache.has(reusedSql)).toBe(true);
    expect(cache.has('SELECT 1 AS value')).toBe(false);

    const preparesBeforeMiss = prepareSpy.mock.calls.length;
    db.prepare('SELECT 1 AS value');
    expect(prepareSpy).toHaveBeenCalledTimes(preparesBeforeMiss + 1);

    const preparesBeforeHit = prepareSpy.mock.calls.length;
    db.prepare(reusedSql);
    expect(prepareSpy).toHaveBeenCalledTimes(preparesBeforeHit);
  });
});
