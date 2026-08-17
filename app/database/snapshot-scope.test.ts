import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SlideElement, SlideElementPayload } from '@core/types';
import { CastRepository } from './store';

// Covers #211: `getSlides()` deliberately scopes itself to deck-owned slides
// (presentation/lyric/talk) and documents that theme/overlay/stage container
// slides are surfaced through their owner's `elements` field instead.
// `getSlideElements()` used to disagree silently -- it returned every
// `slide_elements` row regardless of owner, so `AppSnapshot.slideElements`
// carried container elements that `AppSnapshot.slides` never carried a slide
// for. That mismatch produced #208 (restoreFromSnapshot inserting container
// elements into deck content slides) and #209 (a rollback test whose count
// included container elements it never created).
//
// This test pins the scope contract directly: `getSlides()` and
// `getSlideElements()` must agree on which slides are "in" the snapshot, for
// a repository holding deck items, a theme, an overlay, and a stage
// together, so a future change to either getter fails loudly here instead of
// resurfacing as a downstream defect.

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

  it('scopes both getters to the same deck-owned slide ids when themes, overlays, and stages are also present', () => {
    // Deck content: a themed presentation with an extra element, plus an
    // unthemed lyric.
    const theme = repo.createTheme({
      name: 'Theme',
      kind: 'slides',
      elements: [makeElement('theme-el-1'), makeElement('theme-el-2', 2)],
    }).upserts.themes![0];
    const { itemId: presentationId } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Deck', themeId: theme.id });
    const { itemId: lyricId } = repo.createDeckItemWithFirstSlide({ type: 'lyric', title: 'Song' });

    // Container content: an overlay and a stage, each with their own
    // elements, living on their own container slide.
    const overlay = repo.createOverlay({ name: 'Overlay', elements: [makeElement('overlay-el-1')] }).upserts.overlays![0];
    const stage = repo.createStage({ name: 'Stage', elements: [makeElement('stage-el-1'), makeElement('stage-el-2', 2), makeElement('stage-el-3', 3)] }).upserts.stages![0];

    const snapshot = repo.getSnapshot();

    // `slides` is deck-only: exactly the presentation's and lyric's slides,
    // never a `{container.id}:slide` row.
    const deckSlideIds = new Set(snapshot.slides.map((slide) => slide.id));
    expect(snapshot.slides.every((slide) => slide.presentationId === presentationId || slide.lyricId === lyricId)).toBe(true);
    expect(deckSlideIds.has(`${theme.id}:slide`)).toBe(false);
    expect(deckSlideIds.has(`${overlay.id}:slide`)).toBe(false);
    expect(deckSlideIds.has(`${stage.id}:slide`)).toBe(false);

    // `slideElements` must agree: every element's `slideId` resolves to one
    // of those same deck slide ids -- never a container's own slide id.
    expect(snapshot.slideElements.length).toBeGreaterThan(0);
    for (const element of snapshot.slideElements) {
      expect(deckSlideIds.has(element.slideId)).toBe(true);
    }
    expect(snapshot.slideElements.some((e) => e.slideId === `${theme.id}:slide`)).toBe(false);
    expect(snapshot.slideElements.some((e) => e.slideId === `${overlay.id}:slide`)).toBe(false);
    expect(snapshot.slideElements.some((e) => e.slideId === `${stage.id}:slide`)).toBe(false);

    // Container elements are still present in the snapshot -- surfaced
    // through their owner's `elements` field, exactly once, not through
    // `slideElements`.
    const persistedTheme = snapshot.themes.find((t) => t.id === theme.id)!;
    const persistedOverlay = snapshot.overlays.find((o) => o.id === overlay.id)!;
    const persistedStage = snapshot.stages.find((s) => s.id === stage.id)!;
    expect(persistedTheme.elements).toHaveLength(2);
    expect(persistedOverlay.elements).toHaveLength(1);
    expect(persistedStage.elements).toHaveLength(3);

    // The presentation's materialized theme element and the lyric's default
    // text element are both deck-owned and do appear in `slideElements`.
    const presentationSlide = snapshot.slides.find((s) => s.presentationId === presentationId)!;
    const lyricSlide = snapshot.slides.find((s) => s.lyricId === lyricId)!;
    expect(snapshot.slideElements.filter((e) => e.slideId === presentationSlide.id)).toHaveLength(2);
    expect(snapshot.slideElements.filter((e) => e.slideId === lyricSlide.id)).toHaveLength(1);
  });

  it('excludes container elements from getSlideElements() even when they outnumber deck elements', () => {
    // A repository with only container content (no deck items at all) must
    // report zero slide elements from the deck-scoped collection, even
    // though theme/overlay/stage elements exist in the database.
    repo.createTheme({ name: 'Theme', kind: 'slides', elements: [makeElement('t-1'), makeElement('t-2', 2)] });
    repo.createOverlay({ name: 'Overlay', elements: [makeElement('o-1')] });
    repo.createStage({ name: 'Stage', elements: [makeElement('s-1'), makeElement('s-2', 2)] });

    const snapshot = repo.getSnapshot();
    expect(snapshot.slides).toHaveLength(0);
    expect(snapshot.slideElements).toHaveLength(0);
  });
});
