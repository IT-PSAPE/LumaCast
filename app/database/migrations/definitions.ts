import type { SqliteDatabase } from '../sqlite';
import type { Migration } from './types';
import { toCastMediaSource } from '../media-source-utils';
import type { SlideBackground, SlideElement } from '@core/types';
import {
  COLLECTION_TABLE_BY_BIN,
  DEFAULT_H,
  DEFAULT_W,
  createCollectionsIndexes,
  createCommonIndexes,
  createGlobalContentIndexes,
  createId,
  defaultCueName,
  hasColumn,
  hasTable,
  legacyOverlayElement,
  nowIso,
  parseJson,
  renameColumnIfNeeded,
  renameTableIfNeeded,
  seedDefaultCollectionsInMigration,
  slidesHasCheckConstraint,
  tableHasForeignKeyOn,
} from './support';

// ---------------------------------------------------------------------------
// v1 — bootstrap. This is the original, pre-`user_version`-tracking schema.
// `CREATE TABLE IF NOT EXISTS` makes this a no-op for any database that
// already has these tables (every previously-installed database, however
// old) and the sole schema-creation step for a genuinely empty database
// file. There is deliberately no separate "fresh install" schema anywhere
// in this module — every database, fresh or upgraded, is built by running
// this list from wherever its `user_version` currently sits.
// ---------------------------------------------------------------------------
function bootstrapLegacySchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS libraries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS presentations (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'canvas',
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(library_id) REFERENCES libraries(id)
    );

    CREATE TABLE IF NOT EXISTS slides (
      id TEXT PRIMARY KEY,
      presentation_id TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      order_index INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(presentation_id) REFERENCES presentations(id)
    );

    CREATE TABLE IF NOT EXISTS slide_elements (
      id TEXT PRIMARY KEY,
      slide_id TEXT NOT NULL,
      type TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      width REAL NOT NULL,
      height REAL NOT NULL,
      rotation REAL NOT NULL,
      opacity REAL NOT NULL,
      z_index INTEGER NOT NULL,
      layer TEXT NOT NULL DEFAULT 'content',
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(slide_id) REFERENCES slides(id)
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL,
      name TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(library_id) REFERENCES libraries(id)
    );

    CREATE TABLE IF NOT EXISTS playlist_segments (
      id TEXT PRIMARY KEY,
      playlist_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color_key TEXT,
      order_index INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(playlist_id) REFERENCES playlists(id)
    );

    CREATE TABLE IF NOT EXISTS playlist_entries (
      id TEXT PRIMARY KEY,
      segment_id TEXT NOT NULL,
      presentation_id TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(segment_id) REFERENCES playlist_segments(id),
      FOREIGN KEY(presentation_id) REFERENCES presentations(id)
    );

    CREATE TABLE IF NOT EXISTS media_assets (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      src TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(library_id) REFERENCES libraries(id)
    );

    CREATE TABLE IF NOT EXISTS overlays (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      width REAL NOT NULL,
      height REAL NOT NULL,
      opacity REAL NOT NULL,
      z_index INTEGER NOT NULL,
      enabled INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      elements_json TEXT NOT NULL DEFAULT '[]',
      animation_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(library_id) REFERENCES libraries(id)
    );

    CREATE TABLE IF NOT EXISTS themes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      elements_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      elements_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_presentations_library_id ON presentations(library_id);
    CREATE INDEX IF NOT EXISTS idx_slides_presentation_id ON slides(presentation_id);
    CREATE INDEX IF NOT EXISTS idx_slide_elements_slide_id ON slide_elements(slide_id);
    CREATE INDEX IF NOT EXISTS idx_playlists_library_id ON playlists(library_id);
    CREATE INDEX IF NOT EXISTS idx_playlist_segments_playlist_id ON playlist_segments(playlist_id);
    CREATE INDEX IF NOT EXISTS idx_playlist_entries_segment_id ON playlist_entries(segment_id);
    CREATE INDEX IF NOT EXISTS idx_media_assets_library_id ON media_assets(library_id);
    CREATE INDEX IF NOT EXISTS idx_overlays_library_id ON overlays(library_id);
    CREATE INDEX IF NOT EXISTS idx_themes_order_index ON themes(order_index);
    CREATE INDEX IF NOT EXISTS idx_stages_order_index ON stages(order_index);
  `);
}

// ---------------------------------------------------------------------------
// v2 (legacy schema version) — column/data repairs applied on top of the v1
// bootstrap shape for any database that predates `order_index`/`notes` on
// certain tables, and a one-time media `src` protocol normalization.
// ---------------------------------------------------------------------------
function ensureOrderingColumns(db: SqliteDatabase): void {
  const presentationColumns = db.prepare('PRAGMA table_info(presentations)').all() as Array<{ name: string }>;
  if (!presentationColumns.some((column) => column.name === 'order_index')) {
    db.prepare('ALTER TABLE presentations ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0').run();
    db
      .prepare(
        `WITH ranked AS (
           SELECT id, ROW_NUMBER() OVER (PARTITION BY library_id ORDER BY created_at ASC, id ASC) - 1 AS next_order
           FROM presentations
         )
         UPDATE presentations
         SET order_index = (SELECT next_order FROM ranked WHERE ranked.id = presentations.id)`
      )
      .run();
  }
  if (!presentationColumns.some((column) => column.name === 'kind')) {
    db.prepare("ALTER TABLE presentations ADD COLUMN kind TEXT NOT NULL DEFAULT 'canvas'").run();
  }

  const playlistColumns = db.prepare('PRAGMA table_info(playlists)').all() as Array<{ name: string }>;
  if (!playlistColumns.some((column) => column.name === 'order_index')) {
    db.prepare('ALTER TABLE playlists ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0').run();
    db
      .prepare(
        `WITH ranked AS (
           SELECT id, ROW_NUMBER() OVER (PARTITION BY library_id ORDER BY created_at ASC, id ASC) - 1 AS next_order
           FROM playlists
         )
         UPDATE playlists
         SET order_index = (SELECT next_order FROM ranked WHERE ranked.id = playlists.id)`
      )
      .run();
  }

  const segmentColumns = db.prepare('PRAGMA table_info(playlist_segments)').all() as Array<{ name: string }>;
  if (!segmentColumns.some((column) => column.name === 'color_key')) {
    db.prepare('ALTER TABLE playlist_segments ADD COLUMN color_key TEXT').run();
  }
}

function ensureOverlayCompositionColumns(db: SqliteDatabase): void {
  const overlayColumns = db.prepare('PRAGMA table_info(overlays)').all() as Array<{ name: string }>;
  if (!overlayColumns.some((column) => column.name === 'elements_json')) {
    db.prepare("ALTER TABLE overlays ADD COLUMN elements_json TEXT NOT NULL DEFAULT '[]'").run();
  }

  const rows = db
    .prepare(
      `SELECT id, type, x, y, width, height, opacity, z_index, payload_json, created_at, updated_at, elements_json
       FROM overlays`
    )
    .all() as Array<{
    id: string;
    type: 'text' | 'image' | 'video' | 'shape';
    x: number;
    y: number;
    width: number;
    height: number;
    opacity: number;
    z_index: number;
    payload_json: string;
    created_at: string;
    updated_at: string;
    elements_json: string | null;
  }>;

  const updateElements = db.prepare('UPDATE overlays SET elements_json = ? WHERE id = ?');
  for (const row of rows) {
    if (row.elements_json) continue;
    updateElements.run(JSON.stringify([legacyOverlayElement(row)]), row.id);
  }
}

function ensureSlideNotesColumn(db: SqliteDatabase): void {
  const slideColumns = db.prepare('PRAGMA table_info(slides)').all() as Array<{ name: string }>;
  if (!slideColumns.some((column) => column.name === 'notes')) {
    db.prepare("ALTER TABLE slides ADD COLUMN notes TEXT NOT NULL DEFAULT ''").run();
  }
}

function migrateMediaSrcProtocol(db: SqliteDatabase): void {
  const assets = db
    .prepare("SELECT id, src FROM media_assets WHERE src LIKE 'cast-media://%' OR src LIKE 'file://%' OR src LIKE 'blob:%'")
    .all() as Array<{ id: string; src: string }>;

  const updateAsset = db.prepare('UPDATE media_assets SET src = ? WHERE id = ?');
  const deleteAsset = db.prepare('DELETE FROM media_assets WHERE id = ?');
  for (const asset of assets) {
    const newSrc = toCastMediaSource(asset.src);
    if (!newSrc) {
      deleteAsset.run(asset.id);
      continue;
    }
    if (newSrc !== asset.src) {
      updateAsset.run(newSrc, asset.id);
    }
  }

  const elements = db
    .prepare("SELECT id, payload_json FROM slide_elements WHERE type IN ('image', 'video') AND (payload_json LIKE '%cast-media://%' OR payload_json LIKE '%file://%' OR payload_json LIKE '%blob:%')")
    .all() as Array<{ id: string; payload_json: string }>;

  const updateElement = db.prepare('UPDATE slide_elements SET payload_json = ? WHERE id = ?');
  const deleteElement = db.prepare('DELETE FROM slide_elements WHERE id = ?');
  for (const el of elements) {
    const payload = parseJson<{ src: string }>(el.payload_json);
    const newSrc = toCastMediaSource(payload.src);
    if (newSrc) {
      if (newSrc === payload.src) continue;
      payload.src = newSrc;
      updateElement.run(JSON.stringify(payload), el.id);
    } else {
      deleteElement.run(el.id);
    }
  }
}

function stabilizeLegacySchema(db: SqliteDatabase): void {
  ensureOrderingColumns(db);
  ensureSlideNotesColumn(db);
  ensureOverlayCompositionColumns(db);
  migrateMediaSrcProtocol(db);
}

// ---------------------------------------------------------------------------
// v3 — drop per-library scoping from decks/media/overlays; content becomes
// global within the database (libraries remain, but only for playlists).
// Recreates the three tables through a rename-swap since SQLite cannot drop
// a column with a FOREIGN KEY reference in one step across all supported
// versions here.
// ---------------------------------------------------------------------------
function migrateLegacyProjectContentToGlobalScope(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE presentations_v3 (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'canvas',
      theme_id TEXT,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE media_assets_v3 (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      src TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE overlays_v3 (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      width REAL NOT NULL,
      height REAL NOT NULL,
      opacity REAL NOT NULL,
      z_index INTEGER NOT NULL,
      enabled INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      elements_json TEXT NOT NULL DEFAULT '[]',
      animation_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(`
    INSERT INTO presentations_v3 (id, title, kind, theme_id, order_index, created_at, updated_at)
    SELECT
      p.id,
      p.title,
      p.kind,
      NULL,
      ROW_NUMBER() OVER (
        ORDER BY
          COALESCE(l.created_at, p.created_at) ASC,
          COALESCE(lp.order_index, 0) ASC,
          p.order_index ASC,
          p.created_at ASC,
          p.id ASC
      ) - 1,
      p.created_at,
      p.updated_at
    FROM presentations p
    LEFT JOIN libraries l ON l.id = p.library_id
    LEFT JOIN (
      SELECT library_id, MIN(order_index) AS order_index
      FROM playlists
      GROUP BY library_id
    ) lp ON lp.library_id = p.library_id;

    INSERT INTO media_assets_v3 (id, name, type, src, created_at, updated_at)
    SELECT id, name, type, src, created_at, updated_at
    FROM media_assets
    ORDER BY created_at ASC, id ASC;

    INSERT INTO overlays_v3 (id, name, type, x, y, width, height, opacity, z_index, enabled, payload_json, elements_json, animation_json, created_at, updated_at)
    SELECT id, name, type, x, y, width, height, opacity, z_index, enabled, payload_json, elements_json, animation_json, created_at, updated_at
    FROM overlays
    ORDER BY created_at ASC, id ASC;
  `);

  db.exec(`
    DROP INDEX IF EXISTS idx_presentations_library_id;
    DROP INDEX IF EXISTS idx_media_assets_library_id;
    DROP INDEX IF EXISTS idx_overlays_library_id;

    DROP TABLE overlays;
    DROP TABLE media_assets;
    DROP TABLE presentations;

    ALTER TABLE presentations_v3 RENAME TO presentations;
    ALTER TABLE media_assets_v3 RENAME TO media_assets;
    ALTER TABLE overlays_v3 RENAME TO overlays;
  `);
}

// ---------------------------------------------------------------------------
// v4 — themes table (first appearance).
// ---------------------------------------------------------------------------
function ensureThemesSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS themes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      elements_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_themes_order_index ON themes(order_index)');
}

// ---------------------------------------------------------------------------
// v5 — presentations.theme_id (unnumbered constant historically; always
// just "5").
// ---------------------------------------------------------------------------
function ensurePresentationThemeSchema(db: SqliteDatabase): void {
  const presentationColumns = db.prepare('PRAGMA table_info(presentations)').all() as Array<{ name: string }>;
  if (!presentationColumns.some((column) => column.name === 'theme_id')) {
    db.prepare('ALTER TABLE presentations ADD COLUMN theme_id TEXT').run();
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_presentations_theme_id ON presentations(theme_id)');
}

// ---------------------------------------------------------------------------
// v6 — split the unified `presentations` table (kind = 'canvas' | 'lyrics')
// into `presentations` (decks) and `lyrics`, and carry `slides` /
// `playlist_entries` along with the split.
// ---------------------------------------------------------------------------
function migratePresentationSchemaToDeckItems(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE decks_v6 (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      theme_id TEXT,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE lyrics_v6 (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      theme_id TEXT,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE slides_v6 (
      id TEXT PRIMARY KEY,
      presentation_id TEXT,
      lyric_id TEXT,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      order_index INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE playlist_entries_v6 (
      id TEXT PRIMARY KEY,
      segment_id TEXT NOT NULL,
      presentation_id TEXT,
      lyric_id TEXT,
      order_index INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(`
    INSERT INTO decks_v6 (id, title, theme_id, order_index, created_at, updated_at)
    SELECT id, title, theme_id, order_index, created_at, updated_at
    FROM presentations
    WHERE kind != 'lyrics'
    ORDER BY order_index ASC, created_at ASC, id ASC;

    INSERT INTO lyrics_v6 (id, title, theme_id, order_index, created_at, updated_at)
    SELECT id, title, theme_id, order_index, created_at, updated_at
    FROM presentations
    WHERE kind = 'lyrics'
    ORDER BY order_index ASC, created_at ASC, id ASC;

    INSERT INTO slides_v6 (id, presentation_id, lyric_id, width, height, notes, order_index, created_at, updated_at)
    SELECT
      s.id,
      CASE WHEN p.kind = 'lyrics' THEN NULL ELSE s.presentation_id END,
      CASE WHEN p.kind = 'lyrics' THEN s.presentation_id ELSE NULL END,
      s.width,
      s.height,
      s.notes,
      s.order_index,
      s.created_at,
      s.updated_at
    FROM slides s
    JOIN presentations p ON p.id = s.presentation_id
    ORDER BY s.created_at ASC, s.id ASC;

    INSERT INTO playlist_entries_v6 (id, segment_id, presentation_id, lyric_id, order_index, created_at, updated_at)
    SELECT
      pe.id,
      pe.segment_id,
      CASE WHEN p.kind = 'lyrics' THEN NULL ELSE pe.presentation_id END,
      CASE WHEN p.kind = 'lyrics' THEN pe.presentation_id ELSE NULL END,
      pe.order_index,
      pe.created_at,
      pe.updated_at
    FROM playlist_entries pe
    JOIN presentations p ON p.id = pe.presentation_id
    ORDER BY pe.created_at ASC, pe.id ASC;
  `);

  db.exec(`
    DROP INDEX IF EXISTS idx_slides_presentation_id;
    DROP INDEX IF EXISTS idx_playlist_entries_presentation_id;
    DROP INDEX IF EXISTS idx_presentations_order_index;
    DROP INDEX IF EXISTS idx_presentations_theme_id;

    DROP TABLE playlist_entries;
    DROP TABLE slides;
    DROP TABLE presentations;

    ALTER TABLE decks_v6 RENAME TO presentations;
    ALTER TABLE lyrics_v6 RENAME TO lyrics;
    ALTER TABLE slides_v6 RENAME TO slides;
    ALTER TABLE playlist_entries_v6 RENAME TO playlist_entries;
  `);

  createCommonIndexes(db);
  createGlobalContentIndexes(db);
}

// ---------------------------------------------------------------------------
// v7 — order_index for libraries/media_assets (drag-and-drop reorder).
// ---------------------------------------------------------------------------
function ensureReorderColumns(db: SqliteDatabase): void {
  if (!hasColumn(db, 'libraries', 'order_index')) {
    db.exec('ALTER TABLE libraries ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0');
    db.exec(`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) - 1 AS rank FROM libraries
      )
      UPDATE libraries SET order_index = (SELECT rank FROM ranked WHERE ranked.id = libraries.id);
    `);
  }
  if (!hasColumn(db, 'media_assets', 'order_index')) {
    db.exec('ALTER TABLE media_assets ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0');
    db.exec(`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) - 1 AS rank FROM media_assets
      )
      UPDATE media_assets SET order_index = (SELECT rank FROM ranked WHERE ranked.id = media_assets.id);
    `);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_libraries_order_index ON libraries(order_index);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_media_assets_order_index ON media_assets(order_index);');
}

// ---------------------------------------------------------------------------
// v8 — stages table.
// ---------------------------------------------------------------------------
function ensureStagesSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      elements_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_stages_order_index ON stages(order_index)');
}

// ---------------------------------------------------------------------------
// v9 — one collection table per bin kind, plus a nullable `collection_id`
// column on every collection-scoped item table, backfilled to each bin's
// (newly seeded) default collection.
// ---------------------------------------------------------------------------
function ensureCollectionsSchema(db: SqliteDatabase): void {
  for (const table of Object.values(COLLECTION_TABLE_BY_BIN)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  const itemTablesNeedingColumn = ['presentations', 'lyrics', 'media_assets', 'themes', 'overlays', 'stages'];
  for (const table of itemTablesNeedingColumn) {
    if (hasTable(db, table) && !hasColumn(db, table, 'collection_id')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN collection_id TEXT;`);
    }
  }

  createCollectionsIndexes(db);
  seedDefaultCollectionsInMigration(db);
}

// ---------------------------------------------------------------------------
// v10 — rename `templates` -> `themes` / `template_collections` ->
// `theme_collections` / `*.template_id` -> `*.theme_id`, for databases that
// still carry the pre-rename naming. Requires foreign_keys off around the
// migration because SQLite forbids toggling the pragma inside a transaction,
// and this uses ALTER TABLE ... RENAME.
// ---------------------------------------------------------------------------
function migrateTemplateNamingToThemes(db: SqliteDatabase): void {
  renameTableIfNeeded(db, 'templates', 'themes');
  renameTableIfNeeded(db, 'template_collections', 'theme_collections');
  renameColumnIfNeeded(db, 'presentations', 'template_id', 'theme_id');
  renameColumnIfNeeded(db, 'lyrics', 'template_id', 'theme_id');

  if (hasTable(db, 'themes') && hasTable(db, 'theme_collections') && !hasColumn(db, 'themes', 'collection_id')) {
    db.exec('ALTER TABLE themes ADD COLUMN collection_id TEXT;');
  }

  db.exec('DROP INDEX IF EXISTS idx_presentations_template_id;');
  db.exec('DROP INDEX IF EXISTS idx_decks_template_id;');
  db.exec('DROP INDEX IF EXISTS idx_lyrics_template_id;');
  db.exec('DROP INDEX IF EXISTS idx_templates_order_index;');
  db.exec('DROP INDEX IF EXISTS idx_templates_collection_id;');
  db.exec('DROP INDEX IF EXISTS idx_template_collections_order_index;');

  createGlobalContentIndexes(db);
  if (hasTable(db, 'theme_collections')) {
    createCollectionsIndexes(db);
    seedDefaultCollectionsInMigration(db);
  }
}

// ---------------------------------------------------------------------------
// v11 — unify themes/overlays/stages/decks/lyrics under a single `slides`
// table (one of five nullable owner FKs + a CHECK requiring exactly one),
// and split `media_assets` into per-type tables with real FKs into their
// collection tables. See the historical note on `migrateToUnifiedSlides` in
// git history for the full step-by-step rationale; behavior here is
// transplanted unchanged. Requires foreign_keys off (multiple table
// recreations).
// ---------------------------------------------------------------------------
function materializeContainerSlides(
  db: SqliteDatabase,
  table: 'themes' | 'overlays' | 'stages',
  kind: 'theme' | 'overlay' | 'stage',
): void {
  const widthExpr = hasColumn(db, table, 'width') ? 'width' : `${DEFAULT_W} AS width`;
  const heightExpr = hasColumn(db, table, 'height') ? 'height' : `${DEFAULT_H} AS height`;
  const rows = db
    .prepare(`SELECT id, elements_json, ${widthExpr}, ${heightExpr}, created_at, updated_at FROM ${table}`)
    .all() as Array<{
      id: string;
      elements_json: string;
      width: number | null;
      height: number | null;
      created_at: string;
      updated_at: string;
    }>;

  const fkColumn = `${kind}_id`;
  const insertSlide = db.prepare(
    `INSERT INTO slides (id, presentation_id, lyric_id, theme_id, overlay_id, stage_id, kind, width, height, notes, order_index, created_at, updated_at)
     VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, '', 0, ?, ?)`
  );
  const insertElement = db.prepare(
    `INSERT INTO slide_elements
      (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const slideExists = db.prepare('SELECT id FROM slides WHERE id = ?');
  const updateSlideFk = db.prepare(`UPDATE slides SET ${fkColumn} = ?, kind = ? WHERE id = ?`);

  for (const row of rows) {
    const slideId = `${row.id}:slide`;
    const width = (row.width && row.width > 0) ? row.width : DEFAULT_W;
    const height = (row.height && row.height > 0) ? row.height : DEFAULT_H;
    const existing = slideExists.get(slideId);
    if (!existing) {
      insertSlide.run(
        slideId,
        kind === 'theme' ? row.id : null,
        kind === 'overlay' ? row.id : null,
        kind === 'stage' ? row.id : null,
        kind,
        width,
        height,
        row.created_at,
        row.updated_at,
      );
    } else {
      // Already migrated once; just normalize the FK.
      updateSlideFk.run(row.id, kind, slideId);
    }
    const elements = parseJson<SlideElement[]>(row.elements_json) ?? [];
    db.prepare('DELETE FROM slide_elements WHERE slide_id = ?').run(slideId);
    for (const element of elements) {
      insertElement.run(
        element.id ?? createId(),
        slideId,
        element.type,
        element.x ?? 0,
        element.y ?? 0,
        element.width ?? 0,
        element.height ?? 0,
        element.rotation ?? 0,
        element.opacity ?? 1,
        element.zIndex ?? 0,
        element.layer ?? 'content',
        JSON.stringify(element.payload ?? {}),
        element.createdAt ?? row.created_at,
        element.updatedAt ?? row.updated_at,
      );
    }
  }
}

function backfillEmptyOverlayElements(db: SqliteDatabase): void {
  if (!hasColumn(db, 'overlays', 'payload_json')) return;
  const rows = db
    .prepare(
      `SELECT id, type, x, y, width, height, opacity, z_index, payload_json, elements_json, created_at, updated_at
       FROM overlays`
    )
    .all() as Array<{
      id: string;
      type: 'text' | 'image' | 'video' | 'shape';
      x: number;
      y: number;
      width: number;
      height: number;
      opacity: number;
      z_index: number;
      payload_json: string;
      elements_json: string;
      created_at: string;
      updated_at: string;
    }>;
  const update = db.prepare('UPDATE overlays SET elements_json = ? WHERE id = ?');
  for (const row of rows) {
    const parsed = parseJson<SlideElement[]>(row.elements_json) ?? [];
    if (parsed.length > 0) continue;
    const synthetic = legacyOverlayElement(row);
    update.run(JSON.stringify([synthetic]), row.id);
  }
}

function recreateThemesTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE themes_v11 (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      collection_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(collection_id) REFERENCES theme_collections(id)
    );

    INSERT INTO themes_v11 (id, name, kind, width, height, order_index, collection_id, created_at, updated_at)
    SELECT id, name, kind, width, height, order_index, collection_id, created_at, updated_at
    FROM themes;

    DROP INDEX IF EXISTS idx_themes_order_index;
    DROP INDEX IF EXISTS idx_themes_collection_id;
    DROP TABLE themes;
    ALTER TABLE themes_v11 RENAME TO themes;

    CREATE INDEX IF NOT EXISTS idx_themes_order_index ON themes(order_index);
    CREATE INDEX IF NOT EXISTS idx_themes_collection_id ON themes(collection_id);
  `);
}

function recreateStagesTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE stages_v11 (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      collection_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(collection_id) REFERENCES stage_collections(id)
    );

    INSERT INTO stages_v11 (id, name, width, height, order_index, collection_id, created_at, updated_at)
    SELECT id, name, width, height, order_index, collection_id, created_at, updated_at
    FROM stages;

    DROP INDEX IF EXISTS idx_stages_order_index;
    DROP INDEX IF EXISTS idx_stages_collection_id;
    DROP TABLE stages;
    ALTER TABLE stages_v11 RENAME TO stages;

    CREATE INDEX IF NOT EXISTS idx_stages_order_index ON stages(order_index);
    CREATE INDEX IF NOT EXISTS idx_stages_collection_id ON stages(collection_id);
  `);
}

function recreateOverlaysTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE overlays_v11 (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      animation_json TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(collection_id) REFERENCES overlay_collections(id)
    );

    INSERT INTO overlays_v11 (id, name, enabled, animation_json, collection_id, created_at, updated_at)
    SELECT id, name, enabled, animation_json, collection_id, created_at, updated_at
    FROM overlays;

    DROP INDEX IF EXISTS idx_overlays_created_at;
    DROP INDEX IF EXISTS idx_overlays_collection_id;
    DROP TABLE overlays;
    ALTER TABLE overlays_v11 RENAME TO overlays;

    CREATE INDEX IF NOT EXISTS idx_overlays_created_at ON overlays(created_at);
    CREATE INDEX IF NOT EXISTS idx_overlays_collection_id ON overlays(collection_id);
  `);
}

function recreateSlidesTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE slides_v11 (
      id TEXT PRIMARY KEY,
      presentation_id TEXT,
      lyric_id TEXT,
      theme_id TEXT,
      overlay_id TEXT,
      stage_id TEXT,
      kind TEXT NOT NULL DEFAULT 'presentation',
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      order_index INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(presentation_id) REFERENCES presentations(id),
      FOREIGN KEY(lyric_id) REFERENCES lyrics(id),
      FOREIGN KEY(theme_id) REFERENCES themes(id),
      FOREIGN KEY(overlay_id) REFERENCES overlays(id),
      FOREIGN KEY(stage_id) REFERENCES stages(id),
      CHECK (
        (presentation_id IS NOT NULL) +
        (lyric_id IS NOT NULL) +
        (theme_id IS NOT NULL) +
        (overlay_id IS NOT NULL) +
        (stage_id IS NOT NULL) = 1
      )
    );

    INSERT INTO slides_v11 (id, presentation_id, lyric_id, theme_id, overlay_id, stage_id, kind, width, height, notes, order_index, created_at, updated_at)
    SELECT id, presentation_id, lyric_id, theme_id, overlay_id, stage_id, kind, width, height, notes, order_index, created_at, updated_at
    FROM slides;

    DROP INDEX IF EXISTS idx_slides_presentation_id;
    DROP INDEX IF EXISTS idx_slides_lyric_id;
    DROP TABLE slides;
    ALTER TABLE slides_v11 RENAME TO slides;

    CREATE INDEX IF NOT EXISTS idx_slides_presentation_id ON slides(presentation_id);
    CREATE INDEX IF NOT EXISTS idx_slides_lyric_id ON slides(lyric_id);
    CREATE INDEX IF NOT EXISTS idx_slides_theme_id ON slides(theme_id);
    CREATE INDEX IF NOT EXISTS idx_slides_overlay_id ON slides(overlay_id);
    CREATE INDEX IF NOT EXISTS idx_slides_stage_id ON slides(stage_id);
  `);
}

function splitMediaAssetsTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS image_assets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      src TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(collection_id) REFERENCES image_collections(id)
    );

    CREATE TABLE IF NOT EXISTS video_assets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      src TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(collection_id) REFERENCES video_collections(id)
    );

    CREATE TABLE IF NOT EXISTS audio_assets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      src TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(collection_id) REFERENCES audio_collections(id)
    );

    INSERT INTO image_assets (id, name, src, collection_id, order_index, created_at, updated_at)
    SELECT id, name, src, collection_id, order_index, created_at, updated_at
    FROM media_assets WHERE type = 'image';

    INSERT INTO video_assets (id, name, src, collection_id, order_index, created_at, updated_at)
    SELECT id, name, src, collection_id, order_index, created_at, updated_at
    FROM media_assets WHERE type = 'video' OR type = 'animation';

    INSERT INTO audio_assets (id, name, src, collection_id, order_index, created_at, updated_at)
    SELECT id, name, src, collection_id, order_index, created_at, updated_at
    FROM media_assets WHERE type = 'audio';

    DROP INDEX IF EXISTS idx_media_assets_created_at;
    DROP INDEX IF EXISTS idx_media_assets_collection_id;
    DROP INDEX IF EXISTS idx_media_assets_order_index;
    DROP TABLE media_assets;

    CREATE INDEX IF NOT EXISTS idx_image_assets_created_at ON image_assets(created_at);
    CREATE INDEX IF NOT EXISTS idx_image_assets_collection_id ON image_assets(collection_id);
    CREATE INDEX IF NOT EXISTS idx_video_assets_created_at ON video_assets(created_at);
    CREATE INDEX IF NOT EXISTS idx_video_assets_collection_id ON video_assets(collection_id);
    CREATE INDEX IF NOT EXISTS idx_audio_assets_created_at ON audio_assets(created_at);
    CREATE INDEX IF NOT EXISTS idx_audio_assets_collection_id ON audio_assets(collection_id);
  `);
}

/**
 * Recreate presentations or lyrics with FOREIGN KEY constraints on
 * theme_id and collection_id. SQLite can't add FKs to an existing column,
 * so we copy through a renamed table.
 */
function recreateDeckTable(db: SqliteDatabase, table: 'presentations' | 'lyrics'): void {
  const tempTable = `${table}_v11`;
  db.exec(`
    CREATE TABLE ${tempTable} (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      theme_id TEXT,
      collection_id TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(theme_id) REFERENCES themes(id),
      FOREIGN KEY(collection_id) REFERENCES deck_collections(id)
    );

    INSERT INTO ${tempTable} (id, title, theme_id, collection_id, order_index, created_at, updated_at)
    SELECT id, title, theme_id, collection_id, order_index, created_at, updated_at
    FROM ${table};

    DROP TABLE ${table};
    ALTER TABLE ${tempTable} RENAME TO ${table};
  `);

  if (table === 'presentations') {
    db.exec('CREATE INDEX IF NOT EXISTS idx_decks_order_index ON presentations(order_index);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_decks_theme_id ON presentations(theme_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_presentations_collection_id ON presentations(collection_id);');
  } else {
    db.exec('CREATE INDEX IF NOT EXISTS idx_lyrics_order_index ON lyrics(order_index);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_lyrics_theme_id ON lyrics(theme_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_lyrics_collection_id ON lyrics(collection_id);');
  }
}

function migrateToUnifiedSlides(db: SqliteDatabase): void {
  // a) slides: add kind + theme_id/overlay_id/stage_id columns and backfill kind.
  if (!hasColumn(db, 'slides', 'kind')) {
    db.exec("ALTER TABLE slides ADD COLUMN kind TEXT NOT NULL DEFAULT 'presentation'");
    db.exec("UPDATE slides SET kind = 'lyric' WHERE lyric_id IS NOT NULL");
    db.exec("UPDATE slides SET kind = 'presentation' WHERE lyric_id IS NULL AND presentation_id IS NOT NULL");
  }
  if (!hasColumn(db, 'slides', 'theme_id')) {
    db.exec('ALTER TABLE slides ADD COLUMN theme_id TEXT');
  }
  if (!hasColumn(db, 'slides', 'overlay_id')) {
    db.exec('ALTER TABLE slides ADD COLUMN overlay_id TEXT');
  }
  if (!hasColumn(db, 'slides', 'stage_id')) {
    db.exec('ALTER TABLE slides ADD COLUMN stage_id TEXT');
  }

  // b) Materialize child slides for each theme/overlay/stage and parse
  //    elements_json into slide_elements rows.
  if (hasColumn(db, 'themes', 'elements_json')) {
    materializeContainerSlides(db, 'themes', 'theme');
  }
  if (hasColumn(db, 'stages', 'elements_json')) {
    materializeContainerSlides(db, 'stages', 'stage');
  }
  if (hasColumn(db, 'overlays', 'elements_json')) {
    backfillEmptyOverlayElements(db);
    materializeContainerSlides(db, 'overlays', 'overlay');
  }

  // c) Recreate themes/overlays/stages with the trimmed schema + enforced
  //    collection FKs.
  if (hasColumn(db, 'themes', 'elements_json')) {
    recreateThemesTable(db);
  }
  if (hasColumn(db, 'stages', 'elements_json')) {
    recreateStagesTable(db);
  }
  if (hasColumn(db, 'overlays', 'payload_json') || hasColumn(db, 'overlays', 'elements_json')) {
    recreateOverlaysTable(db);
  }

  // d) Recreate slides with the new column layout, FK fan-out and CHECK
  //    constraint enforced. Idempotent: skip if already done.
  if (hasColumn(db, 'slides', 'kind') && !slidesHasCheckConstraint(db)) {
    recreateSlidesTable(db);
  }

  // e) Migrate media_assets into per-type tables (animation -> video).
  if (hasTable(db, 'media_assets')) {
    splitMediaAssetsTable(db);
  }

  // f) Recreate presentations + lyrics with theme_id + collection_id FKs.
  if (!tableHasForeignKeyOn(db, 'presentations', 'collection_id')) {
    recreateDeckTable(db, 'presentations');
  }
  if (!tableHasForeignKeyOn(db, 'lyrics', 'collection_id')) {
    recreateDeckTable(db, 'lyrics');
  }
}

// ---------------------------------------------------------------------------
// v12 — rename `playlist_segments` -> `playlist_groups`,
// `playlist_entries.segment_id` -> `group_id`.
// ---------------------------------------------------------------------------
function renamePlaylistSegmentsToGroups(db: SqliteDatabase): void {
  if (hasTable(db, 'playlist_segments') && !hasTable(db, 'playlist_groups')) {
    db.exec('DROP INDEX IF EXISTS idx_playlist_segments_playlist_id');
    db.exec('DROP INDEX IF EXISTS idx_playlist_entries_segment_id');
    db.exec('ALTER TABLE playlist_segments RENAME TO playlist_groups');
  }

  if (hasColumn(db, 'playlist_entries', 'segment_id') && !hasColumn(db, 'playlist_entries', 'group_id')) {
    db.exec('ALTER TABLE playlist_entries RENAME COLUMN segment_id TO group_id');
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_playlist_groups_playlist_id ON playlist_groups(playlist_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_playlist_entries_group_id ON playlist_entries(group_id)');
}

// ---------------------------------------------------------------------------
// v13 — Talk deck items and per-slide script blocks.
// ---------------------------------------------------------------------------
function ensureTalksSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS talks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      theme_id TEXT,
      collection_id TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(theme_id) REFERENCES themes(id),
      FOREIGN KEY(collection_id) REFERENCES deck_collections(id)
    );
  `);

  if (!hasColumn(db, 'slides', 'talk_id')) {
    db.exec('ALTER TABLE slides ADD COLUMN talk_id TEXT REFERENCES talks(id)');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS talk_script_blocks (
      id TEXT PRIMARY KEY,
      slide_id TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      order_index INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(slide_id) REFERENCES slides(id)
    );
  `);

  if (!hasColumn(db, 'playlist_entries', 'talk_id')) {
    db.exec('ALTER TABLE playlist_entries ADD COLUMN talk_id TEXT REFERENCES talks(id)');
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_slides_talk_id ON slides(talk_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_talk_script_blocks_slide_id ON talk_script_blocks(slide_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_playlist_entries_talk_id ON playlist_entries(talk_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_talks_order_index ON talks(order_index)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_talks_collection_id ON talks(collection_id)');
}

// ---------------------------------------------------------------------------
// v14 — the v11 CHECK constraint sums only the original five owner FKs; v13
// added talk_id via ALTER TABLE without updating it, so every Talk-owned
// slide insert failed. Recreate slides with talk_id included in the CHECK.
// ---------------------------------------------------------------------------
function recreateSlidesTableWithTalkCheck(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE slides_v14 (
      id TEXT PRIMARY KEY,
      presentation_id TEXT,
      lyric_id TEXT,
      talk_id TEXT,
      theme_id TEXT,
      overlay_id TEXT,
      stage_id TEXT,
      kind TEXT NOT NULL DEFAULT 'presentation',
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      order_index INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(presentation_id) REFERENCES presentations(id),
      FOREIGN KEY(lyric_id) REFERENCES lyrics(id),
      FOREIGN KEY(talk_id) REFERENCES talks(id),
      FOREIGN KEY(theme_id) REFERENCES themes(id),
      FOREIGN KEY(overlay_id) REFERENCES overlays(id),
      FOREIGN KEY(stage_id) REFERENCES stages(id),
      CHECK (
        (presentation_id IS NOT NULL) +
        (lyric_id IS NOT NULL) +
        (talk_id IS NOT NULL) +
        (theme_id IS NOT NULL) +
        (overlay_id IS NOT NULL) +
        (stage_id IS NOT NULL) = 1
      )
    );

    INSERT INTO slides_v14 (id, presentation_id, lyric_id, talk_id, theme_id, overlay_id, stage_id, kind, width, height, notes, order_index, created_at, updated_at)
    SELECT id, presentation_id, lyric_id, talk_id, theme_id, overlay_id, stage_id, kind, width, height, notes, order_index, created_at, updated_at
    FROM slides;

    DROP INDEX IF EXISTS idx_slides_presentation_id;
    DROP INDEX IF EXISTS idx_slides_lyric_id;
    DROP INDEX IF EXISTS idx_slides_talk_id;
    DROP INDEX IF EXISTS idx_slides_theme_id;
    DROP INDEX IF EXISTS idx_slides_overlay_id;
    DROP INDEX IF EXISTS idx_slides_stage_id;
    DROP TABLE slides;
    ALTER TABLE slides_v14 RENAME TO slides;

    CREATE INDEX IF NOT EXISTS idx_slides_presentation_id ON slides(presentation_id);
    CREATE INDEX IF NOT EXISTS idx_slides_lyric_id ON slides(lyric_id);
    CREATE INDEX IF NOT EXISTS idx_slides_talk_id ON slides(talk_id);
    CREATE INDEX IF NOT EXISTS idx_slides_theme_id ON slides(theme_id);
    CREATE INDEX IF NOT EXISTS idx_slides_overlay_id ON slides(overlay_id);
    CREATE INDEX IF NOT EXISTS idx_slides_stage_id ON slides(stage_id);
  `);
}

function repairSlidesCheckConstraintForTalks(db: SqliteDatabase): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'slides'")
    .get() as { sql: string } | undefined;
  if (!row?.sql) return;
  if (row.sql.includes('(talk_id IS NOT NULL)')) return;
  recreateSlidesTableWithTalkCheck(db);
}

// ---------------------------------------------------------------------------
// v15 — macros ("actions") first appearance: actions / action_steps /
// trigger_bindings (action-only at this point).
// ---------------------------------------------------------------------------
function ensureActionsSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS actions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS action_steps (
      id TEXT PRIMARY KEY,
      action_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      group_index INTEGER NOT NULL,
      step_index INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      failure_policy TEXT NOT NULL DEFAULT 'continue',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(action_id) REFERENCES actions(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS trigger_bindings (
      id TEXT PRIMARY KEY,
      action_id TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      source_id TEXT,
      config_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(action_id) REFERENCES actions(id) ON DELETE CASCADE
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_action_steps_action_id ON action_steps(action_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_trigger_bindings_action_id ON trigger_bindings(action_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_trigger_bindings_trigger_type_source_id ON trigger_bindings(trigger_type, source_id)');
}

// ---------------------------------------------------------------------------
// v16 — extract `cues` as their own shareable table; action_steps reference
// a cue by id instead of embedding kind/payload directly; trigger_bindings
// gains a generic (target_type, target_id) in addition to action_id.
// ---------------------------------------------------------------------------
function ensureCuesAndMacrosSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cues (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      failure_policy TEXT NOT NULL DEFAULT 'continue',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  if (!hasColumn(db, 'action_steps', 'cue_id')) {
    db.exec('ALTER TABLE action_steps ADD COLUMN cue_id TEXT REFERENCES cues(id)');
  }

  if (!hasColumn(db, 'trigger_bindings', 'target_type')) {
    db.exec('ALTER TABLE trigger_bindings ADD COLUMN target_type TEXT');
  }
  if (!hasColumn(db, 'trigger_bindings', 'target_id')) {
    db.exec('ALTER TABLE trigger_bindings ADD COLUMN target_id TEXT');
  }

  const legacySteps = db
    .prepare(
      `SELECT id, action_id, kind, payload_json, failure_policy, created_at, updated_at
       FROM action_steps
       WHERE cue_id IS NULL`
    )
    .all() as Array<{
      id: string;
      action_id: string;
      kind: string;
      payload_json: string;
      failure_policy: string;
      created_at: string;
      updated_at: string;
    }>;

  const insertCue = db.prepare(
    `INSERT INTO cues (id, name, kind, payload_json, failure_policy, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const updateStepCueId = db.prepare('UPDATE action_steps SET cue_id = ? WHERE id = ?');

  for (const step of legacySteps) {
    const cueId = createId();
    insertCue.run(
      cueId,
      defaultCueName(step.kind as Parameters<typeof defaultCueName>[0]),
      step.kind,
      step.payload_json,
      step.failure_policy || 'continue',
      step.created_at,
      step.updated_at,
    );
    updateStepCueId.run(cueId, step.id);
  }

  if (hasColumn(db, 'trigger_bindings', 'action_id')) {
    db.exec(`
      UPDATE trigger_bindings
      SET target_type = COALESCE(target_type, 'macro'),
          target_id = COALESCE(target_id, action_id)
      WHERE target_type IS NULL OR target_id IS NULL
    `);
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_cues_updated_at ON cues(updated_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_action_steps_cue_id ON action_steps(cue_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_trigger_bindings_target ON trigger_bindings(target_type, target_id)');
}

// ---------------------------------------------------------------------------
// v17 — collapse parallel-group ordering (group_index/step_index) into a
// single order_index; drop cues.name; add macro_collections +
// actions.collection_id.
// ---------------------------------------------------------------------------
function migrateMacrosSequential(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS macro_collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const existingDefault = db.prepare('SELECT id FROM macro_collections WHERE is_default = 1 LIMIT 1').get() as { id: string } | undefined;
  let defaultMacroCollectionId = existingDefault?.id ?? null;
  if (!defaultMacroCollectionId) {
    defaultMacroCollectionId = createId();
    const now = nowIso();
    db
      .prepare('INSERT INTO macro_collections (id, name, order_index, is_default, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)')
      .run(defaultMacroCollectionId, 'Default Collection', 0, now, now);
  }

  if (!hasColumn(db, 'actions', 'collection_id')) {
    db.exec("ALTER TABLE actions ADD COLUMN collection_id TEXT NOT NULL DEFAULT ''");
    db.prepare("UPDATE actions SET collection_id = ? WHERE collection_id = '' OR collection_id IS NULL").run(defaultMacroCollectionId);
  }

  // Add order_index to action_steps and back-fill from group/step indexes.
  if (!hasColumn(db, 'action_steps', 'order_index')) {
    db.exec('ALTER TABLE action_steps ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0');
    if (hasColumn(db, 'action_steps', 'group_index') && hasColumn(db, 'action_steps', 'step_index')) {
      db.exec(`
        WITH ranked AS (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY action_id
            ORDER BY group_index ASC, step_index ASC, created_at ASC, id ASC
          ) - 1 AS rank FROM action_steps
        )
        UPDATE action_steps SET order_index = (SELECT rank FROM ranked WHERE ranked.id = action_steps.id);
      `);
    }
  }

  // Drop cues.name — the user never sets or sees a per-cue name. Wrapped in
  // try/catch because SQLite older than 3.35 lacks DROP COLUMN; the column
  // then just sits unused, which is harmless.
  if (hasColumn(db, 'cues', 'name')) {
    try {
      db.exec('ALTER TABLE cues DROP COLUMN name');
    } catch (error) {
      console.warn('[DB migrations] Could not drop cues.name column, leaving in place:', error);
    }
  }

  if (hasColumn(db, 'action_steps', 'group_index')) {
    try {
      db.exec('ALTER TABLE action_steps DROP COLUMN group_index');
    } catch (error) {
      console.warn('[DB migrations] Could not drop action_steps.group_index column, leaving in place:', error);
    }
  }
  if (hasColumn(db, 'action_steps', 'step_index')) {
    try {
      db.exec('ALTER TABLE action_steps DROP COLUMN step_index');
    } catch (error) {
      console.warn('[DB migrations] Could not drop action_steps.step_index column, leaving in place:', error);
    }
  }
}

// ---------------------------------------------------------------------------
// v18 — rebuild trigger_bindings to drop the legacy `action_id` column and
// promote (target_type, target_id) to NOT NULL. Requires foreign_keys off.
// ---------------------------------------------------------------------------
function rebuildTriggerBindingsForTargetColumns(db: SqliteDatabase): void {
  if (!hasTable(db, 'trigger_bindings')) return;
  if (!hasColumn(db, 'trigger_bindings', 'action_id')) return;

  db.exec(`
    CREATE TABLE trigger_bindings_new (
      id TEXT PRIMARY KEY,
      trigger_type TEXT NOT NULL,
      source_id TEXT,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(`
    INSERT INTO trigger_bindings_new
      (id, trigger_type, source_id, target_type, target_id, config_json, enabled, created_at, updated_at)
    SELECT
      id,
      trigger_type,
      source_id,
      COALESCE(target_type, 'macro'),
      COALESCE(target_id, action_id),
      config_json,
      enabled,
      created_at,
      updated_at
    FROM trigger_bindings;
  `);
  db.exec('DROP TABLE trigger_bindings');
  db.exec('ALTER TABLE trigger_bindings_new RENAME TO trigger_bindings');
  db.exec('CREATE INDEX IF NOT EXISTS idx_trigger_bindings_trigger_type_source_id ON trigger_bindings(trigger_type, source_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_trigger_bindings_target ON trigger_bindings(target_type, target_id)');
}

// ---------------------------------------------------------------------------
// v19 — background_json column on slides (already added the storage column
// in earlier work; this migration is the dedicated schema step for it).
// ---------------------------------------------------------------------------
function ensureSlideBackgroundColumn(db: SqliteDatabase): void {
  if (hasColumn(db, 'slides', 'background_json')) return;
  db.exec('ALTER TABLE slides ADD COLUMN background_json TEXT');
}

// ---------------------------------------------------------------------------
// v20 — fold scope/loop/lifecycle into macros and per-step delays into
// action_steps; retire the standalone `flow.wait` cue kind by folding each
// wait into an adjacent step's delay.
// ---------------------------------------------------------------------------
function foldFlowWaitStepsIntoDelays(db: SqliteDatabase): void {
  interface StepRow {
    stepId: string;
    orderIndex: number;
    kind: string;
    ms: number;
  }
  const steps = db
    .prepare(
      `SELECT s.id AS stepId, s.action_id AS macroId, s.order_index AS orderIndex,
              c.kind AS kind, c.payload_json AS payloadJson
       FROM action_steps s
       JOIN cues c ON c.id = s.cue_id
       ORDER BY s.action_id, s.order_index`,
    )
    .all() as Array<{ stepId: string; macroId: string; orderIndex: number; kind: string; payloadJson: string }>;

  const byMacro = new Map<string, StepRow[]>();
  for (const row of steps) {
    let ms = 0;
    if (row.kind === 'flow.wait') {
      try {
        const parsed = JSON.parse(row.payloadJson ?? '{}') as { ms?: number };
        ms = Number.isFinite(parsed.ms) ? Math.max(0, Math.round(Number(parsed.ms))) : 0;
      } catch { ms = 0; }
    }
    const list = byMacro.get(row.macroId) ?? [];
    list.push({ stepId: row.stepId, orderIndex: row.orderIndex, kind: row.kind, ms });
    byMacro.set(row.macroId, list);
  }

  const addBefore = db.prepare('UPDATE action_steps SET delay_before_ms = delay_before_ms + ? WHERE id = ?');
  const addAfter = db.prepare('UPDATE action_steps SET delay_after_ms = delay_after_ms + ? WHERE id = ?');

  for (const list of byMacro.values()) {
    list.sort((a, b) => a.orderIndex - b.orderIndex);
    for (let i = 0; i < list.length; i += 1) {
      const step = list[i];
      if (step.kind !== 'flow.wait' || step.ms <= 0) continue;
      const next = list.slice(i + 1).find((s) => s.kind !== 'flow.wait');
      if (next) {
        addBefore.run(step.ms, next.stepId);
      } else {
        const prev = list.slice(0, i).reverse().find((s) => s.kind !== 'flow.wait');
        if (prev) addAfter.run(step.ms, prev.stepId);
      }
    }
  }

  // Retire the kind entirely: drop every flow.wait cue along with its macro
  // steps and any bare-cue trigger bindings that pointed at it.
  const leftoverWaitCues = db.prepare("SELECT id FROM cues WHERE kind = 'flow.wait'").all() as Array<{ id: string }>;
  for (const { id } of leftoverWaitCues) {
    db.prepare("DELETE FROM trigger_bindings WHERE target_type = 'cue' AND target_id = ?").run(id);
    db.prepare('DELETE FROM action_steps WHERE cue_id = ?').run(id);
    db.prepare('DELETE FROM cues WHERE id = ?').run(id);
  }
}

function migrateMacroScopeLifecycle(db: SqliteDatabase): void {
  if (hasTable(db, 'actions')) {
    if (!hasColumn(db, 'actions', 'scope_level')) {
      db.exec("ALTER TABLE actions ADD COLUMN scope_level TEXT NOT NULL DEFAULT 'global'");
    }
    if (!hasColumn(db, 'actions', 'on_scope_exit')) {
      db.exec("ALTER TABLE actions ADD COLUMN on_scope_exit TEXT NOT NULL DEFAULT 'cancel'");
    }
    if (!hasColumn(db, 'actions', 'loop_enabled')) {
      db.exec('ALTER TABLE actions ADD COLUMN loop_enabled INTEGER NOT NULL DEFAULT 0');
    }
    if (!hasColumn(db, 'actions', 'loop_count')) {
      db.exec('ALTER TABLE actions ADD COLUMN loop_count INTEGER');
    }
  }

  if (hasTable(db, 'action_steps')) {
    if (!hasColumn(db, 'action_steps', 'delay_before_ms')) {
      db.exec('ALTER TABLE action_steps ADD COLUMN delay_before_ms INTEGER NOT NULL DEFAULT 0');
    }
    if (!hasColumn(db, 'action_steps', 'delay_after_ms')) {
      db.exec('ALTER TABLE action_steps ADD COLUMN delay_after_ms INTEGER NOT NULL DEFAULT 0');
    }
    foldFlowWaitStepsIntoDelays(db);
  }
}

// ---------------------------------------------------------------------------
// v21 — provenance tracking (slide_elements.source_theme_element_id) and
// background ownership (slides.background_source).
// ---------------------------------------------------------------------------
function migrateProvenance(db: SqliteDatabase): void {
  // Add source_theme_element_id to slide_elements
  if (!hasColumn(db, 'slide_elements', 'source_theme_element_id')) {
    db.exec('ALTER TABLE slide_elements ADD COLUMN source_theme_element_id TEXT');

    // Backfill: for each element whose ID matches the <slideId>:<themeElementId>
    // convention, extract the themeElementId. Conservative — only matches the
    // literal prefix pattern.
    const elements = db.prepare('SELECT se.id, se.slide_id FROM slide_elements se').all() as Array<{ id: string; slide_id: string }>;
    const update = db.prepare('UPDATE slide_elements SET source_theme_element_id = ? WHERE id = ?');
    for (const element of elements) {
      const prefix = `${element.slide_id}:`;
      if (element.id.startsWith(prefix)) {
        const themeElementId = element.id.slice(prefix.length);
        if (themeElementId.length > 0) {
          update.run(themeElementId, element.id);
        }
      }
    }
  }

  // Add background_source to slides
  if (!hasColumn(db, 'slides', 'background_source')) {
    db.exec("ALTER TABLE slides ADD COLUMN background_source TEXT DEFAULT 'theme'");
  }
}

// ---------------------------------------------------------------------------
// v22 — corrective migration for provenance and background ownership.
// Repairs the v21 migration, which defaulted all backgrounds to 'theme' and
// derived element provenance from ID prefixes without validating theme
// assignments. Idempotent and safe to run on both fresh and already-migrated
// databases.
// ---------------------------------------------------------------------------
function migrateProvenanceRepair(db: SqliteDatabase): void {
  // 1. Recompute background_source for all deck slides.
  const deckSlides = db
    .prepare(
      `SELECT s.id, s.presentation_id, s.lyric_id, s.talk_id, s.theme_id, s.background_json, s.background_source,
              p.theme_id as p_theme_id, l.theme_id as l_theme_id, t.theme_id as t_theme_id,
              p.id as p_id, l.id as l_id, t.id as t_id
       FROM slides s
       LEFT JOIN presentations p ON p.id = s.presentation_id
       LEFT JOIN lyrics l ON l.id = s.lyric_id
       LEFT JOIN talks t ON t.id = s.talk_id
       WHERE s.presentation_id IS NOT NULL OR s.lyric_id IS NOT NULL OR s.talk_id IS NOT NULL`
    )
    .all() as Array<{
      id: string;
      presentation_id: string | null;
      lyric_id: string | null;
      talk_id: string | null;
      theme_id: string | null;
      background_json: string | null;
      background_source: string | null;
      p_theme_id: string | null;
      l_theme_id: string | null;
      t_theme_id: string | null;
      p_id: string | null;
      l_id: string | null;
      t_id: string | null;
    }>;

  const updateBackgroundSource = db.prepare('UPDATE slides SET background_source = ? WHERE id = ?');

  for (const slide of deckSlides) {
    let ownerId: string | null = null;
    let ownerType: 'presentation' | 'lyric' | 'talk' | null = null;
    let ownerThemeId: string | null = null;

    if (slide.presentation_id) {
      ownerId = slide.p_id;
      ownerType = 'presentation';
      ownerThemeId = slide.p_theme_id;
    } else if (slide.lyric_id) {
      ownerId = slide.l_id;
      ownerType = 'lyric';
      ownerThemeId = slide.l_theme_id;
    } else if (slide.talk_id) {
      ownerId = slide.t_id;
      ownerType = 'talk';
      ownerThemeId = slide.t_theme_id;
    }

    let newBackgroundSource: 'theme' | 'local' = 'local';

    if (ownerId && ownerThemeId) {
      const theme = db
        .prepare(
          `SELECT t.id, t.kind, ts.background_json
           FROM themes t
           LEFT JOIN slides ts ON ts.id = t.id || ':slide' AND ts.theme_id = t.id
           WHERE t.id = ?`
        )
        .get(ownerThemeId) as { id: string; kind: string; background_json: string | null } | undefined;
      const isCompatible = theme && (
        (theme.kind === 'slides' && (ownerType === 'presentation' || ownerType === 'talk')) ||
        (theme.kind === 'lyrics' && ownerType === 'lyric')
      );

      if (theme && isCompatible) {
        const slideBg = slide.background_json ? parseJson<SlideBackground>(slide.background_json) : null;
        const themeBg = theme.background_json ? parseJson<SlideBackground>(theme.background_json) : null;
        newBackgroundSource = (slideBg && themeBg && JSON.stringify(slideBg) === JSON.stringify(themeBg)) ? 'theme' : 'local';
      } else {
        newBackgroundSource = 'local';
      }
    } else {
      newBackgroundSource = 'local';
    }

    if (slide.background_source !== newBackgroundSource) {
      updateBackgroundSource.run(newBackgroundSource, slide.id);
    }
  }

  // 2. Repair element provenance conservatively: start from NULL for every
  //    element, then only set provenance for proven cases.
  db.prepare('UPDATE slide_elements SET source_theme_element_id = NULL WHERE slide_id IN (SELECT id FROM slides WHERE presentation_id IS NOT NULL OR lyric_id IS NOT NULL OR talk_id IS NOT NULL)').run();

  const slidesWithThemes = db
    .prepare(
      `SELECT s.id as slide_id, s.presentation_id, s.lyric_id, s.talk_id,
              p.id as p_id, p.theme_id as p_theme_id,
              l.id as l_id, l.theme_id as l_theme_id,
              t.id as t_id, t.theme_id as t_theme_id
       FROM slides s
       LEFT JOIN presentations p ON p.id = s.presentation_id
       LEFT JOIN lyrics l ON l.id = s.lyric_id
       LEFT JOIN talks t ON t.id = s.talk_id
       WHERE s.presentation_id IS NOT NULL OR s.lyric_id IS NOT NULL OR s.talk_id IS NOT NULL`
    )
    .all() as Array<{
      slide_id: string;
      presentation_id: string | null;
      lyric_id: string | null;
      talk_id: string | null;
      p_id: string | null;
      p_theme_id: string | null;
      l_id: string | null;
      l_theme_id: string | null;
      t_id: string | null;
      t_theme_id: string | null;
    }>;

  const slideThemeMap = new Map<string, { themeId: string; themeElementIds: Set<string> }>();

  for (const slide of slidesWithThemes) {
    let ownerThemeId: string | null = null;
    let ownerType: 'presentation' | 'lyric' | 'talk' | null = null;

    if (slide.presentation_id && slide.p_theme_id) {
      ownerThemeId = slide.p_theme_id;
      ownerType = 'presentation';
    } else if (slide.lyric_id && slide.l_theme_id) {
      ownerThemeId = slide.l_theme_id;
      ownerType = 'lyric';
    } else if (slide.talk_id && slide.t_theme_id) {
      ownerThemeId = slide.t_theme_id;
      ownerType = 'talk';
    }

    if (ownerThemeId) {
      const theme = db.prepare('SELECT id, kind FROM themes WHERE id = ?').get(ownerThemeId) as { id: string; kind: string } | undefined;
      const isCompatible = theme && (
        (theme.kind === 'slides' && (ownerType === 'presentation' || ownerType === 'talk')) ||
        (theme.kind === 'lyrics' && ownerType === 'lyric')
      );

      if (theme && isCompatible) {
        const themeSlideId = `${ownerThemeId}:slide`;
        const themeElements = db.prepare('SELECT id FROM slide_elements WHERE slide_id = ?').all(themeSlideId) as Array<{ id: string }>;
        const themeElementIds = new Set(themeElements.map((e) => e.id));
        slideThemeMap.set(slide.slide_id, { themeId: ownerThemeId, themeElementIds });
      }
    }
  }

  const updateProvenance = db.prepare('UPDATE slide_elements SET source_theme_element_id = ? WHERE id = ?');

  for (const [slideId, { themeElementIds }] of slideThemeMap) {
    const elements = db.prepare('SELECT id FROM slide_elements WHERE slide_id = ?').all(slideId) as Array<{ id: string }>;
    for (const element of elements) {
      const prefix = `${slideId}:`;
      if (element.id.startsWith(prefix)) {
        const candidateThemeElementId = element.id.slice(prefix.length);
        if (candidateThemeElementId.length > 0 && themeElementIds.has(candidateThemeElementId)) {
          // Proven: this element was materialized from the theme element.
          updateProvenance.run(candidateThemeElementId, element.id);
        }
        // Otherwise leave as NULL (unproven).
      }
      // Elements not matching the convention remain NULL.
    }
  }
  // Note: recursive group-child provenance is never guessed. Only top-level
  // elements with proven legacy IDs get provenance set.
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'bootstrap-legacy-schema', up: bootstrapLegacySchema },
  { version: 2, name: 'stabilize-legacy-schema', up: stabilizeLegacySchema },
  { version: 3, name: 'global-scope', up: migrateLegacyProjectContentToGlobalScope, requiresForeignKeysOff: true },
  { version: 4, name: 'themes-schema', up: ensureThemesSchema },
  { version: 5, name: 'presentation-theme-schema', up: ensurePresentationThemeSchema },
  { version: 6, name: 'deck-items-schema', up: migratePresentationSchemaToDeckItems, requiresForeignKeysOff: true },
  { version: 7, name: 'reorder-columns', up: ensureReorderColumns },
  { version: 8, name: 'stages-schema', up: ensureStagesSchema },
  { version: 9, name: 'collections-schema', up: ensureCollectionsSchema },
  { version: 10, name: 'theme-naming', up: migrateTemplateNamingToThemes, requiresForeignKeysOff: true },
  { version: 11, name: 'unified-slides', up: migrateToUnifiedSlides, requiresForeignKeysOff: true },
  { version: 12, name: 'playlist-groups-rename', up: renamePlaylistSegmentsToGroups },
  { version: 13, name: 'talks-schema', up: ensureTalksSchema },
  { version: 14, name: 'talks-slides-check', up: repairSlidesCheckConstraintForTalks, requiresForeignKeysOff: true },
  { version: 15, name: 'actions-schema', up: ensureActionsSchema },
  { version: 16, name: 'cues-macros-schema', up: ensureCuesAndMacrosSchema },
  { version: 17, name: 'macros-sequential', up: migrateMacrosSequential },
  { version: 18, name: 'trigger-bindings-target-rebuild', up: rebuildTriggerBindingsForTargetColumns, requiresForeignKeysOff: true },
  { version: 19, name: 'slide-background-column', up: ensureSlideBackgroundColumn },
  { version: 20, name: 'macro-scope-lifecycle', up: migrateMacroScopeLifecycle },
  { version: 21, name: 'provenance', up: migrateProvenance },
  { version: 22, name: 'provenance-repair', up: migrateProvenanceRepair },
];
