import { createContext, useContext, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Ellipsis } from 'lucide-react';
import type { ThemeOwnerType } from '@lumacast/composition';
import { Tabs } from '../../components/display/tabs';
import { Dropdown } from '../../components/form/dropdown';
import { FileTrigger } from '../../components/form/file-trigger';
import { useThemeEditor } from '../../contexts/asset-editor/asset-editor-context';
import { useElements } from '../../contexts/canvas/canvas-context';
import { useWorkbench } from '../../contexts/workbench-context';
import { useCreateItem } from '../items/create-item';
import { useResourceDrawer } from './resource-drawer-context';
import type { DrawerTab } from '../../types/ui';
import { AudioBinPanel } from '../assets/audio/audio-bin-panel';
import { MediaBinPanel } from '../assets/media/media-bin-panel';
import { ThemeBinPanel } from '../assets/themes/theme-bin-panel';
import { DeckBinPanel } from '../items/deck-bin-panel';
import { AudioTransportControls, VideoTransportControls } from '../playback/media-transport-controls';
import {
  useAudioBinSort,
  useDeckBinSort,
  useMediaBinSort,
  useThemeBinSort,
  type BinSort,
} from './use-bin-sort';
import { useGridSize } from '../../hooks/use-grid-size';
import { BinControlsProvider, BinControlsSearchField, BinControlsViewOptions, type BinGridConfig } from '@renderer/components/controls/bin-controls';
import { cn } from '@renderer/utils/cn';

const DECK_SORT_OPTIONS = [
  { key: 'name', label: 'Name' },
  { key: 'created', label: 'Date created' },
  { key: 'modified', label: 'Date modified' },
  { key: 'slides', label: 'Slide count' },
] as const;

const STANDARD_SORT_OPTIONS = [
  { key: 'name', label: 'Name' },
  { key: 'created', label: 'Date created' },
  { key: 'modified', label: 'Date modified' },
] as const;

const TRIGGER_CLASS = 'cursor-pointer transition-colors p-1 rounded-sm bg-transparent text-tertiary hover:bg-quaternary hover:text-primary [&>svg]:size-4';

const IMPORT_ACCEPT_BY_TAB = {
  image: 'image/*',
  video: 'video/*',
  audio: 'audio/*',
} as const;

const IMPORT_TYPE_PREFIXES_BY_TAB = {
  image: ['image/'],
  video: ['video/'],
  audio: ['audio/'],
} as const;

const SEARCH_PLACEHOLDER_BY_TAB: Record<DrawerTab, string> = {
  deck: 'Search…',
  themes: 'Search themes…',
  image: 'Search image…',
  video: 'Search video…',
  audio: 'Search audio…',
};

interface ResourceDrawerContextValue {
  state: { drawerTab: DrawerTab };
  meta: {
    showImportAction: boolean;
  };
  actions: {
    setDrawerTab: (tab: DrawerTab) => void;
    handleImport: (event: ChangeEvent<HTMLInputElement>) => void;
  };
}

const ResourceDrawerContext = createContext<ResourceDrawerContextValue | null>(null);

function useDrawer() {
  const context = useContext(ResourceDrawerContext);
  if (!context) throw new Error('ResourceDrawer parts must be used within ResourceDrawer.Root');
  return context;
}

function isImportTab(tab: DrawerTab): tab is keyof typeof IMPORT_ACCEPT_BY_TAB {
  return tab === 'image' || tab === 'video' || tab === 'audio';
}

function hasImportableFiles(transfer: DataTransfer, tab: DrawerTab): boolean {
  if (!isImportTab(tab)) return false;
  return Array.from(transfer.items).some((item) => (
    item.kind === 'file'
    && IMPORT_TYPE_PREFIXES_BY_TAB[tab].some((type) => item.type.startsWith(type))
  ));
}

// ─── Root ─────────────────────────────────────────────────
// Owns drag/drop, the drawer context, and Tabs.Root. Holds the outer footer
// element so siblings (Header, Body) sit at one level below.
// Also owns bin-controls state (search, view mode, grid) so the single header
// row can host the search field and view options.

function Root({ children }: { children: ReactNode }) {
  const { drawerTab, setDrawerTab, drawerViewMode, setDrawerViewMode } = useResourceDrawer();
  const { importMedia } = useElements();
  const [isDragOver, setIsDragOver] = useState(false);
  const [searchValue, setSearchValue] = useState('');

  // useGridSize is a useState over localStorage, so each key must be read
  // in exactly one place. Call once per grid key unconditionally and select
  // the active one below (precedent: asset-editor-context useThemeFamily).
  const deckGrid = useGridSize('lumacast.grid-size.deck-bin', 6, 4, 8);
  const themeGrid = useGridSize('lumacast.grid-size.theme-bin', 6, 4, 8);
  const imageGrid = useGridSize('lumacast.grid-size.image-bin', 6, 4, 8);
  const videoGrid = useGridSize('lumacast.grid-size.video-bin', 3, 2, 4);

  // Search is transient: clear when host switches tabs
  useEffect(() => {
    setSearchValue('');
  }, [drawerTab]);

  const searchPlaceholder = SEARCH_PLACEHOLDER_BY_TAB[drawerTab];

  const grid: BinGridConfig | null = useMemo(() => {
    switch (drawerTab) {
      case 'deck':
        return { value: deckGrid.gridSize, min: deckGrid.min, max: deckGrid.max, step: deckGrid.step, onChange: deckGrid.setGridSize };
      case 'themes':
        return { value: themeGrid.gridSize, min: themeGrid.min, max: themeGrid.max, step: themeGrid.step, onChange: themeGrid.setGridSize };
      case 'image':
        return { value: imageGrid.gridSize, min: imageGrid.min, max: imageGrid.max, step: imageGrid.step, onChange: imageGrid.setGridSize };
      case 'video':
        return { value: videoGrid.gridSize, min: videoGrid.min, max: videoGrid.max, step: videoGrid.step, onChange: videoGrid.setGridSize };
      case 'audio':
        return null;
    }
  }, [deckGrid.gridSize, deckGrid.min, deckGrid.max, deckGrid.step, deckGrid.setGridSize, themeGrid.gridSize, themeGrid.min, themeGrid.max, themeGrid.step, themeGrid.setGridSize, imageGrid.gridSize, imageGrid.min, imageGrid.max, imageGrid.step, imageGrid.setGridSize, videoGrid.gridSize, videoGrid.min, videoGrid.max, videoGrid.step, videoGrid.setGridSize, drawerTab]);

  function handleImport(event: ChangeEvent<HTMLInputElement>) {
    if (!event.target.files || event.target.files.length === 0) return;
    void importMedia(event.target.files);
    event.target.value = '';
  }

  function handleDragOver(event: React.DragEvent<HTMLElement>) {
    if (!hasImportableFiles(event.dataTransfer, drawerTab)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  }

  function handleDragLeave(event: React.DragEvent<HTMLElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setIsDragOver(false);
  }

  function handleDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDragOver(false);
    if (!isImportTab(drawerTab) || event.dataTransfer.files.length === 0) return;
    void importMedia(event.dataTransfer.files);
  }

  function handleTabChange(value: string) {
    setDrawerTab(value as DrawerTab);
  }

  const value: ResourceDrawerContextValue = {
    state: { drawerTab },
    meta: {
      showImportAction: isImportTab(drawerTab),
    },
    actions: { setDrawerTab, handleImport },
  };

  return (
    <ResourceDrawerContext.Provider value={value}>
      <Tabs.Root value={drawerTab} onValueChange={handleTabChange}>
        <BinControlsProvider
          searchValue={searchValue}
          onSearchChange={setSearchValue}
          searchPlaceholder={searchPlaceholder}
          viewMode={drawerViewMode}
          onViewModeChange={setDrawerViewMode}
          grid={grid}
        >
          <footer
            data-ui-region="resource-drawer"
            className={cn(
              'grid h-full min-h-0 grid-rows-[auto_1fr] overflow-hidden border-t bg-primary',
              isDragOver ? 'border-t-focus' : 'border-t-primary',
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {children}
          </footer>
        </BinControlsProvider>
      </Tabs.Root>
    </ResourceDrawerContext.Provider>
  );
}

// ─── Header ───────────────────────────────────────────────
// Single row: tab list, search field taking remaining width, and the
// Ellipsis options menu (which now holds view + size controls).

function Header() {
  return (
    <div className="flex h-8 items-center gap-1.5 border-b border-primary px-1">
      {/* w-auto shrink-0 overrides Tabs.List's own `w-full`, which would
          otherwise act as a flex basis of 100% and starve the search field. */}
      <Tabs.List label="Resource tabs" className="w-auto shrink-0" tabsClassName="gap-0.5">
        <Tabs.Trigger value="deck">Deck</Tabs.Trigger>
        <Tabs.Trigger value="themes">Themes</Tabs.Trigger>
        <Tabs.Trigger value="image">Images</Tabs.Trigger>
        <Tabs.Trigger value="video">Videos</Tabs.Trigger>
        <Tabs.Trigger value="audio">Audio</Tabs.Trigger>
      </Tabs.List>
      <div className="ml-auto min-w-0 w-full max-w-xs">
        <BinControlsSearchField />
      </div>
      <Toolbar />
    </div>
  );
}

// ─── Toolbar ──────────────────────────────────────────────
// Right-side controls: import file picker, more actions.

function Toolbar() {
  const { actions, state } = useDrawer();
  const importInputRef = useRef<HTMLInputElement>(null);

  function handleImportClick() {
    importInputRef.current?.click();
  }

  function handleImportSelect(_files: FileList, event: ChangeEvent<HTMLInputElement>) {
    actions.handleImport(event);
  }

  return (
    <div className="flex shrink-0 items-center gap-0.5 py-0.5">
      <FileTrigger.Root
        hidden
        inputRef={importInputRef}
        accept={isImportTab(state.drawerTab) ? IMPORT_ACCEPT_BY_TAB[state.drawerTab] : 'image/*'}
        multiple
        onSelect={handleImportSelect}
      />
      <MoreActionsMenu onImportClick={handleImportClick} />
    </div>
  );
}

// ─── More-actions dropdown ────────────────────────────────
// Per-tab content lives here so each tab's actions stay co-located.
// Appended at the end: view-mode choices and (when applicable) the size slider.

function MoreActionsMenu({ onImportClick }: { onImportClick: () => void }) {
  const { state } = useDrawer();
  const { open: openCreateItem } = useCreateItem();
  const { createTheme } = useThemeEditor();
  const { actions: { setWorkbenchMode } } = useWorkbench();
  const deckSort = useDeckBinSort();
  const mediaSort = useMediaBinSort();
  const audioSort = useAudioBinSort();
  const themeSort = useThemeBinSort();

  function handleCreateTheme(themeType: ThemeOwnerType) {
    createTheme(themeType);
    setWorkbenchMode('theme-editor');
  }

  return (
    <Dropdown>
      <Dropdown.Trigger aria-label="More actions" className={TRIGGER_CLASS}>
        <Ellipsis />
      </Dropdown.Trigger>
      <Dropdown.Panel placement="bottom-end" className="min-w-64">
        {state.drawerTab === 'deck' && (
          <>
            <Dropdown.Item onClick={() => openCreateItem('presentation')}>New presentation</Dropdown.Item>
            <Dropdown.Item onClick={() => openCreateItem('lyric')}>New lyric</Dropdown.Item>
            <Dropdown.Item onClick={() => openCreateItem('talk')}>New talk</Dropdown.Item>
            <Dropdown.Separator />
            <SortMenuItems options={DECK_SORT_OPTIONS} sort={deckSort.sort} onChange={deckSort.setSort} />
          </>
        )}
        {state.drawerTab === 'image' && (
          <>
            <Dropdown.Item onClick={onImportClick}>Import images</Dropdown.Item>
            <Dropdown.Separator />
            <SortMenuItems options={STANDARD_SORT_OPTIONS} sort={mediaSort.sort} onChange={mediaSort.setSort} />
          </>
        )}
        {state.drawerTab === 'video' && (
          <>
            <Dropdown.Item onClick={onImportClick}>Import videos</Dropdown.Item>
            <Dropdown.Separator />
            <SortMenuItems options={STANDARD_SORT_OPTIONS} sort={mediaSort.sort} onChange={mediaSort.setSort} />
          </>
        )}
        {state.drawerTab === 'audio' && (
          <>
            <Dropdown.Item onClick={onImportClick}>Import audio</Dropdown.Item>
            <Dropdown.Separator />
            <SortMenuItems options={STANDARD_SORT_OPTIONS} sort={audioSort.sort} onChange={audioSort.setSort} />
          </>
        )}
        {state.drawerTab === 'themes' && (
          <>
            <Dropdown.Item onClick={() => handleCreateTheme('presentation')}>New presentation theme</Dropdown.Item>
            <Dropdown.Item onClick={() => handleCreateTheme('lyric')}>New lyric theme</Dropdown.Item>
            <Dropdown.Item onClick={() => handleCreateTheme('talk')}>New talk theme</Dropdown.Item>
            <Dropdown.Item onClick={() => handleCreateTheme('overlay')}>New overlay theme</Dropdown.Item>
            <Dropdown.Separator />
            <SortMenuItems options={STANDARD_SORT_OPTIONS} sort={themeSort.sort} onChange={themeSort.setSort} />
          </>
        )}
        <Dropdown.Separator />
        <BinControlsViewOptions />
      </Dropdown.Panel>
    </Dropdown>
  );
}

// ─── Body ─────────────────────────────────────────────────
// Single scrollable container; the active tab decides which bin panel renders.

function Body() {
  const { state } = useDrawer();
  const { drawerTab } = state;

  // Video and audio arm a clip on the program output, so their bins keep the
  // transport that drives the armed asset directly above them.
  if (drawerTab === 'video' || drawerTab === 'audio') {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="w-full shrink-0 border-b border-secondary bg-primary px-1">
          {drawerTab === 'video' ? <VideoTransportControls /> : <AudioTransportControls />}
        </div>
        <div className="flex min-h-0 flex-1">
          {drawerTab === 'video' ? <MediaBinPanel binKind="video" /> : <AudioBinPanel />}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      {drawerTab === 'deck' && <DeckBinPanel />}
      {drawerTab === 'image' && <MediaBinPanel binKind="image" />}
      {drawerTab === 'themes' && <ThemeBinPanel />}
    </div>
  );
}

// ─── Sort menu items helper ───────────────────────────────

interface SortMenuItemsProps<K extends string> {
  options: ReadonlyArray<{ key: K; label: string }>;
  sort: BinSort<K>;
  onChange: (next: BinSort<K>) => void;
}

function SortMenuItems<K extends string>({ options, sort, onChange }: SortMenuItemsProps<K>) {
  function handleSelect(key: K) {
    if (sort.key === key) {
      onChange({ key, direction: sort.direction === 'asc' ? 'desc' : 'asc' });
    } else {
      onChange({ key, direction: sort.direction });
    }
  }

  return (
    <>
      {options.map((option) => (
        <SortMenuItem key={option.key} option={option} sort={sort} onSelect={handleSelect} />
      ))}
    </>
  );
}

function SortMenuItem<K extends string>({
  option,
  sort,
  onSelect,
}: {
  option: SortMenuItemsProps<K>['options'][number];
  sort: BinSort<K>;
  onSelect: (key: K) => void;
}) {
  const active = sort.key === option.key;

  function handleClick() {
    onSelect(option.key);
  }

  return (
    <Dropdown.Item onClick={handleClick}>
      <span className="flex-1">{option.label}</span>
      {active ? (sort.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : null}
    </Dropdown.Item>
  );
}

// ─── Public export ────────────────────────────────────────

export const ResourceDrawer = { Root, Header, Body };
