import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { OverlayAnimation } from '@core/types';
import type { DrawerTab, DrawerViewModeMap, InspectorTab, LibraryPanelView, PlaylistBrowserMode, ProgramGridDensity, ProgramMode, ProgramSurfaceKind, ResourceDrawerViewMode, SlideBrowserMode, WorkbenchMode } from '../types/ui';
import { useGridSize } from '../hooks/use-grid-size';
import { useLocalStorage } from '../hooks/use-local-storage';

// ─── Overlay stack (modal/dialog portal) ────────────────────────────

const OVERLAY_ROOT_ID = 'overlay-root';
const OVERLAY_BASE_Z_INDEX = 1;

interface OverlayStackValue {
  rootElement: HTMLElement | null;
  stack: string[];
  baseZIndex: number;
  register: (id: string) => void;
  unregister: (id: string) => void;
}

function ensureOverlayRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const existing = document.getElementById(OVERLAY_ROOT_ID);
  if (existing) return existing;
  const root = document.createElement('div');
  root.id = OVERLAY_ROOT_ID;
  document.body.append(root);
  return root;
}

// ─── Deck browser preferences ───────────────────────────────────────

interface DeckBrowserPreferences {
  playlistBrowserMode: PlaylistBrowserMode;
  slideBrowserMode: SlideBrowserMode;
}

interface OverlayDefaultsState {
  animationKind: OverlayAnimation['kind'];
  autoClearDurationMs: number | null;
  durationMs: number;
}

type WorkbenchContextValue = {
  state: {
    deckBrowserGridItemSize: number;
    deckBrowserGridSizeMax: number;
    deckBrowserGridSizeMin: number;
    deckBrowserGridSizeStep: number;
    drawerTab: DrawerTab;
    drawerViewModes: DrawerViewModeMap;
    expandedSegmentIds: string[];
    inspectorTab: InspectorTab;
    libraryPanelView: LibraryPanelView;
    overlayDefaults: OverlayDefaultsState;
    playlistBrowserMode: PlaylistBrowserMode;
    programMode: ProgramMode;
    programSingleSurface: ProgramSurfaceKind;
    programGridDensity: ProgramGridDensity;
    slideBrowserMode: SlideBrowserMode;
    workbenchMode: WorkbenchMode;
  };
  actions: {
    setDeckBrowserGridItemSize: (size: number) => void;
    setDrawerTab: (tab: DrawerTab) => void;
    setDrawerViewMode: (tab: DrawerTab, mode: ResourceDrawerViewMode) => void;
    setExpandedSegmentIds: (segmentIds: string[]) => void;
    setInspectorTab: (tab: InspectorTab) => void;
    setLibraryPanelView: (view: LibraryPanelView) => void;
    updateOverlayDefaults: (next: Partial<OverlayDefaultsState>) => void;
    setPlaylistBrowserMode: (mode: PlaylistBrowserMode) => void;
    setProgramMode: (mode: ProgramMode) => void;
    setProgramSingleSurface: (surface: ProgramSurfaceKind) => void;
    setProgramGridDensity: (density: ProgramGridDensity) => void;
    setSlideBrowserMode: (mode: SlideBrowserMode) => void;
    setWorkbenchMode: (mode: WorkbenchMode) => void;
  };
  overlayStack: OverlayStackValue;
};

const WorkbenchStateContext = createContext<WorkbenchContextValue['state'] | null>(null);
const WorkbenchActionsContext = createContext<WorkbenchContextValue['actions'] | null>(null);
const WorkbenchOverlayStackContext = createContext<WorkbenchContextValue['overlayStack'] | null>(null);
const WORKBENCH_MODE_STORAGE_KEY = 'lumacast.workbench-mode.v1';
const DECK_BROWSER_STORAGE_KEY = 'lumacast.deck-browser-preferences.v1';
const DRAWER_VIEW_MODES_STORAGE_KEY = 'lumacast.drawer-view-modes.v1';
const DEFAULT_DRAWER_VIEW_MODES: DrawerViewModeMap = { deck: 'grid', image: 'grid', themes: 'grid' };
const LIBRARY_PANEL_VIEW_STORAGE_KEY = 'lumacast.library-panel-view.v1';
const EXPANDED_SEGMENTS_STORAGE_KEY = 'lumacast.library-panel-expanded-segments.v1';
const OVERLAY_DEFAULTS_STORAGE_KEY = 'lumacast.overlay-defaults.v1';
const PROGRAM_MODE_STORAGE_KEY = 'lumacast.program-mode.v1';
const PROGRAM_SINGLE_SURFACE_STORAGE_KEY = 'lumacast.program-single-surface.v1';
const PROGRAM_GRID_DENSITY_STORAGE_KEY = 'lumacast.program-grid-density.v1';
const VALID_MODES = new Set<WorkbenchMode>(['show', 'deck-editor', 'overlay-editor', 'theme-editor', 'stage-editor', 'settings']);
const DEFAULT_OVERLAY_DEFAULTS: OverlayDefaultsState = {
  animationKind: 'dissolve',
  durationMs: 400,
  autoClearDurationMs: null,
};

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const [workbenchMode, setWorkbenchMode] = useLocalStorage<WorkbenchMode>(WORKBENCH_MODE_STORAGE_KEY, 'show', parseWorkbenchMode);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('deck');
  const [drawerViewModes, setDrawerViewModesRaw] = useLocalStorage<DrawerViewModeMap>(
    DRAWER_VIEW_MODES_STORAGE_KEY,
    DEFAULT_DRAWER_VIEW_MODES,
    parseDrawerViewModes,
    JSON.stringify,
  );
  const [libraryPanelView, setLibraryPanelViewRaw] = useLocalStorage<LibraryPanelView>(
    LIBRARY_PANEL_VIEW_STORAGE_KEY,
    'libraries',
    parseLibraryPanelView,
  );
  const [expandedSegmentIds, setExpandedSegmentIds] = useLocalStorage<string[]>(
    EXPANDED_SEGMENTS_STORAGE_KEY,
    [],
    parseExpandedSegmentIds,
    JSON.stringify,
  );
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('presentation');
  const [deckBrowserPreferences, setDeckBrowserPreferences] = useLocalStorage<DeckBrowserPreferences>(
    DECK_BROWSER_STORAGE_KEY,
    { slideBrowserMode: 'grid', playlistBrowserMode: 'current' },
    parseDeckBrowserPreferences,
    JSON.stringify,
  );
  const [overlayDefaults, setOverlayDefaults] = useLocalStorage<OverlayDefaultsState>(
    OVERLAY_DEFAULTS_STORAGE_KEY,
    DEFAULT_OVERLAY_DEFAULTS,
    parseOverlayDefaults,
    JSON.stringify,
  );
  const [programMode, setProgramMode] = useLocalStorage<ProgramMode>(
    PROGRAM_MODE_STORAGE_KEY,
    'single',
    parseProgramMode,
  );
  const [programSingleSurface, setProgramSingleSurface] = useLocalStorage<ProgramSurfaceKind>(
    PROGRAM_SINGLE_SURFACE_STORAGE_KEY,
    'program',
    parseProgramSurfaceKind,
  );
  const [programGridDensity, setProgramGridDensity] = useLocalStorage<ProgramGridDensity>(
    PROGRAM_GRID_DENSITY_STORAGE_KEY,
    1,
    parseProgramGridDensity,
  );
  const {
    gridSize: deckBrowserGridItemSize,
    setGridSize: setDeckBrowserGridItemSize,
    min: deckBrowserGridSizeMin,
    max: deckBrowserGridSizeMax,
    step: deckBrowserGridSizeStep,
  } = useGridSize('lumacast.grid-size.slide-browser', 6, 4, 8);

  // Overlay stack (modal/dialog portal)
  const [overlayRootElement] = useState<HTMLElement | null>(ensureOverlayRoot);
  const [overlayStackEntries, setOverlayStackEntries] = useState<string[]>([]);

  const registerOverlay = useCallback((id: string) => {
    setOverlayStackEntries((prev) => prev.includes(id) ? prev : [...prev, id]);
  }, []);

  const unregisterOverlay = useCallback((id: string) => {
    setOverlayStackEntries((prev) => {
      const next = prev.filter((entryId) => entryId !== id);
      return next.length === prev.length ? prev : next;
    });
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    if (overlayStackEntries.length > 0) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [overlayStackEntries.length]);

  const setDrawerViewMode = useCallback((tab: DrawerTab, mode: ResourceDrawerViewMode) => {
    setDrawerViewModesRaw({ ...drawerViewModes, [tab]: mode });
  }, [drawerViewModes, setDrawerViewModesRaw]);

  const setLibraryPanelView = useCallback((view: LibraryPanelView) => {
    setLibraryPanelViewRaw(view);
  }, [setLibraryPanelViewRaw]);

  const setSlideBrowserMode = useCallback((mode: SlideBrowserMode) => {
    setDeckBrowserPreferences({
      ...deckBrowserPreferences,
      slideBrowserMode: mode,
    });
  }, [deckBrowserPreferences, setDeckBrowserPreferences]);

  const setPlaylistBrowserMode = useCallback((mode: PlaylistBrowserMode) => {
    setDeckBrowserPreferences({
      ...deckBrowserPreferences,
      playlistBrowserMode: mode,
    });
  }, [deckBrowserPreferences, setDeckBrowserPreferences]);

  const updateOverlayDefaults = useCallback((next: Partial<OverlayDefaultsState>) => {
    setOverlayDefaults(sanitizeOverlayDefaults({
      ...overlayDefaults,
      ...next,
    }));
  }, [overlayDefaults, setOverlayDefaults]);

  const state = useMemo<WorkbenchContextValue['state']>(() => ({
    deckBrowserGridItemSize,
    deckBrowserGridSizeMax,
    deckBrowserGridSizeMin,
    deckBrowserGridSizeStep,
    drawerTab,
    drawerViewModes,
    expandedSegmentIds,
    inspectorTab,
    libraryPanelView,
    overlayDefaults,
    playlistBrowserMode: deckBrowserPreferences.playlistBrowserMode,
    programMode,
    programSingleSurface,
    programGridDensity,
    slideBrowserMode: deckBrowserPreferences.slideBrowserMode,
    workbenchMode,
  }), [
    deckBrowserGridItemSize,
    deckBrowserGridSizeMax,
    deckBrowserGridSizeMin,
    deckBrowserGridSizeStep,
    deckBrowserPreferences,
    drawerTab,
    drawerViewModes,
    expandedSegmentIds,
    inspectorTab,
    libraryPanelView,
    overlayDefaults,
    programMode,
    programSingleSurface,
    programGridDensity,
    workbenchMode,
  ]);

  const actions = useMemo<WorkbenchContextValue['actions']>(() => ({
    setDeckBrowserGridItemSize,
    setDrawerTab,
    setDrawerViewMode,
    setExpandedSegmentIds,
    setInspectorTab,
    setLibraryPanelView,
    updateOverlayDefaults,
    setPlaylistBrowserMode,
    setProgramMode,
    setProgramSingleSurface,
    setProgramGridDensity,
    setSlideBrowserMode,
    setWorkbenchMode,
  }), [
    setDeckBrowserGridItemSize,
    setDrawerTab,
    setDrawerViewMode,
    setExpandedSegmentIds,
    setInspectorTab,
    setLibraryPanelView,
    updateOverlayDefaults,
    setPlaylistBrowserMode,
    setProgramMode,
    setProgramSingleSurface,
    setProgramGridDensity,
    setSlideBrowserMode,
    setWorkbenchMode,
  ]);

  const overlayStack = useMemo<OverlayStackValue>(() => ({
    rootElement: overlayRootElement,
    stack: overlayStackEntries,
    baseZIndex: OVERLAY_BASE_Z_INDEX,
    register: registerOverlay,
    unregister: unregisterOverlay,
  }), [overlayRootElement, overlayStackEntries, registerOverlay, unregisterOverlay]);

  return (
    <WorkbenchStateContext.Provider value={state}>
      <WorkbenchActionsContext.Provider value={actions}>
        <WorkbenchOverlayStackContext.Provider value={overlayStack}>
          {children}
        </WorkbenchOverlayStackContext.Provider>
      </WorkbenchActionsContext.Provider>
    </WorkbenchStateContext.Provider>
  );
}

export function useWorkbench(): WorkbenchContextValue {
  const state = useContext(WorkbenchStateContext);
  const actions = useContext(WorkbenchActionsContext);
  const overlayStack = useContext(WorkbenchOverlayStackContext);
  if (!state || !actions || !overlayStack) throw new Error('useWorkbench must be used within WorkbenchProvider');
  return { state, actions, overlayStack };
}

function parseWorkbenchMode(raw: string): WorkbenchMode | null {
  return VALID_MODES.has(raw as WorkbenchMode) ? (raw as WorkbenchMode) : null;
}

function isValidViewMode(value: unknown): value is ResourceDrawerViewMode {
  return value === 'grid' || value === 'list';
}

function parseDrawerViewModes(raw: string): DrawerViewModeMap | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const deck = parsed.deck;
    const image = parsed.image;
    const themes = parsed.themes;
    if (!isValidViewMode(deck) || !isValidViewMode(image) || !isValidViewMode(themes)) return null;
    return { deck, image, themes };
  } catch {
    return null;
  }
}

function parseLibraryPanelView(raw: string): LibraryPanelView | null {
  return raw === 'playlist' ? 'playlist' : raw === 'libraries' ? 'libraries' : null;
}

function parseExpandedSegmentIds(raw: string): string[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === 'string')) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseDeckBrowserPreferences(raw: string): DeckBrowserPreferences | null {
  try {
    const parsed = JSON.parse(raw) as Partial<DeckBrowserPreferences>;
    const slideBrowserMode = parsed.slideBrowserMode === 'grid' || parsed.slideBrowserMode === 'list'
      ? parsed.slideBrowserMode
      : null;
    const playlistBrowserMode = parsed.playlistBrowserMode === 'current'
      || parsed.playlistBrowserMode === 'tabs'
      || parsed.playlistBrowserMode === 'continuous'
      ? parsed.playlistBrowserMode
      : null;

    if (!slideBrowserMode || !playlistBrowserMode) return null;

    return {
      slideBrowserMode,
      playlistBrowserMode,
    };
  } catch {
    return null;
  }
}

function parseOverlayDefaults(raw: string): OverlayDefaultsState | null {
  try {
    return sanitizeOverlayDefaults(JSON.parse(raw) as Partial<OverlayDefaultsState>);
  } catch {
    return null;
  }
}

function sanitizeOverlayDefaults(value: Partial<OverlayDefaultsState>): OverlayDefaultsState {
  const animationKind = value.animationKind === 'none'
    || value.animationKind === 'dissolve'
    || value.animationKind === 'fade'
    || value.animationKind === 'pulse'
    ? value.animationKind
    : DEFAULT_OVERLAY_DEFAULTS.animationKind;
  const durationMs = sanitizeDuration(value.durationMs, DEFAULT_OVERLAY_DEFAULTS.durationMs);
  const autoClearDurationMs = value.autoClearDurationMs == null
    ? null
    : sanitizeDuration(value.autoClearDurationMs, DEFAULT_OVERLAY_DEFAULTS.durationMs);

  return {
    animationKind,
    durationMs,
    autoClearDurationMs,
  };
}

function sanitizeDuration(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.round(value));
}

function parseProgramMode(raw: string): ProgramMode | null {
  return raw === 'single' || raw === 'all' ? raw : null;
}

function parseProgramSurfaceKind(raw: string): ProgramSurfaceKind | null {
  if (raw === 'preview') return 'program';
  return raw === 'program' || raw === 'monitor' || raw === 'stage' ? raw : null;
}

function parseProgramGridDensity(raw: string): ProgramGridDensity | null {
  const parsed = Number(raw);
  return parsed === 1 || parsed === 2 ? (parsed as ProgramGridDensity) : null;
}
