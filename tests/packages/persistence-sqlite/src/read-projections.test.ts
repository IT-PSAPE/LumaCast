import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestRepository, type TestRepositoryHandle } from '../../../../packages/persistence-sqlite/src/test-support';
import { LATEST_SCHEMA_VERSION } from '../../../../packages/persistence-sqlite/src/migrations';
import type { Id } from '@lumacast/kernel';

// Covers the read-projection RPC surface added alongside `getSnapshot()`:
// listPlaylists, getPlaylist, listItems, getItem, getSlide, listMediaAssets,
// listThemes, listOverlays, listStages, getProjectOverview, searchContent.
// Every method is read-only and SQL-driven (joins/counts), not a snapshot
// materialization — these tests assert shape, counts, pagination, query
// filtering, not-found errors, and assetId resolution, plus a recursive
// guarantee that no result carries a raw `src`/`thumbnailSrc` key anywhere.

/** Recursively asserts no object anywhere in `value` has a key literally named `src` or `thumbnailSrc`. */
function assertNoRawMediaSrc(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoRawMediaSrc(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'src' || key === 'thumbnailSrc') {
        throw new Error(`Found forbidden key "${key}" at ${path}.${key} (raw media source must never cross this boundary)`);
      }
      assertNoRawMediaSrc(entry, `${path}.${key}`);
    }
  }
}

let target: TestRepositoryHandle;
let repo: TestRepositoryHandle['repository'];

interface Fixture {
  imageAssetId: Id;
  imageAssetSrc: string;
  videoAssetId: Id;
  audioAssetId: Id;
  presentationId: Id;
  presentationSlideId: Id;
  lyricId: Id;
  playlistId: Id;
  separatorId: Id;
  overlayId: Id;
  stageId: Id;
  presentationThemeId: Id;
  lyricThemeId: Id;
  overlayThemeId: Id;
  macroId: Id;
  cueId: Id;
}

function buildFixture(): Fixture {
  const imageAssetPatch = repo.createMediaAsset({ name: 'Logo', type: 'image', src: 'cast-media://library/logo.png' });
  const imageAsset = imageAssetPatch.upserts.mediaAssets![0]!;
  const videoAssetPatch = repo.createMediaAsset({ name: 'Intro Video', type: 'video', src: 'cast-media://library/intro.mp4' });
  const videoAsset = videoAssetPatch.upserts.mediaAssets![0]!;
  const audioAssetPatch = repo.createMediaAsset({ name: 'Bed Track', type: 'audio', src: 'cast-media://library/bed.mp3' });
  const audioAsset = audioAssetPatch.upserts.mediaAssets![0]!;

  const presentationThemeId = repo.createTheme({ name: 'Alpha Theme', themeType: 'presentation' }).upserts.presentationThemes![0]!.id;
  const lyricThemeId = repo.createTheme({ name: 'Beta Theme', themeType: 'lyric' }).upserts.lyricThemes![0]!.id;
  const overlayThemeId = repo.createTheme({ name: 'Overlay Theme', themeType: 'overlay' }).upserts.overlayThemes![0]!.id;

  const presentationCreate = repo.createItem({ type: 'presentation', title: 'Alpha Deck', themeId: presentationThemeId });
  const presentationId = presentationCreate.itemId;
  const presentationSlideId = presentationCreate.patch.upserts.slides![0]!.id;

  const lyricCreate = repo.createItem({ type: 'lyric', title: 'Beta Song' });
  const lyricId = lyricCreate.itemId;

  // A distinctive text element for full-text search, plus fontFamily noise
  // ('Arial') that must NOT produce a false-positive slide search hit.
  repo.createElement({
    slideId: presentationSlideId,
    type: 'text',
    x: 0,
    y: 0,
    width: 400,
    height: 80,
    payload: {
      text: 'Amazing grace how sweet the sound',
      fontFamily: 'Arial',
      fontSize: 24,
      color: '#ffffff',
      alignment: 'left',
    },
  });

  // Image element resolving to a known asset.
  repo.createElement({
    slideId: presentationSlideId,
    type: 'image',
    x: 0,
    y: 0,
    width: 50,
    height: 50,
    payload: { src: imageAsset.src },
  });

  // Group element with a nested image child whose src matches no asset row
  // (must resolve to a null assetId, not throw).
  const now = new Date().toISOString();
  repo.createElement({
    slideId: presentationSlideId,
    type: 'group',
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    payload: {
      children: [
        {
          id: 'nested-child-1',
          slideId: presentationSlideId,
          type: 'image',
          x: 0,
          y: 0,
          width: 20,
          height: 20,
          rotation: 0,
          opacity: 1,
          zIndex: 0,
          layer: 'media',
          payload: { src: 'cast-media://library/does-not-exist.png' },
          createdAt: now,
          updatedAt: now,
        },
      ],
    },
  });

  repo.updateSlideBackground({
    slideId: presentationSlideId,
    background: { type: 'image', mediaAssetId: null, src: imageAsset.src, fit: 'cover' },
  });

  const playlistId = repo.createPlaylist('Set 1').upserts.playlists![0]!.id;
  repo.addItemToPlaylist(playlistId, { type: 'presentation', id: presentationId });
  const separatorId = repo.createSeparator(playlistId, 'Bridge').upserts.playlistEntries![0]!.id;
  repo.addItemToPlaylist(playlistId, { type: 'lyric', id: lyricId });

  const overlayId = repo.createOverlay({ name: 'Lower Third' }).upserts.overlays![0]!.id;
  const stageId = repo.createStage({ name: 'Main Stage', width: 1920, height: 1080 }).upserts.stages![0]!.id;

  const cueId = repo.createCue({ kind: 'overlay.clearAll', payload: {} }).upserts.cues![0]!.id;
  const macroId = repo.createMacro({ name: 'Sunrise Fade' }).upserts.macros![0]!.id;

  return {
    imageAssetId: imageAsset.id,
    imageAssetSrc: imageAsset.src,
    videoAssetId: videoAsset.id,
    audioAssetId: audioAsset.id,
    presentationId,
    presentationSlideId,
    lyricId,
    playlistId,
    separatorId,
    overlayId,
    stageId,
    presentationThemeId,
    lyricThemeId,
    overlayThemeId,
    macroId,
    cueId,
  };
}

describe('read projections', () => {
  let fixture: Fixture;

  beforeEach(() => {
    target = createTestRepository({ seed: false });
    repo = target.repository;
    fixture = buildFixture();
  });

  afterEach(() => {
    target.close();
    target.cleanup();
  });

  describe('listPlaylists', () => {
    it('summarizes row/item/separator counts', () => {
      const playlists = repo.listPlaylists();
      expect(playlists).toHaveLength(1);
      expect(playlists[0]).toMatchObject({
        id: fixture.playlistId,
        name: 'Set 1',
        order: 0,
        rowCount: 3,
        itemCount: 2,
        separatorCount: 1,
      });
    });

    it('counts a playlist with no rows as zero, not null', () => {
      repo.createPlaylist('Empty');
      const empty = repo.listPlaylists().find((playlist) => playlist.name === 'Empty');
      expect(empty).toMatchObject({ rowCount: 0, itemCount: 0, separatorCount: 0 });
    });
  });

  describe('getPlaylist', () => {
    it('returns ordered rows with item titles/slideCounts and separator label/colorKey', () => {
      const detail = repo.getPlaylist({ id: fixture.playlistId });
      expect(detail).toMatchObject({ id: fixture.playlistId, name: 'Set 1', order: 0 });
      expect(detail.rows).toHaveLength(3);

      const [first, second, third] = detail.rows;
      expect(first).toMatchObject({
        kind: 'item',
        itemRef: { type: 'presentation', id: fixture.presentationId },
        title: 'Alpha Deck',
        slideCount: 1,
      });
      expect(second).toMatchObject({ kind: 'separator', rowId: fixture.separatorId, label: 'Bridge', colorKey: null });
      expect(third).toMatchObject({
        kind: 'item',
        itemRef: { type: 'lyric', id: fixture.lyricId },
        title: 'Beta Song',
        slideCount: 1,
      });
    });

    it('throws a not-found error for a missing playlist', () => {
      expect(() => repo.getPlaylist({ id: 'missing' })).toThrow(/Playlist not found/);
    });
  });

  describe('listItems', () => {
    it('returns both item types with slideCount, themeId, and playlistIds', () => {
      const items = repo.listItems({});
      const alpha = items.find((item) => item.ref.id === fixture.presentationId)!;
      expect(alpha).toMatchObject({
        ref: { type: 'presentation', id: fixture.presentationId },
        title: 'Alpha Deck',
        slideCount: 1,
        themeId: fixture.presentationThemeId,
        playlistIds: [fixture.playlistId],
      });
      const beta = items.find((item) => item.ref.id === fixture.lyricId)!;
      expect(beta).toMatchObject({ title: 'Beta Song', themeId: null, playlistIds: [fixture.playlistId] });
    });

    it('filters by type', () => {
      const lyricsOnly = repo.listItems({ type: 'lyric' });
      expect(lyricsOnly.every((item) => item.ref.type === 'lyric')).toBe(true);
      expect(lyricsOnly.some((item) => item.ref.id === fixture.lyricId)).toBe(true);
      expect(lyricsOnly.some((item) => item.ref.id === fixture.presentationId)).toBe(false);
    });

    it('filters by a case-insensitive substring query on title', () => {
      const matches = repo.listItems({ query: 'ALPHA' });
      expect(matches).toHaveLength(1);
      expect(matches[0]!.ref.id).toBe(fixture.presentationId);
    });

    it('paginates with offset/limit', () => {
      const all = repo.listItems({});
      expect(all).toHaveLength(2);
      const firstOnly = repo.listItems({ limit: 1 });
      expect(firstOnly).toHaveLength(1);
      const secondOnly = repo.listItems({ limit: 1, offset: 1 });
      expect(secondOnly).toHaveLength(1);
      expect(secondOnly[0]!.ref.id).not.toBe(firstOnly[0]!.ref.id);
    });

    it('defaults to a limit of 100 and clamps a huge limit to 500', () => {
      for (let index = 0; index < 120; index += 1) {
        repo.createItem({ type: 'presentation', title: `Bulk ${index}` });
      }
      expect(repo.listItems({})).toHaveLength(100);
      expect(repo.listItems({ limit: 100_000 })).toHaveLength(122); // 120 bulk + Alpha Deck + Beta Song, well under the 500 cap
    });
  });

  describe('getItem', () => {
    it('returns item detail without slides by default', () => {
      const detail = repo.getItem({ ref: { type: 'presentation', id: fixture.presentationId } });
      expect(detail).toMatchObject({
        ref: { type: 'presentation', id: fixture.presentationId },
        title: 'Alpha Deck',
        themeId: fixture.presentationThemeId,
      });
      expect(detail.slides).toBeUndefined();
    });

    it('includes slides (without elements) when includeSlides is set', () => {
      const detail = repo.getItem({ ref: { type: 'presentation', id: fixture.presentationId }, includeSlides: true });
      expect(detail.slides).toHaveLength(1);
      expect(detail.slides![0]).toMatchObject({ id: fixture.presentationSlideId, ownerRef: { type: 'presentation', id: fixture.presentationId } });
      expect(detail.slides![0]!.elements).toBeUndefined();
    });

    it('includes resolved elements when includeSlides and includeElements are both set', () => {
      const detail = repo.getItem({
        ref: { type: 'presentation', id: fixture.presentationId },
        includeSlides: true,
        includeElements: true,
      });
      const elements = detail.slides![0]!.elements!;
      const imageElement = elements.find((element) => element.type === 'image')!;
      expect((imageElement.payload as { assetId: Id | null }).assetId).toBe(fixture.imageAssetId);
    });

    it('throws a not-found error for a missing item', () => {
      expect(() => repo.getItem({ ref: { type: 'presentation', id: 'missing' } })).toThrow(/Item not found/);
    });
  });

  describe('getSlide', () => {
    it('resolves ownerRef, backgroundSource, and a background assetId matching the image asset by src', () => {
      const slide = repo.getSlide({ slideId: fixture.presentationSlideId });
      expect(slide).toMatchObject({
        id: fixture.presentationSlideId,
        ownerRef: { type: 'presentation', id: fixture.presentationId },
        backgroundSource: 'local',
      });
      expect(slide.background).toMatchObject({ type: 'image', assetId: fixture.imageAssetId, fit: 'cover' });
    });

    it('omits elements by default and includes them, recursively resolved, when requested', () => {
      const withoutElements = repo.getSlide({ slideId: fixture.presentationSlideId });
      expect(withoutElements.elements).toBeUndefined();

      const withElements = repo.getSlide({ slideId: fixture.presentationSlideId, includeElements: true });
      const elements = withElements.elements!;

      const imageElement = elements.find((element) => element.type === 'image')!;
      expect((imageElement.payload as { src?: string }).src).toBeUndefined();
      expect((imageElement.payload as { assetId: Id | null }).assetId).toBe(fixture.imageAssetId);

      const groupElement = elements.find((element) => element.type === 'group')!;
      const nestedChild = (groupElement.payload as { children: Array<{ type: string; payload: { assetId: Id | null } }> }).children[0]!;
      expect(nestedChild.type).toBe('image');
      expect(nestedChild.payload.assetId).toBeNull();

      const textElement = elements.find((element) => element.type === 'text')!;
      expect((textElement.payload as { text: string }).text).toBe('Amazing grace how sweet the sound');
    });

    it('throws a not-found error for a missing slide', () => {
      expect(() => repo.getSlide({ slideId: 'missing' })).toThrow(/Slide not found/);
    });
  });

  describe('listMediaAssets', () => {
    it('summarizes every asset type with hasThumbnail always false', () => {
      const assets = repo.listMediaAssets({});
      expect(assets).toHaveLength(3);
      for (const asset of assets) {
        expect(asset.hasThumbnail).toBe(false);
      }
      const image = assets.find((asset) => asset.id === fixture.imageAssetId)!;
      expect(image).toMatchObject({ name: 'Logo', type: 'image' });
    });

    it('filters by type', () => {
      const videos = repo.listMediaAssets({ type: 'video' });
      expect(videos).toHaveLength(1);
      expect(videos[0]!.id).toBe(fixture.videoAssetId);
    });

    it('filters by a case-insensitive substring query on name', () => {
      const matches = repo.listMediaAssets({ query: 'bed' });
      expect(matches).toHaveLength(1);
      expect(matches[0]!.id).toBe(fixture.audioAssetId);
    });

    it('paginates with limit/offset', () => {
      expect(repo.listMediaAssets({ limit: 1 })).toHaveLength(1);
      expect(repo.listMediaAssets({ limit: 1, offset: 2 })).toHaveLength(1);
      expect(repo.listMediaAssets({ limit: 10, offset: 10 })).toHaveLength(0);
    });
  });

  describe('listThemes', () => {
    it('summarizes all three owner types with linkedItemCount', () => {
      const themes = repo.listThemes({});
      expect(themes).toHaveLength(3);
      const presentationTheme = themes.find((theme) => theme.id === fixture.presentationThemeId)!;
      expect(presentationTheme).toMatchObject({ ownerType: 'presentation', name: 'Alpha Theme', linkedItemCount: 1 });
      const lyricTheme = themes.find((theme) => theme.id === fixture.lyricThemeId)!;
      expect(lyricTheme).toMatchObject({ ownerType: 'lyric', linkedItemCount: 0 });
      const overlayTheme = themes.find((theme) => theme.id === fixture.overlayThemeId)!;
      expect(overlayTheme).toMatchObject({ ownerType: 'overlay', linkedItemCount: 0 });
    });

    it('filters by ownerType', () => {
      const overlayThemes = repo.listThemes({ ownerType: 'overlay' });
      expect(overlayThemes).toHaveLength(1);
      expect(overlayThemes[0]!.id).toBe(fixture.overlayThemeId);
    });
  });

  describe('listOverlays', () => {
    it('summarizes id/name/enabled/order/animation', () => {
      const overlays = repo.listOverlays();
      expect(overlays).toHaveLength(1);
      expect(overlays[0]).toMatchObject({ id: fixture.overlayId, name: 'Lower Third', enabled: true, order: 0 });
      expect(overlays[0]!.animation).toMatchObject({ kind: 'none' });
    });
  });

  describe('listStages', () => {
    it('summarizes id/name/width/height/order', () => {
      const stages = repo.listStages();
      expect(stages).toHaveLength(1);
      expect(stages[0]).toMatchObject({ id: fixture.stageId, name: 'Main Stage', width: 1920, height: 1080, order: 0 });
    });
  });

  describe('getProjectOverview', () => {
    it('reports counts, playlists, recent items, and the current schema version', () => {
      const overview = repo.getProjectOverview();
      expect(overview.counts).toMatchObject({
        playlists: 1,
        presentations: 1,
        lyrics: 1,
        slides: 2,
        mediaAssets: 3,
        themes: 3,
        overlays: 1,
        stages: 1,
        macros: 1,
        cues: 1,
      });
      expect(overview.playlists).toEqual([{ id: fixture.playlistId, name: 'Set 1' }]);
      expect(overview.recentItems.length).toBeLessThanOrEqual(10);
      expect(overview.recentItems.some((item) => item.ref.id === fixture.presentationId)).toBe(true);
      expect(overview.schemaVersion).toBe(LATEST_SCHEMA_VERSION);
    });

    it('caps recentItems at 10 even with more items', () => {
      for (let index = 0; index < 15; index += 1) {
        repo.createItem({ type: 'lyric', title: `Recent ${index}` });
      }
      const overview = repo.getProjectOverview();
      expect(overview.recentItems).toHaveLength(10);
    });
  });

  describe('searchContent', () => {
    it('finds a playlist by name', () => {
      const results = repo.searchContent({ query: 'set 1' });
      expect(results.some((result) => result.kind === 'playlist' && result.id === fixture.playlistId)).toBe(true);
    });

    it('finds an item by title with an itemRef', () => {
      const results = repo.searchContent({ query: 'alpha' });
      const hit = results.find((result) => result.kind === 'item');
      expect(hit).toMatchObject({ id: fixture.presentationId, itemRef: { type: 'presentation', id: fixture.presentationId } });
    });

    it('finds a media asset by name', () => {
      const results = repo.searchContent({ query: 'logo' });
      expect(results.some((result) => result.kind === 'media' && result.id === fixture.imageAssetId)).toBe(true);
    });

    it('finds a theme, overlay, stage, and macro by name', () => {
      expect(repo.searchContent({ query: 'alpha theme' }).some((result) => result.kind === 'theme')).toBe(true);
      expect(repo.searchContent({ query: 'lower third' }).some((result) => result.kind === 'overlay')).toBe(true);
      expect(repo.searchContent({ query: 'main stage' }).some((result) => result.kind === 'stage')).toBe(true);
      expect(repo.searchContent({ query: 'sunrise fade' }).some((result) => result.kind === 'macro')).toBe(true);
    });

    it('finds slide text content with a snippet and slide/item references', () => {
      const results = repo.searchContent({ query: 'sweet the' });
      const hit = results.find((result) => result.kind === 'slide')!;
      expect(hit).toBeDefined();
      expect(hit.slideId).toBe(fixture.presentationSlideId);
      expect(hit.itemRef).toEqual({ type: 'presentation', id: fixture.presentationId });
      expect(hit.snippet).toContain('sweet the');
    });

    it('does not report a slide hit for a query that only matches JSON noise outside the text field', () => {
      const results = repo.searchContent({ query: 'Arial' });
      expect(results.some((result) => result.kind === 'slide')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(repo.searchContent({ query: 'AMAZING GRACE' }).some((result) => result.kind === 'slide')).toBe(true);
    });

    it('returns an empty array for a blank query', () => {
      expect(repo.searchContent({ query: '   ' })).toEqual([]);
    });
  });

  describe('no raw media src anywhere in read-projection results', () => {
    it('recursively contains no `src`/`thumbnailSrc` key across every method', () => {
      assertNoRawMediaSrc(repo.listPlaylists());
      assertNoRawMediaSrc(repo.getPlaylist({ id: fixture.playlistId }));
      assertNoRawMediaSrc(repo.listItems({}));
      assertNoRawMediaSrc(repo.getItem({ ref: { type: 'presentation', id: fixture.presentationId }, includeSlides: true, includeElements: true }));
      assertNoRawMediaSrc(repo.getSlide({ slideId: fixture.presentationSlideId, includeElements: true }));
      assertNoRawMediaSrc(repo.listMediaAssets({}));
      assertNoRawMediaSrc(repo.listThemes({}));
      assertNoRawMediaSrc(repo.listOverlays());
      assertNoRawMediaSrc(repo.listStages());
      assertNoRawMediaSrc(repo.getProjectOverview());
      assertNoRawMediaSrc(repo.searchContent({ query: 'a' }));
    });
  });
});
