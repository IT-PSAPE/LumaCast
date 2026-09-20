import { createContext, useContext, useMemo, useRef } from 'react';
import { getSlideItemRef, resolveLinkedSlideBackground, resolveLinkedSlideElements } from '@lumacast/composition';
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
  SlideBackground,
  SlideElement,
  SlideTag,
  Stage,
  ThemeOwnerType,
  Timer,
} from '@lumacast/composition';
import type { Cue, Macro, TriggerBinding } from '@lumacast/automation';
import type { AppSnapshot } from '@lumacast/protocol';
import { sortElements, sortSlides } from '../utils/slides';
import { useCast } from './app-context';

// #219 item-model refactor decision D9: no merged `deckItems` array and no
// merged `themesById` — presentations and lyrics stay independent arrays/maps,
// as do their theme families. `resolveItemRef`/`slidesForItemRef` are the only
// helpers this hub offers for resolving one of the two item types.

/** Canonical key for an `ItemRef`-keyed map — see `slidesByItem` below. */
export function itemRefKey(ref: ItemRef): string {
  return `${ref.type}:${ref.id}`;
}

// ── Theme draft projection port ──────────────────────────────────────────
//
// The theme editor stages drafts locally and only persists on leave/push, but
// live linked slides must reflect drafts immediately. The staged drafts live
// in `AssetEditorProvider` (below), while this hub is consumed above and
// below it — so the drafts travel through this port instead of a direct
// import (which would be a circular provider dependency): the asset editor
// publishes staged families here, and the live-resolved maps below overlay
// them onto the persisted themes. `null` (above the provider, or no staged
// buffer) means "persisted themes only".
export interface ThemeDraftOverride {
  id: Id;
  elements: SlideElement[];
  background?: SlideBackground | null;
  updatedAt: string;
}

export type ThemeDraftProjection = Record<ThemeOwnerType, ReadonlyMap<Id, ThemeDraftOverride> | null>;

export const ThemeDraftProjectionContext = createContext<ThemeDraftProjection | null>(null);

export function useThemeDraftProjection(): ThemeDraftProjection | null {
  return useContext(ThemeDraftProjectionContext);
}

interface ProjectContent {
  presentations: Presentation[];
  lyrics: Lyric[];
  slides: Slide[];
  slideTags: SlideTag[];
  slideElements: SlideElement[];
  mediaAssets: MediaAsset[];
  overlays: Overlay[];
  /** Global named timers (ADR-0042), in their persisted `order`. */
  timers: Timer[];
  presentationThemes: PresentationTheme[];
  lyricThemes: LyricTheme[];
  overlayThemes: OverlayTheme[];
  stages: Stage[];
  cues: Cue[];
  macros: Macro[];
  triggerBindings: TriggerBinding[];
  /** Playlists in their persisted order — the show view's playlist panel order. */
  playlists: Playlist[];
  presentationsById: ReadonlyMap<Id, Presentation>;
  lyricsById: ReadonlyMap<Id, Lyric>;
  slidesByItem: ReadonlyMap<string, Slide[]>;
  slideElementsBySlideId: ReadonlyMap<Id, SlideElement[]>;
  slideTagsById: ReadonlyMap<Id, SlideTag>;
  timersById: ReadonlyMap<Id, Timer>;
  /**
   * Live inherited-theme resolution of `slideElementsBySlideId`: linked
   * presentation and lyric slides resolve current theme styling — backed
   * by persisted themes overlaid with staged theme-editor drafts — while
   * explicit local overrides and authored content survive. Unlinked slides
   * share the raw array reference. Editing/diff paths must keep using the
   * raw `slideElementsBySlideId`.
   */
  liveSlideElementsBySlideId: ReadonlyMap<Id, SlideElement[]>;
  /** Live background resolution for linked slides (`backgroundSource === 'theme'` follows the theme). */
  liveSlidesById: ReadonlyMap<Id, Slide>;
  mediaAssetsById: ReadonlyMap<Id, MediaAsset>;
  overlaysById: ReadonlyMap<Id, Overlay>;
  presentationThemesById: ReadonlyMap<Id, PresentationTheme>;
  lyricThemesById: ReadonlyMap<Id, LyricTheme>;
  overlayThemesById: ReadonlyMap<Id, OverlayTheme>;
  stagesById: ReadonlyMap<Id, Stage>;
  cuesById: ReadonlyMap<Id, Cue>;
  macrosById: ReadonlyMap<Id, Macro>;
  /** Resolves a typed reference to its owning entity. */
  resolveItemRef: (ref: ItemRef | null | undefined) => Presentation | Lyric | null;
  /** Slides owned by one item, looked up by typed reference. */
  slidesForItemRef: (ref: ItemRef | null | undefined) => Slide[];
  /**
   * Resolves arbitrary (e.g. staged) elements for one slide against its
   * effective theme. Returns the input reference for unlinked slides and
   * reuses the previous output when neither the input nor the theme changed,
   * so editing surfaces can resolve per render without cache churn.
   */
  resolveElementsForSlide: (slideId: Id, elements: SlideElement[]) => SlideElement[];
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

function stableMediaAssets(prev: MediaAsset[] | null, next: MediaAsset[]): MediaAsset[] {
  if (!prev || prev.length !== next.length) return next;
  for (let i = 0; i < next.length; i++) {
    if (
      prev[i].id !== next[i].id
      || prev[i].updatedAt !== next[i].updatedAt
      || prev[i].thumbnailSrc !== next[i].thumbnailSrc
    ) return next;
  }
  return prev;
}

interface ThemeLookup {
  presentationsById: ReadonlyMap<Id, Presentation>;
  lyricsById: ReadonlyMap<Id, Lyric>;
  presentationThemesById: ReadonlyMap<Id, PresentationTheme>;
  lyricThemesById: ReadonlyMap<Id, LyricTheme>;
}

/**
 * The theme a linked slide inherits from: the item's `themeId` resolved
 * through the staged draft projection first, then the persisted family map.
 * Overlays/stages/theme slides and items without a `themeId` yield null.
 */
function effectiveThemeForSlide(
  slide: Slide,
  lookup: ThemeLookup,
  projection: ThemeDraftProjection | null,
): { elements: SlideElement[]; background?: SlideBackground | null; updatedAt: string } | null {
  const ref = getSlideItemRef(slide);
  if (!ref) return null;
  const item = ref.type === 'presentation'
    ? lookup.presentationsById.get(ref.id)
    : lookup.lyricsById.get(ref.id);
  const themeId = item?.themeId;
  if (!themeId) return null;
  const draft = projection?.[ref.type]?.get(themeId);
  if (draft) return draft;
  const persisted = ref.type === 'presentation'
    ? lookup.presentationThemesById.get(themeId)
    : lookup.lyricThemesById.get(themeId);
  return persisted ?? null;
}

function runtimeBlankSlide(lyric: Lyric, position: 'start' | 'end', theme: LyricTheme | undefined): Slide {
  return {
    id: `runtime:lyric:${lyric.id}:blank:${position}`,
    background: theme?.background ?? null,
    backgroundSource: theme ? 'theme' : 'local',
    presentationId: null,
    lyricId: lyric.id,
    presentationThemeId: null,
    lyricThemeId: null,
    overlayThemeId: null,
    overlayId: null,
    stageId: null,
    kind: 'lyric',
    width: theme?.width ?? 1920,
    height: theme?.height ?? 1080,
    notes: '',
    order: position === 'start' ? -1 : Number.MAX_SAFE_INTEGER,
    createdAt: lyric.createdAt,
    updatedAt: lyric.updatedAt,
    runtimeBlank: position,
  };
}

function withoutTextElements(elements: SlideElement[]): SlideElement[] {
  return elements.flatMap((element) => {
    if (element.type === 'text') return [];
    if (element.type !== 'group' || !('children' in element.payload)) {
      return [{ ...element, payload: { ...element.payload, locked: true } }];
    }
    return [{
      ...element,
      payload: { ...element.payload, locked: true, children: withoutTextElements(element.payload.children) },
    }];
  });
}

const projectContentCache = new WeakMap<AppSnapshot, ProjectContent>();
const projectedContentCache = new WeakMap<AppSnapshot, WeakMap<ThemeDraftProjection, ProjectContent>>();

export function useProjectContent(): ProjectContent {
  const { snapshot } = useCast();
  const themeDraftProjection = useThemeDraftProjection();
  // Per-slide stabilization for the live-resolved maps: a theme draft
  // keystroke must only swap the array/slide references whose resolved
  // output actually changed, never the whole project.
  const prevLiveRef = useRef<{
    elements: Map<Id, { sig: string; arr: SlideElement[] }>;
    slides: Map<Id, { sig: string; slide: Slide }>;
  }>({ elements: new Map(), slides: new Map() });
  const adhocResolveRef = useRef<Map<Id, { input: SlideElement[]; theme: object; arr: SlideElement[] }>>(new Map());

  const prevRef = useRef<{
    presentations: Presentation[];
    lyrics: Lyric[];
    slides: Slide[];
    slideTags: SlideTag[];
    slideElements: SlideElement[];
    mediaAssets: MediaAsset[];
    overlays: Overlay[];
    presentationThemes: PresentationTheme[];
    lyricThemes: LyricTheme[];
    overlayThemes: OverlayTheme[];
    stages: Stage[];
    cues: Cue[];
    macros: Macro[];
    triggerBindings: TriggerBinding[];
    playlists: Playlist[];
    timers: Timer[];
  } | null>(null);

  const stableInputs = useMemo(() => {
    const raw = {
      presentations: snapshot?.presentations ?? [],
      lyrics: snapshot?.lyrics ?? [],
      slides: snapshot?.slides ?? [],
      slideTags: sortByOrder(snapshot?.slideTags ?? []),
      slideElements: snapshot?.slideElements ?? [],
      mediaAssets: snapshot?.mediaAssets ?? [],
      overlays: sortByOrder(snapshot?.overlays ?? []),
      presentationThemes: sortByOrder(snapshot?.presentationThemes ?? []),
      lyricThemes: sortByOrder(snapshot?.lyricThemes ?? []),
      overlayThemes: sortByOrder(snapshot?.overlayThemes ?? []),
      stages: sortByOrder(snapshot?.stages ?? []),
      cues: snapshot?.cues ?? [],
      macros: sortByOrder(snapshot?.macros ?? []),
      triggerBindings: snapshot?.triggerBindings ?? [],
      playlists: sortByOrder(snapshot?.playlists ?? []),
      timers: sortByOrder(snapshot?.timers ?? []),
    };

    const prev = prevRef.current;
    const result = {
      presentations: stableArray(prev?.presentations ?? null, raw.presentations),
      lyrics: stableArray(prev?.lyrics ?? null, raw.lyrics),
      slides: stableArray(prev?.slides ?? null, raw.slides),
      slideTags: stableArray(prev?.slideTags ?? null, raw.slideTags),
      slideElements: stableArray(prev?.slideElements ?? null, raw.slideElements),
      mediaAssets: stableMediaAssets(prev?.mediaAssets ?? null, raw.mediaAssets),
      overlays: stableArray(prev?.overlays ?? null, raw.overlays),
      presentationThemes: stableArray(prev?.presentationThemes ?? null, raw.presentationThemes),
      lyricThemes: stableArray(prev?.lyricThemes ?? null, raw.lyricThemes),
      overlayThemes: stableArray(prev?.overlayThemes ?? null, raw.overlayThemes),
      stages: stableArray(prev?.stages ?? null, raw.stages),
      cues: stableArray(prev?.cues ?? null, raw.cues),
      macros: stableArray(prev?.macros ?? null, raw.macros),
      triggerBindings: stableArray(prev?.triggerBindings ?? null, raw.triggerBindings),
      playlists: stableArray(prev?.playlists ?? null, raw.playlists),
      timers: stableArray(prev?.timers ?? null, raw.timers),
    };
    prevRef.current = result;
    return result;
  }, [snapshot]);

  return useMemo(() => {
    const cacheKey = snapshot ?? null;
    if (cacheKey) {
      const cached = themeDraftProjection
        ? projectedContentCache.get(cacheKey)?.get(themeDraftProjection)
        : projectContentCache.get(cacheKey);
      if (cached) return cached;
    }

    const {
      presentations, lyrics, slides, slideTags, slideElements, mediaAssets, overlays,
      presentationThemes, lyricThemes, overlayThemes, stages, cues, macros, triggerBindings,
      playlists, timers,
    } = stableInputs;

    const presentationsById = new Map<Id, Presentation>();
    for (const item of presentations) presentationsById.set(item.id, item);

    const lyricsById = new Map<Id, Lyric>();
    for (const item of lyrics) lyricsById.set(item.id, item);

    const slidesByItem = new Map<string, Slide[]>();
    for (const item of presentations) slidesByItem.set(itemRefKey({ type: 'presentation', id: item.id }), []);
    for (const item of lyrics) slidesByItem.set(itemRefKey({ type: 'lyric', id: item.id }), []);
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
    const projectedSlides = [...slides];
    for (const lyric of lyrics) {
      const mode = lyric.blankSlideMode ?? 'none';
      if (mode === 'none') continue;
      const key = itemRefKey({ type: 'lyric', id: lyric.id });
      const contentSlides = slidesByItem.get(key) ?? [];
      const theme = lyric.themeId ? lyricThemes.find((candidate) => candidate.id === lyric.themeId) : undefined;
      if (mode === 'start' || mode === 'both') {
        const blank = runtimeBlankSlide(lyric, 'start', theme);
        contentSlides.unshift(blank);
        projectedSlides.push(blank);
      }
      if (mode === 'end' || mode === 'both') {
        const blank = runtimeBlankSlide(lyric, 'end', theme);
        contentSlides.push(blank);
        projectedSlides.push(blank);
      }
      slidesByItem.set(key, contentSlides);
    }

    const slideElementsBySlideId = new Map<Id, SlideElement[]>();
    for (const slide of projectedSlides) slideElementsBySlideId.set(slide.id, []);
    for (const element of slideElements) {
      const existing = slideElementsBySlideId.get(element.slideId) ?? [];
      existing.push(element);
      slideElementsBySlideId.set(element.slideId, existing);
    }
    slideElementsBySlideId.forEach((elements, slideId) => {
      slideElementsBySlideId.set(slideId, sortElements(elements));
    });

    const slideTagsById = new Map<Id, SlideTag>();
    for (const tag of slideTags) slideTagsById.set(tag.id, tag);

    const timersById = new Map<Id, Timer>();
    for (const timer of timers) timersById.set(timer.id, timer);

    const mediaAssetsById = new Map<Id, MediaAsset>();
    for (const asset of mediaAssets) mediaAssetsById.set(asset.id, asset);

    const overlaysById = new Map<Id, Overlay>();
    for (const overlay of overlays) overlaysById.set(overlay.id, overlay);

    const presentationThemesById = new Map<Id, PresentationTheme>();
    for (const theme of presentationThemes) presentationThemesById.set(theme.id, theme);

    const lyricThemesById = new Map<Id, LyricTheme>();
    for (const theme of lyricThemes) lyricThemesById.set(theme.id, theme);

    const overlayThemesById = new Map<Id, OverlayTheme>();
    for (const theme of overlayThemes) overlayThemesById.set(theme.id, theme);

    const stagesById = new Map<Id, Stage>();
    for (const stage of stages) stagesById.set(stage.id, stage);

    const cuesById = new Map<Id, Cue>();
    for (const cue of cues) cuesById.set(cue.id, cue);

    const macrosById = new Map<Id, Macro>();
    for (const macro of macros) macrosById.set(macro.id, macro);

    const themeLookup: ThemeLookup = {
      presentationsById,
      lyricsById,
      presentationThemesById,
      lyricThemesById,
    };
    const slidesById = new Map<Id, Slide>();
    for (const slide of projectedSlides) slidesById.set(slide.id, slide);
    const resolveElementsForSlide = (slideId: Id, elements: SlideElement[]): SlideElement[] => {
      const slide = slidesById.get(slideId);
      if (!slide) return elements;
      const theme = effectiveThemeForSlide(slide, themeLookup, themeDraftProjection);
      if (!theme) return elements;
      const prev = adhocResolveRef.current.get(slideId);
      if (prev && prev.input === elements && prev.theme === theme) return prev.arr;
      const resolved = resolveLinkedSlideElements(theme, slideId, elements);
      const arr = slide.runtimeBlank ? withoutTextElements(resolved) : resolved;
      adhocResolveRef.current.set(slideId, { input: elements, theme, arr });
      return arr;
    };
    const prevLive = prevLiveRef.current;
    const liveSlideElementsBySlideId = new Map<Id, SlideElement[]>();
    const liveSlidesById = new Map<Id, Slide>();
    for (const slide of projectedSlides) {
      const rawElements = slideElementsBySlideId.get(slide.id) ?? [];
      const theme = effectiveThemeForSlide(slide, themeLookup, themeDraftProjection);
      if (!theme) {
        liveSlideElementsBySlideId.set(slide.id, rawElements);
        liveSlidesById.set(slide.id, slide);
        continue;
      }
      const resolved = resolveLinkedSlideElements(theme, slide.id, rawElements);
      const resolvedElements = slide.runtimeBlank ? withoutTextElements(resolved) : resolved;
      const elementsSig = JSON.stringify(resolvedElements);
      const prevElements = prevLive.elements.get(slide.id);
      const liveElements = prevElements && prevElements.sig === elementsSig ? prevElements.arr : resolvedElements;
      prevLive.elements.set(slide.id, { sig: elementsSig, arr: liveElements });
      liveSlideElementsBySlideId.set(slide.id, liveElements);

      const liveBackground = resolveLinkedSlideBackground(theme.background, slide.background, slide.backgroundSource);
      const liveSlide: Slide = liveBackground === slide.background ? slide : { ...slide, background: liveBackground };
      const slideSig = JSON.stringify(liveSlide);
      const prevSlide = prevLive.slides.get(slide.id);
      const stableSlide = prevSlide && prevSlide.sig === slideSig ? prevSlide.slide : liveSlide;
      prevLive.slides.set(slide.id, { sig: slideSig, slide: stableSlide });
      liveSlidesById.set(slide.id, stableSlide);
    }
    for (const id of [...prevLive.elements.keys()]) {
      if (!slideElementsBySlideId.has(id)) prevLive.elements.delete(id);
    }
    for (const id of [...prevLive.slides.keys()]) {
      if (!slideElementsBySlideId.has(id)) prevLive.slides.delete(id);
    }
    for (const id of [...adhocResolveRef.current.keys()]) {
      if (!slideElementsBySlideId.has(id)) adhocResolveRef.current.delete(id);
    }

    const resolveItemRef = (ref: ItemRef | null | undefined): Presentation | Lyric | null => {
      if (!ref) return null;
      if (ref.type === 'presentation') return presentationsById.get(ref.id) ?? null;
      return lyricsById.get(ref.id) ?? null;
    };

    const slidesForItemRef = (ref: ItemRef | null | undefined): Slide[] => {
      if (!ref) return [];
      return slidesByItem.get(itemRefKey(ref)) ?? [];
    };

    const content = {
      presentations,
      lyrics,
      slides,
      slideTags,
      slideElements,
      mediaAssets,
      overlays,
      presentationThemes,
      lyricThemes,
      overlayThemes,
      stages,
      cues,
      macros,
      triggerBindings,
      playlists,
      timers,
      presentationsById,
      lyricsById,
      slidesByItem,
      slideElementsBySlideId,
      slideTagsById,
      timersById,
      liveSlideElementsBySlideId,
      liveSlidesById,
      mediaAssetsById,
      overlaysById,
      presentationThemesById,
      lyricThemesById,
      overlayThemesById,
      stagesById,
      cuesById,
      macrosById,
      resolveItemRef,
      slidesForItemRef,
      resolveElementsForSlide,
    } satisfies ProjectContent;

    if (cacheKey) {
      if (themeDraftProjection) {
        let projections = projectedContentCache.get(cacheKey);
        if (!projections) { projections = new WeakMap(); projectedContentCache.set(cacheKey, projections); }
        projections.set(themeDraftProjection, content);
      } else projectContentCache.set(cacheKey, content);
    }

    return content;
  }, [snapshot, stableInputs, themeDraftProjection]);
}
