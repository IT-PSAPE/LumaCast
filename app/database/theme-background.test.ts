import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GroupElementPayload, Id, SlideBackground, SlideElement } from '@core/types';
import { CastRepository } from './store';
import { createTestRepository } from './test-support';

// Covers issue #105: the theme background must be created, updated, cleared,
// and persisted through the same repository transaction as theme elements,
// with omitted/null/present-value semantics distinguished precisely.

let repo: CastRepository;
let tmpDir: string;

function closeRepo(): void {
  (repo as unknown as { db: { close(): void } }).db.close();
}

function makeElement(id: Id, text: string, zIndex = 1): SlideElement {
  const now = new Date().toISOString();
  return {
    id,
    slideId: '',
    type: 'text',
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    rotation: 0,
    opacity: 1,
    zIndex,
    layer: 'content',
    payload: {
      text,
      fontFamily: 'Avenir Next',
      fontSize: 48,
      color: '#FFFFFF',
      alignment: 'left',
      weight: '400',
    },
    createdAt: now,
    updatedAt: now,
  };
}

function makeGroupElement(id: Id, children: SlideElement[], slideId: Id): SlideElement {
  const now = new Date().toISOString();
  return {
    id,
    slideId,
    type: 'group',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    layer: 'content',
    payload: { children } satisfies GroupElementPayload,
    createdAt: now,
    updatedAt: now,
  };
}

// Forces the Nth `db.prepare()` call whose SQL contains `match` to throw,
// simulating a failure partway through an atomic transaction so we can
// assert complete rollback. Restores the original `prepare` afterward.
function failOnPrepare(target: CastRepository, match: string, occurrence = 1): () => void {
  const db = (target as unknown as { db: { prepare: (sql: string) => unknown } }).db;
  const original = db.prepare.bind(db);
  let seen = 0;
  const spy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
    if (sql.includes(match)) {
      seen += 1;
      if (seen === occurrence) {
        throw new Error(`forced failure: ${match} #${occurrence}`);
      }
    }
    return original(sql);
  });
  return () => spy.mockRestore();
}

function themeBackground(themeId: Id, repository: CastRepository = repo): SlideBackground | null {
  return repository.getSnapshot().themes.find((t) => t.id === themeId)?.background ?? null;
}

describe('CastRepository theme background persistence (#105)', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-test-'));
    repo = new CastRepository({
      dbPath: path.join(tmpDir, 'lumacast.sqlite'),
      userDataPath: tmpDir,
      documentsPath: tmpDir,
    });
  });

  afterEach(() => {
    closeRepo();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── createTheme: every background variant round-trips ──────────────

  it('creates a theme with no background field and stores null', () => {
    const patch = repo.createTheme({ name: 'No BG', kind: 'slides', width: 1920, height: 1080 });
    const theme = patch.upserts.themes?.[0];
    expect(theme?.background ?? null).toBeNull();
    expect(themeBackground(theme!.id)).toBeNull();
  });

  it('creates a theme with a color background', () => {
    const background: SlideBackground = { type: 'color', color: '#ff0000' };
    const patch = repo.createTheme({ name: 'Color', kind: 'slides', background });
    const theme = patch.upserts.themes?.[0]!;
    expect(patch.upserts.themes?.[0]?.background).toEqual(background);
    expect(themeBackground(theme.id)).toEqual(background);
  });

  it('creates a theme with a linear gradient background and deep-copies its stops', () => {
    const background: SlideBackground = {
      type: 'gradient',
      gradient: { kind: 'linear', angle: 45, stops: [{ color: '#000000', position: 0 }, { color: '#ffffff', position: 100 }] },
    };
    const patch = repo.createTheme({ name: 'Linear', kind: 'slides', background });
    const theme = patch.upserts.themes?.[0]!;
    const persisted = themeBackground(theme.id);
    expect(persisted).toEqual(background);
    // Round-tripped through JSON — must be a distinct array, not the same reference.
    expect((persisted as { gradient: { stops: unknown[] } }).gradient.stops).not.toBe(background.gradient.stops);
  });

  it('creates a theme with a radial gradient background', () => {
    const background: SlideBackground = {
      type: 'gradient',
      gradient: { kind: 'radial', stops: [{ color: '#111111', position: 0 }, { color: '#222222', position: 50 }, { color: '#333333', position: 100 }] },
    };
    const patch = repo.createTheme({ name: 'Radial', kind: 'slides', background });
    const theme = patch.upserts.themes?.[0]!;
    expect(themeBackground(theme.id)).toEqual(background);
  });

  it('creates a theme with an image background, reusing a managed media id', () => {
    const background: SlideBackground = { type: 'image', mediaAssetId: 'media-1', src: 'file:///bg.png', fit: 'cover' };
    const patch = repo.createTheme({ name: 'Image', kind: 'slides', background });
    const theme = patch.upserts.themes?.[0]!;
    expect(themeBackground(theme.id)).toEqual(background);
    // No new media asset was materialized by persisting the background.
    expect(repo.getSnapshot().mediaAssets).toHaveLength(0);
  });

  it('creates a theme with a video background', () => {
    const background: SlideBackground = { type: 'video', mediaAssetId: 'media-2', src: 'file:///bg.mp4', fit: 'contain' };
    const patch = repo.createTheme({ name: 'Video', kind: 'slides', background });
    const theme = patch.upserts.themes?.[0]!;
    expect(themeBackground(theme.id)).toEqual(background);
  });

  it('creates theme elements and background together in the same call', () => {
    const background: SlideBackground = { type: 'color', color: '#abcdef' };
    const elements = [makeElement('e-1', 'Title'), makeElement('e-2', 'Subtitle', 2)];
    const patch = repo.createTheme({ name: 'Combined', kind: 'slides', background, elements });
    const theme = patch.upserts.themes?.[0]!;
    const snapshot = repo.getSnapshot();
    const persistedTheme = snapshot.themes.find((t) => t.id === theme.id);
    expect(persistedTheme?.background).toEqual(background);
    // Theme elements are a container's own `elements` field, not
    // `snapshot.slideElements` -- that collection is scoped to deck content
    // slides only (#211) and never carries container elements.
    expect(persistedTheme?.elements).toHaveLength(2);
  });

  it('normalizes nested group ownership when persisting a duplicated-theme draft', () => {
    const temporarySlideId = 'temporary-theme:slide';
    const child = { ...makeElement('temporary-child', 'Nested title'), slideId: temporarySlideId };
    const group = makeGroupElement('temporary-group', [child], temporarySlideId);

    const created = repo.createTheme({
      name: 'Persisted duplicate',
      kind: 'slides',
      elements: [group],
    }).upserts.themes![0];

    const persisted = repo.getSnapshot().themes.find((theme) => theme.id === created.id)!;
    const persistedGroup = persisted.elements[0];
    const persistedChild = (persistedGroup.payload as GroupElementPayload).children[0];

    expect(persisted.slideId).toBe(`${created.id}:slide`);
    expect(persistedGroup.slideId).toBe(persisted.slideId);
    expect(persistedChild.slideId).toBe(persisted.slideId);
    expect(persistedChild.id).toBe(child.id);
  });

  // ─── updateTheme: presence semantics (omitted / null / value) ───────

  it('leaves the background unchanged when the field is omitted from an update', () => {
    const background: SlideBackground = { type: 'color', color: '#123456' };
    const created = repo.createTheme({ name: 'Theme', kind: 'slides', background }).upserts.themes![0];

    repo.updateTheme({ id: created.id, name: 'Renamed' });

    const snapshot = repo.getSnapshot();
    const theme = snapshot.themes.find((t) => t.id === created.id)!;
    expect(theme.name).toBe('Renamed');
    expect(theme.background).toEqual(background);
  });

  it('clears the background when the update explicitly sets it to null', () => {
    const background: SlideBackground = { type: 'color', color: '#123456' };
    const created = repo.createTheme({ name: 'Theme', kind: 'slides', background }).upserts.themes![0];

    repo.updateTheme({ id: created.id, background: null });

    expect(themeBackground(created.id)).toBeNull();
  });

  it('replaces the background when the update provides a new value', () => {
    const original: SlideBackground = { type: 'color', color: '#111111' };
    const replacement: SlideBackground = { type: 'color', color: '#eeeeee' };
    const created = repo.createTheme({ name: 'Theme', kind: 'slides', background: original }).upserts.themes![0];

    repo.updateTheme({ id: created.id, background: replacement });

    expect(themeBackground(created.id)).toEqual(replacement);
  });

  it('performs a background-only update without touching name, dimensions, or elements', () => {
    const elements = [makeElement('e-1', 'Title')];
    const created = repo.createTheme({ name: 'Untouched', kind: 'slides', width: 1280, height: 720, elements }).upserts.themes![0];

    repo.updateTheme({ id: created.id, background: { type: 'color', color: '#00ff00' } });

    const snapshot = repo.getSnapshot();
    const theme = snapshot.themes.find((t) => t.id === created.id)!;
    expect(theme.name).toBe('Untouched');
    expect(theme.width).toBe(1280);
    expect(theme.height).toBe(720);
    expect(theme.elements).toHaveLength(1);
    expect(theme.background).toEqual({ type: 'color', color: '#00ff00' });
  });

  it('marks a background-only edit as a background-only edit is recognized (background differs, everything else matches)', () => {
    const created = repo.createTheme({ name: 'Sig', kind: 'slides' }).upserts.themes![0];
    repo.updateTheme({ id: created.id, background: { type: 'color', color: '#ABCDEF' } });
    const before = repo.getSnapshot().themes.find((t) => t.id === created.id)!;
    repo.updateTheme({ id: created.id, background: { type: 'color', color: '#FEDCBA' } });
    const after = repo.getSnapshot().themes.find((t) => t.id === created.id)!;
    expect(after.background).not.toEqual(before.background);
    expect(after.name).toBe(before.name);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
  });

  it('updates elements and background together in the same call', () => {
    const created = repo.createTheme({ name: 'Theme', kind: 'slides', elements: [makeElement('e-1', 'One')] }).upserts.themes![0];
    const background: SlideBackground = { type: 'color', color: '#654321' };

    repo.updateTheme({ id: created.id, background, elements: [makeElement('e-2', 'Two'), makeElement('e-3', 'Three')] });

    const snapshot = repo.getSnapshot();
    const theme = snapshot.themes.find((t) => t.id === created.id)!;
    expect(theme.background).toEqual(background);
    expect(theme.elements.map((e) => e.id).sort()).toEqual(['e-2', 'e-3']);
  });

  // ─── Save and restart persistence ────────────────────────────────────

  it('survives closing and reopening the database', () => {
    const { repository, close, reopen, cleanup } = createTestRepository();
    try {
      const background: SlideBackground = {
        type: 'gradient',
        gradient: { kind: 'linear', angle: 90, stops: [{ color: '#010101', position: 0 }, { color: '#fefefe', position: 100 }] },
      };
      const created = repository.createTheme({ name: 'Restart', kind: 'slides', background }).upserts.themes![0];

      close();
      const reopened = reopen();

      const theme = reopened.getSnapshot().themes.find((t) => t.id === created.id);
      expect(theme?.background).toEqual(background);
    } finally {
      close();
      cleanup();
    }
  });

  // ─── Transaction atomicity: forced failure rolls back everything ────

  it('rolls back the background and theme row when element materialization fails during create', () => {
    const background: SlideBackground = { type: 'color', color: '#101010' };
    const restore = failOnPrepare(repo, 'INSERT INTO slide_elements');
    try {
      expect(() => repo.createTheme({ name: 'Boom', kind: 'slides', background, elements: [makeElement('e-1', 'One')] })).toThrow();
    } finally {
      restore();
    }
    const snapshot = repo.getSnapshot();
    expect(snapshot.themes.some((t) => t.name === 'Boom')).toBe(false);
  });

  it('rolls back a background clear when the final theme-row update fails', () => {
    const background: SlideBackground = { type: 'color', color: '#202020' };
    const created = repo.createTheme({ name: 'Theme', kind: 'slides', background }).upserts.themes![0];

    const restore = failOnPrepare(repo, 'UPDATE themes');
    try {
      expect(() => repo.updateTheme({ id: created.id, background: null })).toThrow();
    } finally {
      restore();
    }

    // The background UPDATE ran earlier in the same transaction as the
    // failing theme-row UPDATE — both must roll back together.
    expect(themeBackground(created.id)).toEqual(background);
  });

  it('leaves the source theme untouched when a duplicate-style create fails', () => {
    const background: SlideBackground = { type: 'color', color: '#303030' };
    const source = repo.createTheme({ name: 'Source', kind: 'slides', background, elements: [makeElement('e-1', 'One')] }).upserts.themes![0];

    const restore = failOnPrepare(repo, 'INSERT INTO themes');
    try {
      expect(() => repo.createTheme({ name: 'Source Copy', kind: 'slides', background, elements: [makeElement('e-2', 'One')] })).toThrow();
    } finally {
      restore();
    }

    const snapshot = repo.getSnapshot();
    expect(snapshot.themes.some((t) => t.name === 'Source Copy')).toBe(false);
    const persistedSource = snapshot.themes.find((t) => t.id === source.id)!;
    expect(persistedSource.background).toEqual(background);
    expect(persistedSource.elements).toHaveLength(1);
  });
});
