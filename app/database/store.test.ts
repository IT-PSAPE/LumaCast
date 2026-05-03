import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSnapshot, DeckBundleManifest, MediaAsset, PlaylistTree, SlideElement } from '@core/types';
import { SqliteDatabase } from './sqlite';

let currentUserDataPath = '';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => currentUserDataPath),
  },
}));

function buildEmptySnapshot(): AppSnapshot {
  return {
    libraries: [],
    libraryBundles: [],
    presentations: [],
    lyrics: [],
    slides: [],
    slideElements: [],
    mediaAssets: [],
    overlays: [],
    themes: [],
    stages: [],
    collections: [],
  };
}

function buildImageElement(src: string): SlideElement {
  return {
    id: 'element-image',
    slideId: 'slide-1',
    type: 'image',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    layer: 'content',
    payload: { src },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function buildTextElement(): SlideElement {
  return {
    id: 'element-text',
    slideId: 'overlay-1',
    type: 'text',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    layer: 'content',
    payload: {
      text: 'Overlay',
      fontFamily: 'Avenir Next',
      fontSize: 48,
      color: '#FFFFFF',
      alignment: 'left',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('CastRepository', () => {
  let tempRoot: string;
  let repo: any = null;

  beforeEach(() => {
    vi.resetModules();
    tempRoot = fs.mkdtempSync(path.join(process.cwd(), '.tmp-lumacast-store-test-'));
    currentUserDataPath = tempRoot;
  });

  afterEach(() => {
    repo?.db?.close?.();
    repo = null;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('preserves fade and pulse overlay animation kinds', async () => {
    const storeModule = await import('./store');
    repo = new storeModule.CastRepository();
    repo.restoreFromSnapshot(buildEmptySnapshot());

    const createPatch = repo.createOverlay({
      name: 'Overlay',
      animation: { kind: 'fade', durationMs: 350, autoClearDurationMs: 1000 },
      elements: [buildTextElement()],
    });
    const overlayId = createPatch.upserts.overlays?.[0]?.id;

    expect(repo.getSnapshot().overlays[0]?.animation.kind).toBe('fade');

    repo.updateOverlay({
      id: overlayId ?? '',
      animation: { kind: 'pulse', durationMs: 600, autoClearDurationMs: null },
    });

    expect(repo.getSnapshot().overlays[0]?.animation).toMatchObject({
      kind: 'pulse',
      durationMs: 600,
      autoClearDurationMs: null,
    });
  });

  it('assigns imported replacement assets the next media order', async () => {
    const storeModule = await import('./store');
    repo = new storeModule.CastRepository();
    repo.restoreFromSnapshot(buildEmptySnapshot());

    const existingPath = path.join(tempRoot, 'existing.png');
    fs.writeFileSync(existingPath, 'existing');
    repo.createMediaAsset({
      name: 'Existing asset',
      type: 'image',
      src: existingPath,
    });

    const replacementPath = path.join(tempRoot, 'replacement.png');
    fs.writeFileSync(replacementPath, 'replacement');
    const missingSource = path.join(tempRoot, 'missing.png');

    const manifest: DeckBundleManifest = {
      format: 'cast-deck-bundle',
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      items: [{
        id: 'item-1',
        type: 'presentation',
        title: 'Imported deck',
        themeId: null,
        order: 0,
        slides: [{
          id: 'slide-1',
          width: 1920,
          height: 1080,
          notes: '',
          order: 0,
          elements: [buildImageElement(missingSource)],
        }],
      }],
      themes: [],
      mediaReferences: [],
    };

    const snapshot = repo.finalizeImportBundle(manifest, [{
      source: missingSource,
      action: 'replace',
      replacementPath,
    }]);

    expect(snapshot.mediaAssets.map((asset: MediaAsset) => ({ name: asset.name, order: asset.order }))).toEqual([
      { name: 'Existing asset', order: 0 },
      { name: 'replacement.png', order: 1 },
    ]);
  });

  it('restores playlists using explicit playlist order values', async () => {
    const storeModule = await import('./store');
    repo = new storeModule.CastRepository();

    const library = {
      id: 'library-1',
      name: 'Library',
      order: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const playlistA: PlaylistTree = {
      playlist: {
        id: 'playlist-a',
        libraryId: library.id,
        name: 'Playlist A',
        order: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      segments: [],
    };
    const playlistB: PlaylistTree = {
      playlist: {
        id: 'playlist-b',
        libraryId: library.id,
        name: 'Playlist B',
        order: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      segments: [],
    };

    const restored = repo.restoreFromSnapshot({
      ...buildEmptySnapshot(),
      libraries: [library],
      libraryBundles: [{
        library,
        playlists: [playlistB, playlistA],
      }],
    });

    expect(restored.libraryBundles[0]?.playlists.map((tree: PlaylistTree) => ({
      id: tree.playlist.id,
      order: tree.playlist.order,
    }))).toEqual([
      { id: 'playlist-a', order: 0 },
      { id: 'playlist-b', order: 1 },
    ]);
  });

  it('migrates legacy template tables and columns to theme naming', async () => {
    const storeModule = await import('./store');
    const presentationId = 'legacy-presentation';
    const themeId = 'legacy-theme';
    const now = '2026-01-01T00:00:00.000Z';

    repo = new storeModule.CastRepository();
    repo.db.close();
    repo = null;

    const dbPath = path.join(tempRoot, 'lumacast.sqlite');
    const db = new SqliteDatabase(dbPath);
    db.exec('DROP INDEX IF EXISTS idx_themes_order_index;');
    db.exec('DROP INDEX IF EXISTS idx_themes_collection_id;');
    db.exec('DROP INDEX IF EXISTS idx_decks_theme_id;');
    db.exec('DROP INDEX IF EXISTS idx_lyrics_theme_id;');
    db.exec('DROP INDEX IF EXISTS idx_theme_collections_order_index;');
    db.pragma('foreign_keys = OFF');
    db.exec('DROP TABLE IF EXISTS themes;');
    db.exec('ALTER TABLE theme_collections RENAME TO template_collections;');
    db.exec('ALTER TABLE presentations RENAME COLUMN theme_id TO template_id;');
    db.exec('ALTER TABLE lyrics RENAME COLUMN theme_id TO template_id;');
    db.exec('DELETE FROM presentations;');
    db.exec('DELETE FROM playlist_entries;');
    db.exec('DELETE FROM slides;');
    db.exec('DELETE FROM slide_elements;');
    // Recreate `templates` in its pre-v11 form (elements_json column, no
    // slide_id) so this fixture mirrors the v9 schema. The v10 + v11
    // migrations will rename it to themes and add slide_id on next open.
    db.exec(`
      CREATE TABLE templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        elements_json TEXT NOT NULL DEFAULT '[]',
        collection_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const deckCollectionId = (db.prepare('SELECT id FROM deck_collections WHERE is_default = 1 LIMIT 1').get() as { id: string }).id;
    const themeCollectionId = (db.prepare('SELECT id FROM template_collections WHERE is_default = 1 LIMIT 1').get() as { id: string }).id;
    db.prepare(
      `INSERT INTO templates (id, name, kind, width, height, order_index, elements_json, collection_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(themeId, 'Legacy theme', 'slides', 1920, 1080, 0, '[]', themeCollectionId, now, now);
    db.prepare(
      `INSERT INTO presentations (id, title, template_id, collection_id, order_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(presentationId, 'Migrated deck', themeId, deckCollectionId, 0, now, now);
    db.exec('CREATE INDEX idx_templates_order_index ON templates(order_index);');
    db.exec('CREATE INDEX idx_templates_collection_id ON templates(collection_id);');
    db.exec('CREATE INDEX idx_presentations_template_id ON presentations(template_id);');
    db.exec('CREATE INDEX idx_lyrics_template_id ON lyrics(template_id);');
    db.exec('CREATE INDEX idx_template_collections_order_index ON template_collections(order_index);');
    db.pragma('foreign_keys = ON');
    db.pragma('user_version = 9');
    db.close();

    repo = new storeModule.CastRepository();

    const migratedSnapshot = repo.getSnapshot();
    expect(migratedSnapshot.themes).toHaveLength(1);
    expect(migratedSnapshot.themes[0]?.id).toBe(themeId);
    expect(migratedSnapshot.presentations[0]?.themeId).toBe(themeId);

    const migratedDb = new SqliteDatabase(dbPath, { readonly: true });
    expect(
      migratedDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'themes'").get()
    ).toBeTruthy();
    expect(
      migratedDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'templates'").get()
    ).toBeUndefined();
    expect(
      (migratedDb.prepare('PRAGMA table_info(presentations)').all() as Array<{ name: string }>).some((column) => column.name === 'theme_id')
    ).toBe(true);
    expect(
      (migratedDb.prepare('PRAGMA table_info(presentations)').all() as Array<{ name: string }>).some((column) => column.name === 'template_id')
    ).toBe(false);
    migratedDb.close();
  });
});
