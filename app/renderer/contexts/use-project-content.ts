import { useMemo, useRef } from 'react';
import { getSlideDeckItemId } from '@core/deck-items';
import type { AppSnapshot, Collection, CollectionBinKind, Cue, DeckItem, Presentation, Id, Lyric, Macro, MediaAsset, Overlay, Slide, SlideElement, Stage, Talk, TalkScriptBlock, Theme, TriggerBinding } from '@core/types';
import { sortElements, sortSlides } from '../utils/slides';
import { useCast } from './app-context';

interface ProjectContent {
  presentations: Presentation[];
  lyrics: Lyric[];
  talks: Talk[];
  deckItems: DeckItem[];
  slides: Slide[];
  talkScriptBlocks: TalkScriptBlock[];
  slideElements: SlideElement[];
  mediaAssets: MediaAsset[];
  overlays: Overlay[];
  themes: Theme[];
  stages: Stage[];
  collections: Collection[];
  cues: Cue[];
  macros: Macro[];
  triggerBindings: TriggerBinding[];
  deckItemsById: ReadonlyMap<Id, DeckItem>;
  slidesByDeckItemId: ReadonlyMap<Id, Slide[]>;
  talkScriptBlocksBySlideId: ReadonlyMap<Id, TalkScriptBlock[]>;
  slideElementsBySlideId: ReadonlyMap<Id, SlideElement[]>;
  mediaAssetsById: ReadonlyMap<Id, MediaAsset>;
  overlaysById: ReadonlyMap<Id, Overlay>;
  themesById: ReadonlyMap<Id, Theme>;
  stagesById: ReadonlyMap<Id, Stage>;
  collectionsByBinKind: ReadonlyMap<CollectionBinKind, Collection[]>;
  collectionsById: ReadonlyMap<Id, Collection>;
  cuesById: ReadonlyMap<Id, Cue>;
  macrosById: ReadonlyMap<Id, Macro>;
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
    talks: Talk[];
    slides: Slide[];
    talkScriptBlocks: TalkScriptBlock[];
    slideElements: SlideElement[];
    mediaAssets: MediaAsset[];
    overlays: Overlay[];
    themes: Theme[];
    stages: Stage[];
    collections: Collection[];
    cues: Cue[];
    macros: Macro[];
    triggerBindings: TriggerBinding[];
  } | null>(null);

  const stableInputs = useMemo(() => {
    const raw = {
      presentations: snapshot?.presentations ?? [],
      lyrics: snapshot?.lyrics ?? [],
      talks: snapshot?.talks ?? [],
      slides: snapshot?.slides ?? [],
      talkScriptBlocks: snapshot?.talkScriptBlocks ?? [],
      slideElements: snapshot?.slideElements ?? [],
      mediaAssets: snapshot?.mediaAssets ?? [],
      overlays: snapshot?.overlays ?? [],
      themes: snapshot?.themes ?? [],
      stages: snapshot?.stages ?? [],
      collections: snapshot?.collections ?? [],
      cues: snapshot?.cues ?? [],
      macros: snapshot?.macros ?? [],
      triggerBindings: snapshot?.triggerBindings ?? [],
    };

    const prev = prevRef.current;
    const result = {
      presentations: stableArray(prev?.presentations ?? null, raw.presentations),
      lyrics: stableArray(prev?.lyrics ?? null, raw.lyrics),
      talks: stableArray(prev?.talks ?? null, raw.talks),
      slides: stableArray(prev?.slides ?? null, raw.slides),
      talkScriptBlocks: stableArray(prev?.talkScriptBlocks ?? null, raw.talkScriptBlocks),
      slideElements: stableArray(prev?.slideElements ?? null, raw.slideElements),
      mediaAssets: stableArray(prev?.mediaAssets ?? null, raw.mediaAssets),
      overlays: stableArray(prev?.overlays ?? null, raw.overlays),
      themes: stableArray(prev?.themes ?? null, raw.themes),
      stages: stableArray(prev?.stages ?? null, raw.stages),
      collections: stableArray(prev?.collections ?? null, raw.collections),
      cues: stableArray(prev?.cues ?? null, raw.cues),
      macros: stableArray(prev?.macros ?? null, raw.macros),
      triggerBindings: stableArray(prev?.triggerBindings ?? null, raw.triggerBindings),
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

    const { presentations, lyrics, talks, slides, talkScriptBlocks, slideElements, mediaAssets, overlays, themes, stages, collections, cues, macros, triggerBindings } = stableInputs;

    const deckItems = [...presentations, ...lyrics, ...talks].sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt));

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

    const talkScriptBlocksBySlideId = new Map<Id, TalkScriptBlock[]>();
    for (const slide of slides) talkScriptBlocksBySlideId.set(slide.id, []);
    for (const block of talkScriptBlocks) {
      const existing = talkScriptBlocksBySlideId.get(block.slideId) ?? [];
      existing.push(block);
      talkScriptBlocksBySlideId.set(block.slideId, existing);
    }
    talkScriptBlocksBySlideId.forEach((blocks, slideId) => {
      talkScriptBlocksBySlideId.set(slideId, [...blocks].sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt)));
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
    for (const bin of ['deck', 'image', 'video', 'audio', 'theme', 'overlay', 'stage', 'macro'] as const) {
      collectionsByBinKind.set(bin, []);
    }
    for (const collection of collections) {
      const bucket = collectionsByBinKind.get(collection.binKind);
      if (bucket) bucket.push(collection);
    }
    collectionsByBinKind.forEach((list) => {
      list.sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
    });

    const cuesById = new Map<Id, Cue>();
    for (const cue of cues) cuesById.set(cue.id, cue);

    const macrosById = new Map<Id, Macro>();
    for (const macro of macros) macrosById.set(macro.id, macro);

    const content = {
      presentations,
      lyrics,
      talks,
      deckItems,
      slides,
      talkScriptBlocks,
      slideElements,
      mediaAssets,
      overlays,
      themes,
      stages,
      collections,
      cues,
      macros,
      triggerBindings,
      deckItemsById,
      slidesByDeckItemId,
      talkScriptBlocksBySlideId,
      slideElementsBySlideId,
      mediaAssetsById,
      overlaysById,
      themesById,
      stagesById,
      collectionsByBinKind,
      collectionsById,
      cuesById,
      macrosById,
    } satisfies ProjectContent;

    if (cacheKey) {
      projectContentCache.set(cacheKey, content);
    }

    return content;
  }, [snapshot, stableInputs]);
}
