// NEW regression coverage (#219 item-model refactor, wave D): exportBundle
// -> inspectImportBundle -> finalizeImportBundle round-tripped back into the
// SAME repository whose overlays/stages the bundle was exported from still
// exist at import time.
//
// The live defect this file pins down (found + fixed during the wave-D
// store rewrite, see the accompanying report's "runtime defects
// found+fixed" note): unlike theme and item elements (which always call
// `createId()` for their new element rows), the overlay/stage import paths
// used to carry the EXPORTING database's original element ids straight
// through into the new container slide's `slide_elements` rows. Re-importing
// a bundle into the same project it was exported from -- while the source
// overlay/stage was still live -- collided on the `slide_elements` PRIMARY
// KEY, because the still-live source overlay/stage's own elements occupy
// those exact ids. The fix regenerates fresh ids for every imported
// overlay/stage element (see `createImportedSlideElement` call sites in
// `finalizeImportBundle`).
//
// Also covers the broken-media-reference decision paths ('remove',
// 'replace', 'leave', and the two rejection branches) that a bundle import
// UI must drive through `inspectImportBundle`/`finalizeImportBundle`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BundleManifest, ElementCreateInput } from '@lumacast/protocol';
import { CastRepository } from './store';

let repo: CastRepository;
let tmpDir: string;

function closeRepo(): void {
  (repo as unknown as { db: { close(): void } }).db.close();
}

function firstSlideId(presentationId: string): string {
  const slide = repo.getSnapshot().slides.find((s) => s.presentationId === presentationId);
  if (!slide) throw new Error(`no slide found for presentation ${presentationId}`);
  return slide.id;
}

describe('bundle roundtrip: exportBundle -> inspectImportBundle -> finalizeImportBundle (#219)', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-bundle-roundtrip-'));
    repo = new CastRepository({
      dbPath: path.join(tmpDir, 'lumacast.sqlite'),
      userDataPath: tmpDir,
      documentsPath: path.join(tmpDir, 'documents'),
      seed: false,
    });
  });

  afterEach(() => {
    closeRepo();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('re-imports into the SAME repository while the source overlay/stage are still live, without an element-id collision', () => {
    const theme = repo.createTheme({ name: 'Brand', themeType: 'presentation' }).upserts.presentationThemes![0]!;
    const { itemId: presentationId } = repo.createItem({ type: 'presentation', title: 'Slides', themeId: theme.id });
    const overlay = repo.createOverlay({
      name: 'Watermark',
      elements: [
        {
          id: 'src-overlay-el',
          slideId: '',
          type: 'text',
          x: 0, y: 0, width: 100, height: 20, rotation: 0, opacity: 1, zIndex: 1, layer: 'content',
          payload: { text: 'CAST', fontFamily: 'Helvetica', fontSize: 24, color: '#FFFFFF', alignment: 'left', weight: '400' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    }).upserts.overlays![0]!;
    const stage = repo.createStage({
      name: 'Audience',
      elements: [
        {
          id: 'src-stage-el',
          slideId: '',
          type: 'text',
          x: 0, y: 0, width: 100, height: 20, rotation: 0, opacity: 1, zIndex: 1, layer: 'content',
          payload: { text: 'Stage', fontFamily: 'Helvetica', fontSize: 24, color: '#FFFFFF', alignment: 'left', weight: '400' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    }).upserts.stages![0]!;

    const before = repo.getSnapshot();

    const manifest = repo.exportBundle([presentationId], {
      includeAllThemes: true,
      includeOverlays: true,
      includeStages: true,
    });
    expect(manifest.version).toBe(2);
    expect(manifest.overlays).toHaveLength(1);
    expect(manifest.stages).toHaveLength(1);

    const inspection = repo.inspectImportBundle(manifest);
    expect(inspection.brokenReferences).toEqual([]);
    expect(inspection.itemCount).toBe(1);
    expect(inspection.overlayCount).toBe(1);
    expect(inspection.stageCount).toBe(1);

    // The bug reproduction: the source overlay/stage (and their elements)
    // are STILL LIVE in this exact repository at the moment of import.
    expect(() => repo.finalizeImportBundle(manifest, [])).not.toThrow();

    const after = repo.getSnapshot();
    expect(after.presentations).toHaveLength(before.presentations.length + 1);
    expect(after.overlays).toHaveLength(before.overlays.length + 1);
    expect(after.stages).toHaveLength(before.stages.length + 1);
    expect(after.presentationThemes).toHaveLength(before.presentationThemes.length + 1);

    // The imported overlay/stage are brand-new rows with fresh ids, never
    // reusing the source's ids.
    const importedOverlay = after.overlays.find((o) => o.id !== overlay.id)!;
    const importedStage = after.stages.find((s) => s.id !== stage.id)!;
    expect(importedOverlay).toBeTruthy();
    expect(importedStage).toBeTruthy();

    // The actual regression: the imported overlay/stage elements must never
    // collide (by id) with the still-live source overlay/stage elements --
    // every element id across both must be unique.
    const sourceOverlay = after.overlays.find((o) => o.id === overlay.id)!;
    const sourceStage = after.stages.find((s) => s.id === stage.id)!;
    expect(sourceOverlay.elements).toHaveLength(1);
    expect(importedOverlay.elements).toHaveLength(1);
    expect(importedOverlay.elements[0]!.id).not.toBe(sourceOverlay.elements[0]!.id);
    expect(sourceStage.elements).toHaveLength(1);
    expect(importedStage.elements).toHaveLength(1);
    expect(importedStage.elements[0]!.id).not.toBe(sourceStage.elements[0]!.id);

    // No duplicate slide_elements ids anywhere in the database (the collision
    // this bug produced was a raw SQLite PRIMARY KEY violation).
    const allElementIds = [
      ...sourceOverlay.elements.map((e) => e.id),
      ...importedOverlay.elements.map((e) => e.id),
      ...sourceStage.elements.map((e) => e.id),
      ...importedStage.elements.map((e) => e.id),
    ];
    expect(new Set(allElementIds).size).toBe(allElementIds.length);
  });

  it('imports items/themes as brand-new global rows and appends every bundle playlist rather than merging by name (D4)', () => {
    const { itemId: presentationId } = repo.createItem({ type: 'presentation', title: 'Slides' });
    const playlistId = repo.createPlaylist('Sunday').upserts.playlists![0]!.id;
    repo.addItemToPlaylist(playlistId, { type: 'presentation', id: presentationId });

    const before = repo.getSnapshot();
    const manifest = repo.exportBundle([presentationId], { playlistIds: [playlistId] });
    expect(manifest.playlists).toHaveLength(1);

    const after = repo.finalizeImportBundle(manifest, []);
    expect(after.playlists).toHaveLength(before.playlists.length + 1);
    // A brand-new playlist, never merged into the existing "Sunday" playlist.
    const importedPlaylist = after.playlists.find((p) => p.id !== playlistId)!;
    expect(importedPlaylist).toBeTruthy();
    expect(importedPlaylist.name).toBe('Sunday');
    expect(after.presentations).toHaveLength(before.presentations.length + 1);
  });

  // Regression (#219 item-model refactor decision D8, wave K): a real v1
  // (.cst) file -- nested groups, `kind`-tagged themes, `libraryName` -- is
  // no longer rejected. `normalizeBundleManifestV1` (protocol) converts it
  // to the current v2 shape before `inspectImportBundle`/`finalizeImportBundle`
  // ever see it: groups become separators, `kind:'slides'` becomes the
  // presentation family PLUS a talk-family clone for the theme the talk
  // references, `kind:'lyrics'`/`'overlays'` become their own families, and
  // `libraryName` is dropped.
  it('imports a legacy v1 (.cst) bundle: separators synthesized, and every theme family correct including a talk-theme clone', () => {
    const legacyManifest = {
      format: 'cast-deck-bundle',
      version: 1,
      exportedAt: new Date().toISOString(),
      items: [
        { id: 'pres-1', type: 'presentation', title: 'Slides', themeId: 'theme-slides', order: 0, slides: [] },
        { id: 'talk-1', type: 'talk', title: 'Sermon', themeId: 'theme-slides', order: 0, slides: [] },
        { id: 'lyric-1', type: 'lyric', title: 'Song', themeId: 'theme-lyrics', order: 0, slides: [] },
      ],
      themes: [
        { id: 'theme-slides', name: 'Brand', kind: 'slides', width: 1920, height: 1080, order: 0, elements: [] },
        { id: 'theme-lyrics', name: 'Song Background', kind: 'lyrics', width: 1920, height: 1080, order: 0, elements: [] },
        { id: 'theme-overlays', name: 'Lower Third', kind: 'overlays', width: 1280, height: 720, order: 0, elements: [] },
      ],
      mediaReferences: [],
      playlists: [
        {
          id: 'playlist-1',
          name: 'Sunday',
          libraryName: 'Main',
          order: 0,
          groups: [
            {
              id: 'group-1',
              name: 'Opening',
              colorKey: null,
              order: 0,
              entries: [{ id: 'entry-1', presentationId: 'pres-1', lyricId: null, talkId: null, order: 0 }],
            },
          ],
        },
      ],
    };

    const inspection = repo.inspectImportBundle(legacyManifest as unknown as BundleManifest);
    expect(inspection.itemCount).toBe(3);
    // theme-slides converts, PLUS a talk-family clone -> 4 themes total.
    expect(inspection.themeCount).toBe(4);
    expect(inspection.themes.map((theme) => theme.themeType).sort()).toEqual(['lyric', 'overlay', 'presentation', 'talk']);
    expect(inspection.playlists[0]).toMatchObject({ name: 'Sunday', separatorCount: 1, entryCount: 1 });

    const before = repo.getSnapshot();
    const after = repo.finalizeImportBundle(legacyManifest as unknown as BundleManifest, []);
    expect(after.presentationThemes).toHaveLength(before.presentationThemes.length + 1);
    expect(after.lyricThemes).toHaveLength(before.lyricThemes.length + 1);
    expect(after.talkThemes).toHaveLength(before.talkThemes.length + 1);
    expect(after.overlayThemes).toHaveLength(before.overlayThemes.length + 1);

    const importedPresentation = after.presentations.find((p) => p.title === 'Slides')!;
    const importedTalk = after.talks.find((t) => t.title === 'Sermon')!;
    const importedLyric = after.lyrics.find((l) => l.title === 'Song')!;
    expect(importedPresentation.themeId).not.toBeNull();
    expect(importedTalk.themeId).not.toBeNull();
    // Both originally referenced the SAME v1 'slides' theme, but land in two
    // different per-owner tables -- so the imported ids are never equal.
    expect(importedTalk.themeId).not.toBe(importedPresentation.themeId);
    expect(after.presentationThemes.some((t) => t.id === importedPresentation.themeId)).toBe(true);
    expect(after.talkThemes.some((t) => t.id === importedTalk.themeId)).toBe(true);
    expect(after.lyricThemes.some((t) => t.id === importedLyric.themeId)).toBe(true);

    const importedPlaylist = after.playlists.find((p) => p.name === 'Sunday')!;
    const importedRows = after.playlistEntries
      .filter((row) => row.playlistId === importedPlaylist.id)
      .sort((left, right) => left.order - right.order);
    expect(importedRows).toHaveLength(2);
    expect(importedRows[0]).toMatchObject({ kind: 'separator', label: 'Opening', colorKey: null });
    expect(importedRows[1].kind).toBe('item');
  });

  describe('broken media reference decisions', () => {
    function createPresentationWithBrokenImage(): { itemId: string; brokenSrc: string } {
      const { itemId } = repo.createItem({ type: 'presentation', title: 'Slides With Missing Media' });
      const slideId = firstSlideId(itemId);
      const missingPath = path.join(os.tmpdir(), 'lumacast-bundle-test-missing-image.png');
      expect(fs.existsSync(missingPath)).toBe(false);
      const brokenSrc = `cast-media://${encodeURIComponent(missingPath)}`;
      const input: ElementCreateInput = {
        slideId,
        type: 'image',
        x: 0, y: 0, width: 100, height: 100,
        payload: { src: brokenSrc, name: 'Missing', visible: true },
      };
      repo.createElement(input);
      return { itemId, brokenSrc };
    }

    it('inspectImportBundle reports the broken reference before any decision is made', () => {
      const { itemId, brokenSrc } = createPresentationWithBrokenImage();
      const manifest = repo.exportBundle([itemId]);

      const inspection = repo.inspectImportBundle(manifest);
      expect(inspection.brokenReferences).toHaveLength(1);
      expect(inspection.brokenReferences[0]!.source).toBe(brokenSrc);
      expect(inspection.brokenReferences[0]!.elementTypes).toEqual(['image']);
    });

    it('finalizeImportBundle throws when a broken reference has no matching decision', () => {
      const { itemId } = createPresentationWithBrokenImage();
      const manifest = repo.exportBundle([itemId]);

      expect(() => repo.finalizeImportBundle(manifest, [])).toThrow(/Missing import decision/);
    });

    it('"remove" strips the offending element from the imported slide', () => {
      const { itemId, brokenSrc } = createPresentationWithBrokenImage();
      const manifest = repo.exportBundle([itemId]);
      const before = repo.getSnapshot();

      const after = repo.finalizeImportBundle(manifest, [{ source: brokenSrc, action: 'remove' }]);
      const importedPresentation = after.presentations.find((p) => p.id !== itemId)!;
      expect(importedPresentation).toBeTruthy();
      const importedSlide = after.slides.find((s) => s.presentationId === importedPresentation.id)!;
      const importedImageElements = after.slideElements.filter((e) => e.slideId === importedSlide.id && e.type === 'image');
      expect(importedImageElements).toHaveLength(0);
      // The original item's own broken element is untouched.
      const sourceSlide = before.slides.find((s) => s.presentationId === itemId)!;
      expect(after.slideElements.some((e) => e.slideId === sourceSlide.id && e.type === 'image')).toBe(true);
    });

    it('"leave" keeps the still-broken source reference on the imported element', () => {
      const { itemId, brokenSrc } = createPresentationWithBrokenImage();
      const manifest = repo.exportBundle([itemId]);

      const after = repo.finalizeImportBundle(manifest, [{ source: brokenSrc, action: 'leave' }]);
      const importedPresentation = after.presentations.find((p) => p.id !== itemId)!;
      const importedSlide = after.slides.find((s) => s.presentationId === importedPresentation.id)!;
      const importedImageElement = after.slideElements.find((e) => e.slideId === importedSlide.id && e.type === 'image')!;
      expect(importedImageElement).toBeTruthy();
      expect((importedImageElement.payload as { src: string }).src).toBe(brokenSrc);
    });

    it('"replace" rewrites the element to the replacement path and registers a new media asset', () => {
      const { itemId, brokenSrc } = createPresentationWithBrokenImage();
      const manifest = repo.exportBundle([itemId]);
      const before = repo.getSnapshot();
      const replacementPath = path.join(tmpDir, 'replacement.png');

      const after = repo.finalizeImportBundle(manifest, [{ source: brokenSrc, action: 'replace', replacementPath }]);

      const importedPresentation = after.presentations.find((p) => p.id !== itemId)!;
      const importedSlide = after.slides.find((s) => s.presentationId === importedPresentation.id)!;
      const importedImageElement = after.slideElements.find((e) => e.slideId === importedSlide.id && e.type === 'image')!;
      const expectedSrc = `cast-media://${encodeURIComponent(replacementPath)}`;
      expect((importedImageElement.payload as { src: string }).src).toBe(expectedSrc);
      expect(after.mediaAssets.length).toBe(before.mediaAssets.length + 1);
      expect(after.mediaAssets.some((asset) => asset.src === expectedSrc)).toBe(true);
    });

    it('"replace" without a replacementPath throws', () => {
      const { itemId, brokenSrc } = createPresentationWithBrokenImage();
      const manifest = repo.exportBundle([itemId]);

      expect(() => repo.finalizeImportBundle(manifest, [{ source: brokenSrc, action: 'replace' }])).toThrow(
        /Replacement path is required/,
      );
    });
  });
});
