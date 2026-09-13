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
import { detectMediaFileType } from '../../utils/slides';
import { cn } from '@renderer/utils/cn';

const STANDARD_SORT_OPTIONS = [
  { key: 'name', label: 'Name' },
  { key: 'created', label: 'Date created' },
  { key: 'modified', label: 'Date modified' },
] as const;

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
    && (item.type === '' || IMPORT_TYPE_PREFIXES_BY_TAB[tab].some((type) => item.type.startsWith(type)))
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
    setIsDragOver(false);
    if (!isImportTab(drawerTab) || event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    const accepted = Array.from(event.dataTransfer.files).filter((file) => detectMediaFileType(file) === drawerTab);
    if (accepted.length > 0) void importMedia(accepted);
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
  const { state } = useDrawer();

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
        <DrawerSearchField tab={state.drawerTab} />
      </div>
      <Toolbar />
    </div>
  );
}

function DrawerSearchField({ tab }: { tab: DrawerTab }) {
  switch (tab) {
    case 'deck': return <BinControlsSearchField placeholder="Search…" />;
    case 'themes': return <BinControlsSearchField placeholder="Search themes…" />;
    case 'image': return <BinControlsSearchField placeholder="Search image…" />;
    case 'video': return <BinControlsSearchField placeholder="Search video…" />;
    case 'audio': return <BinControlsSearchField placeholder="Search audio…" />;
  }

  return assertNever(tab);
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
// Per-tab content lives in named sub-components so each tab's
// actions stay co-located. Appended at the end: view-mode choices
// and (when applicable) the size slider.

function MoreActionsMenu({ onImportClick }: { onImportClick: () => void }) {
  return (
    <Dropdown>
      <Dropdown.Trigger aria-label="More actions" className="cursor-pointer rounded-sm bg-transparent p-1 text-tertiary transition-colors hover:bg-tertiary hover:text-primary [&>svg]:size-4">
        <Ellipsis />
      </Dropdown.Trigger>
      <Dropdown.Panel placement="bottom-end" className="min-w-64">
        <MoreActionsMenuContent onImportClick={onImportClick} />
        <Dropdown.Separator />
        <BinControlsViewOptions />
      </Dropdown.Panel>
    </Dropdown>
  );
}

function MoreActionsMenuContent({ onImportClick }: { onImportClick: () => void }) {
  const { state } = useDrawer();
  switch (state.drawerTab) {
    case 'deck': return <DeckMenuItems />;
    case 'image': return <ImageMenuItems onImportClick={onImportClick} />;
    case 'video': return <VideoMenuItems onImportClick={onImportClick} />;
    case 'audio': return <AudioMenuItems onImportClick={onImportClick} />;
    case 'themes': return <ThemesMenuItems />;
  }

  return assertNever(state.drawerTab);
}

function DeckMenuItems() {
  const { open: openCreateItem } = useCreateItem();
  const deckSort = useDeckBinSort();

  return (
    <>
      <Dropdown.Item onClick={() => openCreateItem('presentation')}>New presentation</Dropdown.Item>
      <Dropdown.Item onClick={() => openCreateItem('lyric')}>New lyric</Dropdown.Item>
      <Dropdown.Separator />
      <SortMenuItem sortKey="name" label="Name" sort={deckSort.sort} onChange={deckSort.setSort} />
      <SortMenuItem sortKey="created" label="Date created" sort={deckSort.sort} onChange={deckSort.setSort} />
      <SortMenuItem sortKey="modified" label="Date modified" sort={deckSort.sort} onChange={deckSort.setSort} />
      <SortMenuItem sortKey="slides" label="Slide count" sort={deckSort.sort} onChange={deckSort.setSort} />
    </>
  );
}

function ImageMenuItems({ onImportClick }: { onImportClick: () => void }) {
  const mediaSort = useMediaBinSort();
  return (
    <>
      <Dropdown.Item onClick={onImportClick}>Import images</Dropdown.Item>
      <Dropdown.Separator />
      <SortMenuItems options={STANDARD_SORT_OPTIONS} sort={mediaSort.sort} onChange={mediaSort.setSort} />
    </>
  );
}

function VideoMenuItems({ onImportClick }: { onImportClick: () => void }) {
  const mediaSort = useMediaBinSort();
  return (
    <>
      <Dropdown.Item onClick={onImportClick}>Import videos</Dropdown.Item>
      <Dropdown.Separator />
      <SortMenuItems options={STANDARD_SORT_OPTIONS} sort={mediaSort.sort} onChange={mediaSort.setSort} />
    </>
  );
}

function AudioMenuItems({ onImportClick }: { onImportClick: () => void }) {
  const audioSort = useAudioBinSort();
  return (
    <>
      <Dropdown.Item onClick={onImportClick}>Import audio</Dropdown.Item>
      <Dropdown.Separator />
      <SortMenuItems options={STANDARD_SORT_OPTIONS} sort={audioSort.sort} onChange={audioSort.setSort} />
    </>
  );
}

function ThemesMenuItems() {
  const { createTheme } = useThemeEditor();
  const { actions: { setWorkbenchMode } } = useWorkbench();
  const themeSort = useThemeBinSort();

  function handleCreateTheme(themeType: ThemeOwnerType) {
    createTheme(themeType);
    setWorkbenchMode('theme-editor');
  }

  return (
    <>
      <Dropdown.Item onClick={() => handleCreateTheme('presentation')}>New presentation theme</Dropdown.Item>
      <Dropdown.Item onClick={() => handleCreateTheme('lyric')}>New lyric theme</Dropdown.Item>
      <Dropdown.Separator />
      <SortMenuItems options={STANDARD_SORT_OPTIONS} sort={themeSort.sort} onChange={themeSort.setSort} />
    </>
  );
}

// ─── Body ─────────────────────────────────────────────────
// Single scrollable container; the active tab decides which bin panel renders.

function Body() {
  const { state } = useDrawer();
  switch (state.drawerTab) {
    case 'video': return <VideoBody />;
    case 'audio': return <AudioBody />;
    case 'deck': return <DeckBody />;
    case 'image': return <ImageBody />;
    case 'themes': return <ThemesBody />;
  }

  return assertNever(state.drawerTab);
}

// Video and audio arm a clip on the program output, so their bins keep the
// transport that drives the armed asset directly above them.

function VideoBody() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="w-full shrink-0 border-b border-secondary bg-primary px-1">
        <VideoTransportControls />
      </div>
      <div className="flex min-h-0 flex-1">
        <MediaBinPanel binKind="video" />
      </div>
    </div>
  );
}

function AudioBody() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="w-full shrink-0 border-b border-secondary bg-primary px-1">
        <AudioTransportControls />
      </div>
      <div className="flex min-h-0 flex-1">
        <AudioBinPanel />
      </div>
    </div>
  );
}

function DeckBody() {
  return (
    <div className="flex min-h-0 flex-1">
      <DeckBinPanel />
    </div>
  );
}

function ImageBody() {
  return (
    <div className="flex min-h-0 flex-1">
      <MediaBinPanel binKind="image" />
    </div>
  );
}

function ThemesBody() {
  return (
    <div className="flex min-h-0 flex-1">
      <ThemeBinPanel />
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
  return (
    <>
      {options.map((option) => (
        <SortMenuItem key={option.key} sortKey={option.key} label={option.label} sort={sort} onChange={onChange} />
      ))}
    </>
  );
}

function SortMenuItem<K extends string>({
  sortKey,
  label,
  sort,
  onChange,
}: {
  sortKey: K;
  label: string;
  sort: BinSort<K>;
  onChange: (next: BinSort<K>) => void;
}) {
  const active = sort.key === sortKey;

  function handleClick() {
    onChange({
      key: sortKey,
      direction: active && sort.direction === 'asc'
        ? 'desc'
        : active ? 'asc' : sort.direction,
    });
  }

  return (
    <Dropdown.Item onClick={handleClick}>
      <span className="flex-1">{label}</span>
      {active && sort.direction === 'asc' && <ArrowUp size={14} />}
      {active && sort.direction === 'desc' && <ArrowDown size={14} />}
    </Dropdown.Item>
  );
}

function assertNever(value: never): never {
  throw new Error(`Unhandled drawer tab: ${String(value)}`);
}

// ─── Public export ────────────────────────────────────────

export const ResourceDrawer = { Root, Header, Body };
