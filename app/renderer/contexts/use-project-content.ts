import { useMemo, useRef } from 'react';
import { getSlideDeckItemId } from '@core/deck-items';
import type { AppSnapshot, Collection, CollectionBinKind, DeckItem, Presentation, Id, Lyric, MediaAsset, Overlay, Slide, SlideElement, Stage, Theme } from '@core/types';
import { sortElements, sortSlides } from '../utils/slides';
import { useCast } from './app-context';

interface ProjectContent {
  presentations: Presentation[];
  lyrics: Lyric[];
  deckItems: DeckItem[];
  slides: Slide[];
  slideElements: SlideElement[];
  mediaAssets: MediaAsset[];
  overlays: Overlay[];
  themes: Theme[];
  stages: Stage[];
  collections: Collection[];
  deckItemsById: ReadonlyMap<Id, DeckItem>;
  slidesByDeckItemId: ReadonlyMap<Id, Slide[]>;
  slideElementsBySlideId: ReadonlyMap<Id, SlideElement[]>;
  mediaAssetsById: ReadonlyMap<Id, MediaAsset>;
  overlaysById: ReadonlyMap<Id, Overlay>;
  themesById: ReadonlyMap<Id, Theme>;
  stagesById: ReadonlyMap<Id, Stage>;
  collectionsByBinKind: ReadonlyMap<CollectionBinKind, Collection[]>;
  collectionsById: ReadonlyMap<Id, Collection>;
}

function stableArray<T extends { id: Id; updatedAt: string }>(prev: T[] | null, next: T[]): T[] {
  if (!prev || prev.length !== next.length) return next;
  for (let i = 0; i < next.length; i++) {
    if (prev[i].id !== next[i].id || prev[i].updatedAt !== next[i].updatedAt) return next;
  }
  return prev;
}

const projectContentCache = new WeakMap<AppSnapshot, ProjectContent>();

export function useProjectContent(): ProjectContent {
  const { snapshot } = useCast();

  const prevRef = useRef<{
    presentations: Presentation[];
    lyrics: Lyric[];
    slides: Slide[];
    slideElements: SlideElement[];
    mediaAssets: MediaAsset[];
    overlays: Overlay[];
    themes: Theme[];
    stages: Stage[];
    collections: Collection[];
  } | null>(null);

  const stableInputs = useMemo(() => {
    const raw = {
      presentations: snapshot?.presentations ?? [],
      lyrics: snapshot?.lyrics ?? [],
      slides: snapshot?.slides ?? [],
      slideElements: snapshot?.slideElements ?? [],
      mediaAssets: snapshot?.mediaAssets ?? [],
      overlays: snapshot?.overlays ?? [],
      themes: snapshot?.themes ?? [],
      stages: snapshot?.stages ?? [],
      collections: snapshot?.collections ?? [],
    };

    const prev = prevRef.current;
    const result = {
      presentations: stableArray(prev?.presentations ?? null, raw.presentations),
      lyrics: stableArray(prev?.lyrics ?? null, raw.lyrics),
      slides: stableArray(prev?.slides ?? null, raw.slides),
      slideElements: stableArray(prev?.slideElements ?? null, raw.slideElements),
      mediaAssets: stableArray(prev?.mediaAssets ?? null, raw.mediaAssets),
      overlays: stableArray(prev?.overlays ?? null, raw.overlays),
      themes: stableArray(prev?.themes ?? null, raw.themes),
      stages: stableArray(prev?.stages ?? null, raw.stages),
      collections: stableArray(prev?.collections ?? null, raw.collections),
    };
    prevRef.current = result;
    return result;
  }, [snapshot]);

  return useMemo(() => {
    const cacheKey = snapshot ?? null;
    if (cacheKey) {
      const cached = projectContentCache.get(cacheKey);
      if (cached) return cached;
    }

    const { presentations, lyrics, slides, slideElements, mediaAssets, overlays, themes, stages, collections } = stableInputs;

    const deckItems = [...presentations, ...lyrics].sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt));

    const deckItemsById = new Map<Id, DeckItem>();
    for (const item of deckItems) deckItemsById.set(item.id, item);

    const slidesByDeckItemId = new Map<Id, Slide[]>();
    for (const item of deckItems) slidesByDeckItemId.set(item.id, []);
    for (const slide of slides) {
      const itemId = getSlideDeckItemId(slide);
      if (!itemId) continue;
      const existing = slidesByDeckItemId.get(itemId) ?? [];
      existing.push(slide);
      slidesByDeckItemId.set(itemId, existing);
    }
    slidesByDeckItemId.forEach((contentSlides, itemId) => {
      slidesByDeckItemId.set(itemId, sortSlides(contentSlides));
    });

    const slideElementsBySlideId = new Map<Id, SlideElement[]>();
    for (const slide of slides) slideElementsBySlideId.set(slide.id, []);
    for (const element of slideElements) {
      const existing = slideElementsBySlideId.get(element.slideId) ?? [];
      existing.push(element);
      slideElementsBySlideId.set(element.slideId, existing);
    }
    slideElementsBySlideId.forEach((elements, slideId) => {
      slideElementsBySlideId.set(slideId, sortElements(elements));
    });

    const mediaAssetsById = new Map<Id, MediaAsset>();
    for (const asset of mediaAssets) mediaAssetsById.set(asset.id, asset);

    const overlaysById = new Map<Id, Overlay>();
    for (const overlay of overlays) overlaysById.set(overlay.id, overlay);

    const themesById = new Map<Id, Theme>();
    for (const theme of themes) themesById.set(theme.id, theme);

    const stagesById = new Map<Id, Stage>();
    for (const stage of stages) stagesById.set(stage.id, stage);

    const collectionsById = new Map<Id, Collection>();
    for (const collection of collections) collectionsById.set(collection.id, collection);

    const collectionsByBinKind = new Map<CollectionBinKind, Collection[]>();
    for (const bin of ['deck', 'image', 'video', 'audio', 'theme', 'overlay', 'stage'] as const) {
      collectionsByBinKind.set(bin, []);
    }
    for (const collection of collections) {
      const bucket = collectionsByBinKind.get(collection.binKind);
      if (bucket) bucket.push(collection);
    }
    collectionsByBinKind.forEach((list) => {
      list.sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
    });

    const content = {
      presentations,
      lyrics,
      deckItems,
      slides,
      slideElements,
      mediaAssets,
      overlays,
      themes,
      stages,
      collections,
      deckItemsById,
      slidesByDeckItemId,
      slideElementsBySlideId,
      mediaAssetsById,
      overlaysById,
      themesById,
      stagesById,
      collectionsByBinKind,
      collectionsById,
    } satisfies ProjectContent;

    if (cacheKey) {
      projectContentCache.set(cacheKey, content);
    }

    return content;
  }, [snapshot, stableInputs]);
}
