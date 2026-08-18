import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SlideElement, SlideElementPayload } from '@lumacast/composition';
import { CastRepository } from './store';

// Covers #211 (ported for the #219 item-model refactor): `getSlides()`
// deliberately scopes itself to item-owned slides (presentation/lyric/talk)
// and documents that theme/overlay/stage container slides are surfaced
// through their owner's `elements` field instead. `getSlideElements()` must
// agree -- it must never return a row whose `slideId` belongs to a
// container's own slide, only ids that also appear in `getSlides()`.
//
// This test pins the scope contract directly: `getSlides()` and
// `getSlideElements()` must agree on which slides are "in" the snapshot, for
// a repository holding items, all four theme families, an overlay, and a
// stage together, so a future change to either getter fails loudly here
// instead of resurfacing as a downstream defect (the #219 refactor split the
// old single `themes` table into four owner tables, each with its own
// container-slide kind -- see schema-final.md D2/SlideKind).

let repo: CastRepository;
let tmpDir: string;

function closeRepo(): void {
  (repo as unknown as { db: { close(): void } }).db.close();
}

const textPayload: SlideElementPayload = {
  text: 'Container element',
  fontFamily: 'Avenir Next',
  fontSize: 48,
  color: '#FFFFFF',
  alignment: 'left',
  weight: '400',
};

function makeElement(id: string, zIndex = 1): SlideElement {
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
    payload: textPayload,
    createdAt: now,
    updatedAt: now,
  };
}

describe('AppSnapshot.slides / AppSnapshot.slideElements scope agreement (#211)', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-snapshot-scope-'));
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

  it('scopes both getters to the same item-owned slide ids when a presentation theme, an overlay, and a stage are also present', () => {
    // Item content: a themed presentation with an extra element (the theme's
    // elements get applied to its first slide), plus an unthemed lyric.
    const theme = repo.createTheme({
      name: 'Theme',
      themeType: 'presentation',
      elements: [makeElement('theme-el-1'), makeElement('theme-el-2', 2)],
    }).upserts.presentationThemes![0]!;
    const { itemId: presentationId } = repo.createItem({ type: 'presentation', title: 'Deck', themeId: theme.id });
    const { itemId: lyricId } = repo.createItem({ type: 'lyric', title: 'Song' });

    // Container content: an overlay and a stage, each with their own
    // elements, living on their own container slide.
    const overlay = repo.createOverlay({ name: 'Overlay', elements: [makeElement('overlay-el-1')] }).upserts.overlays![0]!;
    const stage = repo.createStage({ name: 'Stage', elements: [makeElement('stage-el-1'), makeElement('stage-el-2', 2), makeElement('stage-el-3', 3)] }).upserts.stages![0]!;

    const snapshot = repo.getSnapshot();

    // `slides` is item-only: exactly the presentation's and lyric's slides,
    // never a `{container.id}:slide` row.
    const itemSlideIds = new Set(snapshot.slides.map((slide) => slide.id));
    expect(snapshot.slides.every((slide) => slide.presentationId === presentationId || slide.lyricId === lyricId)).toBe(true);
    expect(itemSlideIds.has(`${theme.id}:slide`)).toBe(false);
    expect(itemSlideIds.has(`${overlay.id}:slide`)).toBe(false);
    expect(itemSlideIds.has(`${stage.id}:slide`)).toBe(false);

    // `slideElements` must agree: every element's `slideId` resolves to one
    // of those same item slide ids -- never a container's own slide id.
    expect(snapshot.slideElements.length).toBeGreaterThan(0);
    for (const element of snapshot.slideElements) {
      expect(itemSlideIds.has(element.slideId)).toBe(true);
    }
    expect(snapshot.slideElements.some((e) => e.slideId === `${theme.id}:slide`)).toBe(false);
    expect(snapshot.slideElements.some((e) => e.slideId === `${overlay.id}:slide`)).toBe(false);
    expect(snapshot.slideElements.some((e) => e.slideId === `${stage.id}:slide`)).toBe(false);

    // Container elements are still present in the snapshot -- surfaced
    // through their owner's `elements` field, exactly once, not through
    // `slideElements`.
    const persistedTheme = snapshot.presentationThemes.find((t) => t.id === theme.id)!;
    const persistedOverlay = snapshot.overlays.find((o) => o.id === overlay.id)!;
    const persistedStage = snapshot.stages.find((s) => s.id === stage.id)!;
    expect(persistedTheme.elements).toHaveLength(2);
    expect(persistedOverlay.elements).toHaveLength(1);
    expect(persistedStage.elements).toHaveLength(3);

    // The presentation's materialized theme elements and the lyric's default
    // text element are both item-owned and do appear in `slideElements`.
    const presentationSlide = snapshot.slides.find((s) => s.presentationId === presentationId)!;
    const lyricSlide = snapshot.slides.find((s) => s.lyricId === lyricId)!;
    expect(snapshot.slideElements.filter((e) => e.slideId === presentationSlide.id)).toHaveLength(2);
    expect(snapshot.slideElements.filter((e) => e.slideId === lyricSlide.id)).toHaveLength(1);
  });

  it('excludes container elements from getSlideElements() even when they outnumber item elements, across all four theme families', () => {
    // A repository with only container content (no items at all) must
    // report zero slides/slide elements from the item-scoped collections,
    // even though presentation/lyric/talk/overlay theme, overlay, and stage
    // elements all exist in the database.
    repo.createTheme({ name: 'PTheme', themeType: 'presentation', elements: [makeElement('pt-1'), makeElement('pt-2', 2)] });
    repo.createTheme({ name: 'LTheme', themeType: 'lyric', elements: [makeElement('lt-1')] });
    repo.createTheme({ name: 'TTheme', themeType: 'talk', elements: [makeElement('tt-1')] });
    repo.createTheme({ name: 'OTheme', themeType: 'overlay', elements: [makeElement('ot-1')] });
    repo.createOverlay({ name: 'Overlay', elements: [makeElement('o-1')] });
    repo.createStage({ name: 'Stage', elements: [makeElement('s-1'), makeElement('s-2', 2)] });

    const snapshot = repo.getSnapshot();
    expect(snapshot.slides).toHaveLength(0);
    expect(snapshot.slideElements).toHaveLength(0);
    // The container content itself is still there, just not through the
    // item-scoped collections.
    expect(snapshot.presentationThemes).toHaveLength(1);
    expect(snapshot.lyricThemes).toHaveLength(1);
    expect(snapshot.talkThemes).toHaveLength(1);
    expect(snapshot.overlayThemes).toHaveLength(1);
  });
});
