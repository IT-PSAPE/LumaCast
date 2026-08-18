import { useMemo, useRef } from 'react';
import { getSlideItemRef } from '@lumacast/composition';
import type { Id } from '@lumacast/kernel';
import type {
  ItemRef,
  Lyric,
  LyricTheme,
  MediaAsset,
  Overlay,
  OverlayTheme,
  Playlist,
  Presentation,
  PresentationTheme,
  Slide,
  SlideElement,
  Stage,
  Talk,
  TalkTheme,
  TalkScriptBlock,
} from '@lumacast/composition';
import type { Cue, Macro, TriggerBinding } from '@lumacast/automation';
import type { AppSnapshot } from '@lumacast/protocol';
import { sortElements, sortSlides } from '../utils/slides';
import { useCast } from './app-context';

// #219 item-model refactor decision D9: no merged `deckItems` array and no
// merged `themesById` — Presentation/Lyric/Talk stay three independent
// arrays/maps, and the four theme families stay four independent
// arrays/maps. `resolveItemRef`/`slidesForItemRef` are the only "resolve one
// of the three" helpers this hub offers; nothing here reconstructs a union.

/** Canonical key for an `ItemRef`-keyed map — see `slidesByItem` below. */
export function itemRefKey(ref: ItemRef): string {
  return `${ref.type}:${ref.id}`;
}

interface ProjectContent {
  presentations: Presentation[];
  lyrics: Lyric[];
  talks: Talk[];
  slides: Slide[];
  talkScriptBlocks: TalkScriptBlock[];
  slideElements: SlideElement[];
  mediaAssets: MediaAsset[];
  overlays: Overlay[];
  presentationThemes: PresentationTheme[];
  lyricThemes: LyricTheme[];
  talkThemes: TalkTheme[];
  overlayThemes: OverlayTheme[];
  stages: Stage[];
  cues: Cue[];
  macros: Macro[];
  triggerBindings: TriggerBinding[];
  /** Playlists in their persisted order — the show view's playlist panel order. */
  playlists: Playlist[];
  presentationsById: ReadonlyMap<Id, Presentation>;
  lyricsById: ReadonlyMap<Id, Lyric>;
  talksById: ReadonlyMap<Id, Talk>;
  slidesByItem: ReadonlyMap<string, Slide[]>;
  talkScriptBlocksBySlideId: ReadonlyMap<Id, TalkScriptBlock[]>;
  slideElementsBySlideId: ReadonlyMap<Id, SlideElement[]>;
  mediaAssetsById: ReadonlyMap<Id, MediaAsset>;
  overlaysById: ReadonlyMap<Id, Overlay>;
  presentationThemesById: ReadonlyMap<Id, PresentationTheme>;
  lyricThemesById: ReadonlyMap<Id, LyricTheme>;
  talkThemesById: ReadonlyMap<Id, TalkTheme>;
  overlayThemesById: ReadonlyMap<Id, OverlayTheme>;
  stagesById: ReadonlyMap<Id, Stage>;
  cuesById: ReadonlyMap<Id, Cue>;
  macrosById: ReadonlyMap<Id, Macro>;
  /** Resolves a typed reference to its owning entity, across all three item tables. */
  resolveItemRef: (ref: ItemRef | null | undefined) => Presentation | Lyric | Talk | null;
  /** Slides owned by one item, looked up by typed reference. */
  slidesForItemRef: (ref: ItemRef | null | undefined) => Slide[];
}

/**
 * Puts a snapshot table in its persisted list order. `applyPatch` merges
 * upserts positionally — a row keeps the array slot it already had — so a
 * reorder patch changes each record's `order` without moving anything in the
 * array. Every consumer of an orderable table therefore has to sort, and doing
 * it here means the whole app sees one order (and the same array identity).
 */
function sortByOrder<T extends { id: Id; order: number; createdAt: string }>(rows: T[]): T[] {
  return rows
    .slice()
    .sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
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
    presentationThemes: PresentationTheme[];
    lyricThemes: LyricTheme[];
    talkThemes: TalkTheme[];
    overlayThemes: OverlayTheme[];
    stages: Stage[];
    cues: Cue[];
    macros: Macro[];
    triggerBindings: TriggerBinding[];
    playlists: Playlist[];
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
      overlays: sortByOrder(snapshot?.overlays ?? []),
      presentationThemes: sortByOrder(snapshot?.presentationThemes ?? []),
      lyricThemes: sortByOrder(snapshot?.lyricThemes ?? []),
      talkThemes: sortByOrder(snapshot?.talkThemes ?? []),
      overlayThemes: sortByOrder(snapshot?.overlayThemes ?? []),
      stages: sortByOrder(snapshot?.stages ?? []),
      cues: snapshot?.cues ?? [],
      macros: sortByOrder(snapshot?.macros ?? []),
      triggerBindings: snapshot?.triggerBindings ?? [],
      playlists: sortByOrder(snapshot?.playlists ?? []),
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
      presentationThemes: stableArray(prev?.presentationThemes ?? null, raw.presentationThemes),
      lyricThemes: stableArray(prev?.lyricThemes ?? null, raw.lyricThemes),
      talkThemes: stableArray(prev?.talkThemes ?? null, raw.talkThemes),
      overlayThemes: stableArray(prev?.overlayThemes ?? null, raw.overlayThemes),
      stages: stableArray(prev?.stages ?? null, raw.stages),
      cues: stableArray(prev?.cues ?? null, raw.cues),
      macros: stableArray(prev?.macros ?? null, raw.macros),
      triggerBindings: stableArray(prev?.triggerBindings ?? null, raw.triggerBindings),
      playlists: stableArray(prev?.playlists ?? null, raw.playlists),
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

    const {
      presentations, lyrics, talks, slides, talkScriptBlocks, slideElements, mediaAssets, overlays,
      presentationThemes, lyricThemes, talkThemes, overlayThemes, stages, cues, macros, triggerBindings,
      playlists,
    } = stableInputs;

    const presentationsById = new Map<Id, Presentation>();
    for (const item of presentations) presentationsById.set(item.id, item);

    const lyricsById = new Map<Id, Lyric>();
    for (const item of lyrics) lyricsById.set(item.id, item);

    const talksById = new Map<Id, Talk>();
    for (const item of talks) talksById.set(item.id, item);

    const slidesByItem = new Map<string, Slide[]>();
    for (const item of presentations) slidesByItem.set(itemRefKey({ type: 'presentation', id: item.id }), []);
    for (const item of lyrics) slidesByItem.set(itemRefKey({ type: 'lyric', id: item.id }), []);
    for (const item of talks) slidesByItem.set(itemRefKey({ type: 'talk', id: item.id }), []);
    for (const slide of slides) {
      const ref = getSlideItemRef(slide);
      if (!ref) continue;
      const key = itemRefKey(ref);
      const existing = slidesByItem.get(key) ?? [];
      existing.push(slide);
      slidesByItem.set(key, existing);
    }
    slidesByItem.forEach((contentSlides, key) => {
      slidesByItem.set(key, sortSlides(contentSlides));
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

    const presentationThemesById = new Map<Id, PresentationTheme>();
    for (const theme of presentationThemes) presentationThemesById.set(theme.id, theme);

    const lyricThemesById = new Map<Id, LyricTheme>();
    for (const theme of lyricThemes) lyricThemesById.set(theme.id, theme);

    const talkThemesById = new Map<Id, TalkTheme>();
    for (const theme of talkThemes) talkThemesById.set(theme.id, theme);

    const overlayThemesById = new Map<Id, OverlayTheme>();
    for (const theme of overlayThemes) overlayThemesById.set(theme.id, theme);

    const stagesById = new Map<Id, Stage>();
    for (const stage of stages) stagesById.set(stage.id, stage);

    const cuesById = new Map<Id, Cue>();
    for (const cue of cues) cuesById.set(cue.id, cue);

    const macrosById = new Map<Id, Macro>();
    for (const macro of macros) macrosById.set(macro.id, macro);

    const resolveItemRef = (ref: ItemRef | null | undefined): Presentation | Lyric | Talk | null => {
      if (!ref) return null;
      if (ref.type === 'presentation') return presentationsById.get(ref.id) ?? null;
      if (ref.type === 'lyric') return lyricsById.get(ref.id) ?? null;
      return talksById.get(ref.id) ?? null;
    };

    const slidesForItemRef = (ref: ItemRef | null | undefined): Slide[] => {
      if (!ref) return [];
      return slidesByItem.get(itemRefKey(ref)) ?? [];
    };

    const content = {
      presentations,
      lyrics,
      talks,
      slides,
      talkScriptBlocks,
      slideElements,
      mediaAssets,
      overlays,
      presentationThemes,
      lyricThemes,
      talkThemes,
      overlayThemes,
      stages,
      cues,
      macros,
      triggerBindings,
      playlists,
      presentationsById,
      lyricsById,
      talksById,
      slidesByItem,
      talkScriptBlocksBySlideId,
      slideElementsBySlideId,
      mediaAssetsById,
      overlaysById,
      presentationThemesById,
      lyricThemesById,
      talkThemesById,
      overlayThemesById,
      stagesById,
      cuesById,
      macrosById,
      resolveItemRef,
      slidesForItemRef,
    } satisfies ProjectContent;

    if (cacheKey) {
      projectContentCache.set(cacheKey, content);
    }

    return content;
  }, [snapshot, stableInputs]);
}
