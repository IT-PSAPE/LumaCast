import { describe, expect, it } from 'vitest';
import type { Id } from '@lumacast/kernel';
import type { MediaAssetType, SlideElement } from '@lumacast/composition';
import type { CastRepository } from './store';
import { createTestRepository } from './test-support';

// `updateMediaAssetSrc` used to rewrite only the asset's own row
// (image_assets/video_assets/audio_assets). Content references media by
// value — `ImageElementPayload`/`VideoElementPayload` copy `src` into every
// element that uses it, and there is no `assetId` foreign key anywhere — so
// "Replace source" left every slide/theme/overlay/stage that already used
// the asset pointing at the old, missing file. This suite pins the fix: the
// old source string is repointed everywhere it is stored, in the same
// transaction as the asset row, and the returned patch names every entity
// touched so the renderer snapshot and undo/redo stay truthful.
//
// Reference surface, confirmed by reading the schema rather than assumed:
// `slide_elements.payload_json` (image/video, including nested `group`
// children) and `slides.background_json` (added in migration v19 — themes,
// overlays, and stages each own exactly one container slide row, so this
// single column covers all four background owners). No other table stores
// a media source string (see migrations/definitions.ts and
// project-backup-io.ts's column lists).

function createRepo() {
  return createTestRepository();
}

function createMediaAsset(repo: CastRepository, type: MediaAssetType, src: string, name = 'Asset'): Id {
  const patch = repo.createMediaAsset({ name, type, src });
  const asset = patch.upserts.mediaAssets?.[0];
  if (!asset) throw new Error('createMediaAsset returned no asset');
  return asset.id;
}

/** A presentation with its default starter slide's real id — no default elements are asserted on, so the seed content doesn't interfere. */
function createPresentationSlide(repo: CastRepository): Id {
  const result = repo.createItem({ type: 'presentation', title: 'Test' });
  const slideId = result.patch.upserts.slides?.[0]?.id;
  if (!slideId) throw new Error('createItem returned no slide');
  return slideId;
}

function imageElement(id: Id, slideId: Id, src: string): SlideElement {
  const now = new Date().toISOString();
  return {
    id,
    slideId,
    type: 'image',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    layer: 'media',
    payload: { src },
    createdAt: now,
    updatedAt: now,
  };
}

function groupElement(id: Id, slideId: Id, children: SlideElement[]): SlideElement {
  const now = new Date().toISOString();
  return {
    id,
    slideId,
    type: 'group',
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    layer: 'content',
    payload: { children },
    createdAt: now,
    updatedAt: now,
  };
}

function findElement(repo: CastRepository, id: Id): SlideElement {
  const element = repo.getSnapshot().slideElements.find((candidate) => candidate.id === id);
  if (!element) throw new Error(`Element not found in snapshot: ${id}`);
  return element;
}

describe('CastRepository.updateMediaAssetSrc reference repointing', () => {
  it('throws for an unresolvable asset id', () => {
    const { repository: repo, close, cleanup } = createRepo();
    try {
      expect(() => repo.updateMediaAssetSrc('no-such-asset', 'file:///replacement'))
        .toThrow(/Media asset not found: no-such-asset/);
    } finally {
      close();
      cleanup();
    }
  });

  it('repoints a slide element image payload that used the old source', () => {
    const { repository: repo, close, cleanup } = createRepo();
    try {
      const oldSrc = 'file:///old.png';
      const newSrc = 'file:///new.png';
      const assetId = createMediaAsset(repo, 'image', oldSrc);
      const slideId = createPresentationSlide(repo);
      repo.createElement(imageElement('img-1', slideId, oldSrc));

      const patch = repo.updateMediaAssetSrc(assetId, newSrc);

      expect(patch.upserts.slideElements?.map((el) => el.id)).toContain('img-1');
      expect(findElement(repo, 'img-1').payload).toMatchObject({ src: newSrc });
    } finally {
      close();
      cleanup();
    }
  });

  it('repoints a source containing LIKE metacharacters (% and _)', () => {
    const { repository: repo, close, cleanup } = createRepo();
    try {
      // Stored sources are `cast-media://<encodeURIComponent(path)>`, so a
      // realistic old source is full of `%`-encoded characters and can
      // easily contain `_` too — the SQL-side LIKE prefilter must escape
      // both (and `\`) or it stops being a reliable superset of the
      // authoritative decode-and-compare check below.
      const oldSrc = 'cast-media://%2Fusers%2Ftest%2Ffile_name%25literal.png';
      const newSrc = 'cast-media://%2Fusers%2Ftest%2Freplacement.png';
      const assetId = createMediaAsset(repo, 'image', oldSrc);
      const slideId = createPresentationSlide(repo);
      repo.createElement(imageElement('img-metachar', slideId, oldSrc));

      const patch = repo.updateMediaAssetSrc(assetId, newSrc);

      expect(patch.upserts.slideElements?.map((el) => el.id)).toContain('img-metachar');
      expect(findElement(repo, 'img-metachar').payload).toMatchObject({ src: newSrc });
    } finally {
      close();
      cleanup();
    }
  });

  it('does not rewrite an element whose src merely contains the old source as a substring', () => {
    const { repository: repo, close, cleanup } = createRepo();
    try {
      const oldSrc = 'file:///a.png';
      // Contains `oldSrc` as a literal substring, so the LIKE prefilter
      // matches this row — but it is a different, longer source string, so
      // the structural decode-and-compare must reject it and leave it alone.
      const longerSrc = 'file:///a.png.backup';
      const assetId = createMediaAsset(repo, 'image', oldSrc);
      const slideId = createPresentationSlide(repo);
      repo.createElement(imageElement('img-substring', slideId, longerSrc));

      const patch = repo.updateMediaAssetSrc(assetId, 'file:///new.png');

      expect(patch.upserts.slideElements).toBeUndefined();
      expect(findElement(repo, 'img-substring').payload).toMatchObject({ src: longerSrc });
    } finally {
      close();
      cleanup();
    }
  });

  it('repoints an image nested inside group children, at any depth', () => {
    const { repository: repo, close, cleanup } = createRepo();
    try {
      const oldSrc = 'file:///old.png';
      const newSrc = 'file:///new.png';
      const assetId = createMediaAsset(repo, 'image', oldSrc);
      const slideId = createPresentationSlide(repo);

      // group-root > group-inner > img-nested — two levels of nesting, since
      // the rewrite recurses generically rather than special-casing one level.
      const nestedImage = imageElement('img-nested', slideId, oldSrc);
      const innerGroup = groupElement('group-inner', slideId, [nestedImage]);
      const rootGroup = groupElement('group-root', slideId, [innerGroup]);
      repo.createElement(rootGroup);

      const patch = repo.updateMediaAssetSrc(assetId, newSrc);

      // The nested child isn't its own slide_elements row — the whole group
      // is one row — so the patch names the top-level group, not the child.
      expect(patch.upserts.slideElements?.map((el) => el.id)).toContain('group-root');

      const rewritten = findElement(repo, 'group-root');
      const payload = rewritten.payload as unknown as { children: SlideElement[] };
      const innerPayload = payload.children[0].payload as unknown as { children: SlideElement[] };
      const nestedPayload = innerPayload.children[0].payload as unknown as { src: string };
      expect(nestedPayload.src).toBe(newSrc);
    } finally {
      close();
      cleanup();
    }
  });

  it('repoints a plain slide background', () => {
    const { repository: repo, close, cleanup } = createRepo();
    try {
      const oldSrc = 'file:///old.png';
      const newSrc = 'file:///new.png';
      const assetId = createMediaAsset(repo, 'image', oldSrc);
      const slideId = createPresentationSlide(repo);
      repo.updateSlideBackground({ slideId, background: { type: 'image', mediaAssetId: assetId, src: oldSrc, fit: 'cover' } });

      const patch = repo.updateMediaAssetSrc(assetId, newSrc);

      expect(patch.upserts.slides?.map((slide) => slide.id)).toContain(slideId);
      const slide = patch.upserts.slides?.find((candidate) => candidate.id === slideId);
      expect(slide?.background).toMatchObject({ type: 'image', src: newSrc });
    } finally {
      close();
      cleanup();
    }
  });

  it('repoints a presentation theme background', () => {
    const { repository: repo, close, cleanup } = createRepo();
    try {
      const oldSrc = 'file:///old.png';
      const newSrc = 'file:///new.png';
      const assetId = createMediaAsset(repo, 'image', oldSrc);
      const themePatch = repo.createTheme({
        name: 'Theme',
        themeType: 'presentation',
        background: { type: 'image', mediaAssetId: assetId, src: oldSrc, fit: 'cover' },
      });
      const themeId = themePatch.upserts.presentationThemes?.[0]?.id;
      if (!themeId) throw new Error('createTheme returned no theme');

      const patch = repo.updateMediaAssetSrc(assetId, newSrc);

      expect(patch.upserts.presentationThemes?.map((theme) => theme.id)).toContain(themeId);
      const theme = patch.upserts.presentationThemes?.find((candidate) => candidate.id === themeId);
      expect(theme?.background).toMatchObject({ type: 'image', src: newSrc });
      // A themed background is not an ordinary content slide (getSlides()
      // only returns rows with a presentation/lyric/talk owner) — asserting
      // the theme key alone, and not `patch.upserts.slides`, pins that the
      // container-slide branch is the one exercised.
      expect(patch.upserts.slides).toBeUndefined();
    } finally {
      close();
      cleanup();
    }
  });

  it('repoints an overlay background', () => {
    const { repository: repo, close, cleanup } = createRepo();
    try {
      const oldSrc = 'file:///old.png';
      const newSrc = 'file:///new.png';
      const assetId = createMediaAsset(repo, 'video', oldSrc);
      const overlayPatch = repo.createOverlay({ name: 'Overlay' });
      const overlayId = overlayPatch.upserts.overlays?.[0]?.id;
      if (!overlayId) throw new Error('createOverlay returned no overlay');
      repo.updateSlideBackground({ slideId: `${overlayId}:slide`, background: { type: 'video', mediaAssetId: assetId, src: oldSrc, fit: 'cover' } });

      const patch = repo.updateMediaAssetSrc(assetId, newSrc);

      expect(patch.upserts.overlays?.map((overlay) => overlay.id)).toContain(overlayId);
      const overlay = patch.upserts.overlays?.find((candidate) => candidate.id === overlayId);
      expect(overlay?.background).toMatchObject({ type: 'video', src: newSrc });
    } finally {
      close();
      cleanup();
    }
  });

  it('repoints a stage background', () => {
    const { repository: repo, close, cleanup } = createRepo();
    try {
      const oldSrc = 'file:///old.png';
      const newSrc = 'file:///new.png';
      const assetId = createMediaAsset(repo, 'image', oldSrc);
      const stagePatch = repo.createStage({ name: 'Stage' });
      const stageId = stagePatch.upserts.stages?.[0]?.id;
      if (!stageId) throw new Error('createStage returned no stage');
      repo.updateSlideBackground({ slideId: `${stageId}:slide`, background: { type: 'image', mediaAssetId: assetId, src: oldSrc, fit: 'cover' } });

      const patch = repo.updateMediaAssetSrc(assetId, newSrc);

      expect(patch.upserts.stages?.map((stage) => stage.id)).toContain(stageId);
      const stage = patch.upserts.stages?.find((candidate) => candidate.id === stageId);
      expect(stage?.background).toMatchObject({ type: 'image', src: newSrc });
    } finally {
      close();
      cleanup();
    }
  });

  it('returns a single patch naming every touched entity when the source is used everywhere at once', () => {
    const { repository: repo, close, cleanup } = createRepo();
    try {
      const oldSrc = 'file:///everywhere.png';
      const newSrc = 'file:///replacement.png';
      const assetId = createMediaAsset(repo, 'image', oldSrc);

      const slideId = createPresentationSlide(repo);
      repo.createElement(imageElement('img-flat', slideId, oldSrc));
      repo.createElement(groupElement('group-nested', slideId, [imageElement('img-in-group', slideId, oldSrc)]));
      repo.updateSlideBackground({ slideId, background: { type: 'image', mediaAssetId: assetId, src: oldSrc, fit: 'cover' } });

      const themePatch = repo.createTheme({ name: 'Theme', themeType: 'presentation', background: { type: 'image', mediaAssetId: assetId, src: oldSrc, fit: 'cover' } });
      const themeId = themePatch.upserts.presentationThemes?.[0]?.id as Id;

      const overlayPatch = repo.createOverlay({ name: 'Overlay' });
      const overlayId = overlayPatch.upserts.overlays?.[0]?.id as Id;
      repo.updateSlideBackground({ slideId: `${overlayId}:slide`, background: { type: 'image', mediaAssetId: assetId, src: oldSrc, fit: 'cover' } });

      const stagePatch = repo.createStage({ name: 'Stage' });
      const stageId = stagePatch.upserts.stages?.[0]?.id as Id;
      repo.updateSlideBackground({ slideId: `${stageId}:slide`, background: { type: 'image', mediaAssetId: assetId, src: oldSrc, fit: 'cover' } });

      const patch = repo.updateMediaAssetSrc(assetId, newSrc);

      expect(patch.upserts.mediaAssets?.map((asset) => asset.id)).toEqual([assetId]);
      expect(new Set(patch.upserts.slideElements?.map((el) => el.id))).toEqual(new Set(['img-flat', 'group-nested']));
      expect(patch.upserts.slides?.map((slide) => slide.id)).toEqual([slideId]);
      expect(patch.upserts.presentationThemes?.map((theme) => theme.id)).toEqual([themeId]);
      expect(patch.upserts.overlays?.map((overlay) => overlay.id)).toEqual([overlayId]);
      expect(patch.upserts.stages?.map((stage) => stage.id)).toEqual([stageId]);
    } finally {
      close();
      cleanup();
    }
  });

  it('clears width/height/duration/codec by default, as before', () => {
    const { repository: repo, close, cleanup } = createRepo();
    try {
      const oldSrc = 'file:///old.mp4';
      const assetId = createMediaAsset(repo, 'video', oldSrc);
      repo.updateMediaAssetMetadata(assetId, oldSrc, { width: 1280, height: 720, duration: 12.5, codec: 'h264' });

      const patch = repo.updateMediaAssetSrc(assetId, 'file:///new.mp4');

      expect(patch.upserts.mediaAssets?.[0]).toMatchObject({ width: null, height: null, duration: null, codec: null });
    } finally {
      close();
      cleanup();
    }
  });

  it('preserves width/height/duration/codec when preserveMetadata is true', () => {
    const { repository: repo, close, cleanup } = createRepo();
    try {
      const oldSrc = 'file:///old.mp4';
      const assetId = createMediaAsset(repo, 'video', oldSrc);
      repo.updateMediaAssetMetadata(assetId, oldSrc, { width: 1280, height: 720, duration: 12.5, codec: 'h264' });

      const patch = repo.updateMediaAssetSrc(assetId, 'file:///new.mp4', { preserveMetadata: true });

      expect(patch.upserts.mediaAssets?.[0]).toMatchObject({ width: 1280, height: 720, duration: 12.5, codec: 'h264' });
    } finally {
      close();
      cleanup();
    }
  });

  it('does not rewrite an unrelated asset row that happens to share the old source string', () => {
    const { repository: repo, close, cleanup } = createRepo();
    try {
      const sharedSrc = 'file:///shared.png';
      const newSrc = 'file:///new.png';
      const assetA = createMediaAsset(repo, 'image', sharedSrc, 'A');
      const assetB = createMediaAsset(repo, 'image', sharedSrc, 'B');
      const slideId = createPresentationSlide(repo);
      repo.createElement(imageElement('img-shared', slideId, sharedSrc));

      const patch = repo.updateMediaAssetSrc(assetA, newSrc);

      // The asset identified by id is rewritten...
      expect(patch.upserts.mediaAssets?.[0]).toMatchObject({ id: assetA, src: newSrc });
      // ...content that matched the shared string is rewritten too, since
      // content has no assetId FK and can only be matched by string...
      expect(findElement(repo, 'img-shared').payload).toMatchObject({ src: newSrc });
      // ...but the sibling asset row is untouched: asset rows are keyed by
      // id, not repointed by string match, so only the row named by `id`
      // in this call is ever written.
      const untouchedAsset = repo.getMediaAsset(assetB);
      expect(untouchedAsset?.src).toBe(sharedSrc);
    } finally {
      close();
      cleanup();
    }
  });

  it('rewrites nothing when the old and new source are equal', () => {
    const { repository: repo, close, cleanup } = createRepo();
    try {
      const src = 'file:///unchanged.png';
      const assetId = createMediaAsset(repo, 'image', src);
      const slideId = createPresentationSlide(repo);
      repo.createElement(imageElement('img-unchanged', slideId, src));

      const patch = repo.updateMediaAssetSrc(assetId, src);

      expect(patch.upserts.mediaAssets?.map((asset) => asset.id)).toEqual([assetId]);
      expect(patch.upserts.slideElements).toBeUndefined();
      expect(patch.upserts.slides).toBeUndefined();
      expect(findElement(repo, 'img-unchanged').payload).toMatchObject({ src });
    } finally {
      close();
      cleanup();
    }
  });
});
