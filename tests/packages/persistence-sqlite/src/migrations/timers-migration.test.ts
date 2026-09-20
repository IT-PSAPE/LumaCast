// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteDatabase } from '../../../../../packages/persistence-sqlite/src/sqlite';
import { MIGRATIONS } from '../../../../../packages/persistence-sqlite/src/migrations';

const tempPaths: string[] = [];

function openAtVersion(version: number): SqliteDatabase {
  const dbPath = path.join(os.tmpdir(), `lumacast-timers-migration-${Date.now()}-${Math.random()}.sqlite`);
  tempPaths.push(dbPath);
  const db = new SqliteDatabase(dbPath);
  for (const migration of MIGRATIONS.filter((candidate) => candidate.version <= version)) {
    const foreignKeysWereEnabled = migration.requiresForeignKeysOff
      ? Boolean(db.pragma('foreign_keys', { simple: true }))
      : null;
    if (migration.requiresForeignKeysOff) db.pragma('foreign_keys = OFF');
    try {
      const apply = db.transaction(() => {
        migration.up(db);
        db.pragma(`user_version = ${migration.version}`);
      });
      apply();
    } finally {
      if (migration.requiresForeignKeysOff) db.pragma(`foreign_keys = ${foreignKeysWereEnabled ? 'ON' : 'OFF'}`);
    }
  }
  return db;
}

afterEach(() => {
  for (const file of tempPaths.splice(0)) fs.rmSync(file, { force: true });
});

interface SeededTextElementRow {
  id: string;
  slide_id: string;
  payload_json: string;
}

function insertTextElement(db: SqliteDatabase, row: SeededTextElementRow, now: string): void {
  db.prepare(
    `INSERT INTO slide_elements
      (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, theme_override_keys_json, created_at, updated_at)
     VALUES (?, ?, 'text', 0, 0, 200, 60, 0, 1, 0, 'content', ?, NULL, NULL, ?, ?)`,
  ).run(row.id, row.slide_id, row.payload_json, now, now);
}

function insertGroupElement(db: SqliteDatabase, id: string, slideId: string, payloadJson: string, now: string): void {
  db.prepare(
    `INSERT INTO slide_elements
      (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, theme_override_keys_json, created_at, updated_at)
     VALUES (?, ?, 'group', 0, 0, 200, 60, 0, 1, 0, 'content', ?, NULL, NULL, ?, ?)`,
  ).run(id, slideId, payloadJson, now, now);
}

function textPayload(binding: Record<string, unknown> | undefined): string {
  return JSON.stringify({
    text: 'Countdown',
    fontFamily: 'Inter',
    fontSize: 24,
    color: '#ffffff',
    alignment: 'left',
    ...(binding ? { binding } : {}),
  });
}

describe('v36 first-class timers migration', () => {
  it('converts legacy timer bindings on real slides, overlay/stage container slides, and nested group children — deduping by (duration, format)', () => {
    const db = openAtVersion(35);
    try {
      // Seeded rows below reference container-slide ids (`overlay-1:slide`,
      // `stage-1:slide`) without materializing the owning overlay/stage rows
      // — this test is about the JSON conversion, not referential integrity
      // (mirrors migration-data-transforms.test.ts's simplification).
      db.pragma('foreign_keys = OFF');
      const now = '2026-09-20T00:00:00.000Z';

      // A real slide's own timer binding: 300s, mm:ss.
      insertTextElement(db, {
        id: 'elem-slide',
        slide_id: 'slide-1',
        payload_json: textPayload({ kind: 'timer', timerDurationSeconds: 300, timerFormat: 'mm:ss' }),
      }, now);

      // An overlay's container-slide element with the SAME (duration, format)
      // — overlays have no `elements_json` column; their elements live in
      // `slide_elements` under the `<overlayId>:slide` owner, same as any
      // other slide. This must dedupe to the same timer as elem-slide.
      insertTextElement(db, {
        id: 'elem-overlay',
        slide_id: 'overlay-1:slide',
        payload_json: textPayload({ kind: 'timer', timerDurationSeconds: 300, timerFormat: 'mm:ss' }),
      }, now);

      // A stage's container-slide element with a DIFFERENT (duration, format)
      // — must produce a second, distinct timer.
      insertTextElement(db, {
        id: 'elem-stage',
        slide_id: 'stage-1:slide',
        payload_json: textPayload({ kind: 'timer', timerDurationSeconds: 60, timerFormat: 'hh:mm:ss' }),
      }, now);

      // A group element nesting a timer-bound text child — must be found by
      // recursing into `payload.children`, and dedupes against elem-slide.
      const nestedText = JSON.parse(textPayload({ kind: 'timer', timerDurationSeconds: 300, timerFormat: 'mm:ss' }));
      insertGroupElement(db, 'elem-group', 'slide-1', JSON.stringify({
        name: 'Group',
        children: [
          {
            id: 'elem-nested-text',
            slideId: 'slide-1',
            type: 'text',
            x: 0, y: 0, width: 100, height: 40, rotation: 0, opacity: 1, zIndex: 0, layer: 'content',
            payload: nestedText,
            createdAt: now,
            updatedAt: now,
          },
        ],
      }), now);

      // A non-timer binding must be left untouched.
      insertTextElement(db, {
        id: 'elem-clock',
        slide_id: 'slide-1',
        payload_json: textPayload({ kind: 'clock', clockFormat: '24h' }),
      }, now);

      const migration = MIGRATIONS.find((candidate) => candidate.version === 36);
      expect(migration).toBeDefined();
      migration!.up(db);
      db.pragma('user_version = 36');

      expect(db.pragma('user_version', { simple: true })).toBe(36);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'timers'").get()).toEqual({ name: 'timers' });

      const timers = db.prepare('SELECT id, name, kind, duration_seconds, format FROM timers ORDER BY order_index ASC').all() as Array<{
        id: string; name: string; kind: string; duration_seconds: number; format: string;
      }>;
      expect(timers).toHaveLength(2);
      expect(timers[0]).toMatchObject({ name: 'Timer 05:00', kind: 'countdown', duration_seconds: 300, format: 'mm:ss' });
      expect(timers[1]).toMatchObject({ name: 'Timer 00:01:00', kind: 'countdown', duration_seconds: 60, format: 'hh:mm:ss' });
      const [timer300, timer60] = timers;

      function bindingOf(elementId: string): Record<string, unknown> {
        const row = db.prepare('SELECT payload_json FROM slide_elements WHERE id = ?').get(elementId) as { payload_json: string };
        return (JSON.parse(row.payload_json) as { binding: Record<string, unknown> }).binding;
      }

      expect(bindingOf('elem-slide')).toEqual({ kind: 'timer', timerId: timer300.id });
      expect(bindingOf('elem-overlay')).toEqual({ kind: 'timer', timerId: timer300.id });
      expect(bindingOf('elem-stage')).toEqual({ kind: 'timer', timerId: timer60.id });
      expect(bindingOf('elem-clock')).toEqual({ kind: 'clock', clockFormat: '24h' });

      const groupRow = db.prepare('SELECT payload_json FROM slide_elements WHERE id = ?').get('elem-group') as { payload_json: string };
      const groupPayload = JSON.parse(groupRow.payload_json) as { children: Array<{ payload: { binding: Record<string, unknown> } }> };
      expect(groupPayload.children[0]!.payload.binding).toEqual({ kind: 'timer', timerId: timer300.id });
    } finally {
      db.close();
    }
  });
});
