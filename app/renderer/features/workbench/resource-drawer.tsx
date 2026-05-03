import { createContext, useContext, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Ellipsis } from 'lucide-react';
import { Tabs } from '../../components/display/tabs';
import { Dropdown } from '../../components/form/dropdown';
import { FileTrigger } from '../../components/form/file-trigger';
import { useThemeEditor } from '../../contexts/asset-editor/asset-editor-context';
import { useElements } from '../../contexts/canvas/canvas-context';
import { useWorkbench } from '../../contexts/workbench-context';
import { useCreateDeckItem } from '../deck/create-deck-item';
import { useResourceDrawer } from './resource-drawer-context';
import type { DrawerTab } from '../../types/ui';
import { MediaBinPanel } from '../assets/media/media-bin-panel';
import { ThemeBinPanel } from '../assets/themes/theme-bin-panel';
import { DeckBinPanel } from '../deck/deck-bin-panel';
import {
  useDeckBinSort,
  useMediaBinSort,
  useThemeBinSort,
  type BinSort,
} from './use-bin-sort';
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
} as const;

const IMPORT_TYPE_PREFIXES_BY_TAB = {
  image: ['image/'],
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
  return tab === 'image';
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

function Root({ children }: { children: ReactNode }) {
  const { drawerTab, setDrawerTab } = useResourceDrawer();
  const { importMedia } = useElements();
  const [isDragOver, setIsDragOver] = useState(false);

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
      showImportAction: drawerTab === 'image',
    },
    actions: { setDrawerTab, handleImport },
  };

  return (
    <ResourceDrawerContext.Provider value={value}>
      <Tabs.Root value={drawerTab} onValueChange={handleTabChange}>
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
      </Tabs.Root>
    </ResourceDrawerContext.Provider>
  );
}

// ─── Header ───────────────────────────────────────────────
// Single flex row: tab list on the left, toolbar controls on the right.

function Header() {
  return (
    <div className="flex h-8 items-end border-b border-primary px-1">
      <Tabs.List label="Resource tabs" className="min-w-0 flex-1" tabsClassName="gap-0.5">
        <Tabs.Trigger value="deck">Deck</Tabs.Trigger>
        <Tabs.Trigger value="image">Images</Tabs.Trigger>
        <Tabs.Trigger value="themes">Themes</Tabs.Trigger>
      </Tabs.List>
      <Toolbar />
    </div>
  );
}

// ─── Toolbar ──────────────────────────────────────────────
// Right-side controls: import file picker, more actions. View mode and grid
// size live in each panel's own footer.

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

function MoreActionsMenu({ onImportClick }: { onImportClick: () => void }) {
  const { state } = useDrawer();
  const { open: openCreateDeckItem } = useCreateDeckItem();
  const { createTheme } = useThemeEditor();
  const { actions: { setWorkbenchMode } } = useWorkbench();
  const deckSort = useDeckBinSort();
  const mediaSort = useMediaBinSort();
  const themeSort = useThemeBinSort();

  function handleCreateTheme(kind: 'slides' | 'lyrics') {
    createTheme(kind);
    setWorkbenchMode('theme-editor');
  }

  return (
    <Dropdown>
      <Dropdown.Trigger aria-label="More actions" className={TRIGGER_CLASS}>
        <Ellipsis />
      </Dropdown.Trigger>
      <Dropdown.Panel placement="bottom-end">
        {state.drawerTab === 'deck' && (
          <>
            <Dropdown.Item onClick={() => openCreateDeckItem('presentation')}>New presentation</Dropdown.Item>
            <Dropdown.Item onClick={() => openCreateDeckItem('lyric')}>New lyric</Dropdown.Item>
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
        {state.drawerTab === 'themes' && (
          <>
            <Dropdown.Item onClick={() => handleCreateTheme('slides')}>New slides theme</Dropdown.Item>
            <Dropdown.Item onClick={() => handleCreateTheme('lyrics')}>New lyrics theme</Dropdown.Item>
            <Dropdown.Separator />
            <SortMenuItems options={STANDARD_SORT_OPTIONS} sort={themeSort.sort} onChange={themeSort.setSort} />
          </>
        )}
      </Dropdown.Panel>
    </Dropdown>
  );
}

// ─── Body ─────────────────────────────────────────────────
// Single scrollable container; the active tab decides which bin panel renders.

function Body() {
  const { state } = useDrawer();
  const { drawerTab } = state;

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
