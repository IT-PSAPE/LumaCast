import { AppWindow, EllipsisVertical, LayoutGrid, List, RectangleHorizontal, Rows3 } from 'lucide-react';
import { Dropdown } from '../../components/form/dropdown';
import { GridSizeSlider } from '../../components/form/grid-size-slider';
import { Tabs } from '../../components/display/tabs';
import { useNavigation } from '../../contexts/navigation-context';
import { useSlides } from '../../contexts/slide-context';
import { useDeckBrowser } from './deck-browser-context';
import { useLyricEditor } from './lyric-editor';
import type { SlideBrowserHeaderVariant } from './use-deck-browser-view';
import type { PlaylistDeckSequenceItem } from './use-playlist-deck-sequence';

interface DeckBrowserToolbarProps {
  items: PlaylistDeckSequenceItem[];
  headerVariant: SlideBrowserHeaderVariant;
}

function PlaylistTabItem({ items }: { items: PlaylistDeckSequenceItem[] }) {
  const { currentPlaylistEntryId } = useNavigation();
  const { selectPlaylistEntry } = useSlides();

  function getLabel(item: PlaylistDeckSequenceItem) {
    const duplicateSuffix = item.occurrenceIndex > 1 ? ` (${item.occurrenceIndex})` : '';
    return `${item.item.title}${duplicateSuffix}`;
  }

  return (
    <Tabs.Root value={currentPlaylistEntryId ?? undefined} onValueChange={selectPlaylistEntry}>
      <Tabs.List label="Playlist items">
        {items.map((item) => <Tabs.Trigger value={item.entryId}>{getLabel(item)}</Tabs.Trigger>)}
      </Tabs.List>
    </Tabs.Root>
  );
}

export function DeckBrowserToolbar({ items, headerVariant }: DeckBrowserToolbarProps) {
  const { open: openLyricEditor } = useLyricEditor();
  const { createSlide } = useSlides();
  const { currentDeckItem, currentLibraryBundle, currentPlaylistId, isDetachedDeckBrowser } = useNavigation();
  const { slideBrowserMode, setSlideBrowserMode, playlistBrowserMode, setPlaylistBrowserMode, gridItemSize, gridSizeMin, gridSizeMax, gridSizeStep, setGridItemSize } = useDeckBrowser();

  const isGridMode = slideBrowserMode === 'grid';
  const showPlaylistModes = !isDetachedDeckBrowser && (isGridMode || slideBrowserMode === 'list');
  const showContentInfo = headerVariant !== 'hidden';
  const currentPlaylist = currentLibraryBundle?.playlists.find((tree) => tree.playlist.id === currentPlaylistId)?.playlist ?? null;

  function handleAddSlide() {
    if (currentDeckItem) void createSlide();
  }

  function handleOpenEditor() {
    if (currentDeckItem?.type === 'lyric') openLyricEditor();
  }

  function ViewIcon() {
    switch (slideBrowserMode) {
      case 'grid':
        return <LayoutGrid className='size-4' />;
      case 'list':
        return <List className='size-4' />;
      default:
        return null;
    }
  }

  function PlaylistIcon() {
    switch (playlistBrowserMode) {
      case 'current':
        return <RectangleHorizontal className='size-4' />;
      case 'tabs':
        return <AppWindow className='size-4' />;
      case 'continuous':
        return <Rows3 className='size-4' />;
      default:
        return null;
    }
  }

  return (
    <header className="flex h-9 shrink-0 items-center gap-2 border-b border-secondary bg-primary/80 px-2">
        {/* Left: content info */}
        {showContentInfo && (
          <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
            {headerVariant === 'tabs' ? (
              <PlaylistTabItem items={items} />
            ) : (
              <span className="truncate text-sm font-medium text-primary" title={headerVariant === 'continuous' ? currentPlaylist?.name : currentDeckItem?.title}>
                {headerVariant === 'continuous' ? currentPlaylist?.name ?? 'Playlist' : currentDeckItem?.title ?? 'No item selected'}
              </span>
            )}
          </div>
        )}

        {/* Right: toolbar controls */}
        <div className="ml-auto flex items-center gap-1.5">
          {isGridMode && <GridSizeSlider value={gridItemSize} min={gridSizeMin} max={gridSizeMax} step={gridSizeStep} onChange={setGridItemSize} />}

          {showPlaylistModes && (
            <Dropdown>
              <Dropdown.Trigger className="cursor-pointer rounded-sm bg-tertiary p-1 text-primary transition-colors hover:text-primary">
                <PlaylistIcon />
              </Dropdown.Trigger>
              <Dropdown.Panel placement="bottom-end">
                <Dropdown.Item onClick={() => setPlaylistBrowserMode('current')}>
                  <RectangleHorizontal className='size-4' /> Current
                </Dropdown.Item>
                <Dropdown.Item onClick={() => setPlaylistBrowserMode('tabs')}>
                  <AppWindow className='size-4' /> Tabs
                </Dropdown.Item>
                <Dropdown.Item onClick={() => setPlaylistBrowserMode('continuous')}>
                  <Rows3 className='size-4' /> Continuous
                </Dropdown.Item>
              </Dropdown.Panel>
            </Dropdown>
          )}

          <Dropdown>
            <Dropdown.Trigger className="cursor-pointer rounded-sm bg-tertiary p-1 text-primary transition-colors hover:text-primary">
              <ViewIcon />
            </Dropdown.Trigger>
            <Dropdown.Panel placement="bottom-end">
              <Dropdown.Item onClick={() => setSlideBrowserMode('grid')}>
                <LayoutGrid className='size-4' /> Grid
              </Dropdown.Item>
              <Dropdown.Item onClick={() => setSlideBrowserMode('list')}>
                <List className='size-4' /> List
              </Dropdown.Item>
            </Dropdown.Panel>
          </Dropdown>

          <Dropdown>
            <Dropdown.Trigger className="cursor-pointer rounded-sm bg-tertiary p-1 text-primary transition-colors hover:text-primary">
              <EllipsisVertical className="size-4" />
            </Dropdown.Trigger>
            <Dropdown.Panel placement="bottom-end">
              <Dropdown.Item onClick={handleAddSlide}>Add slide</Dropdown.Item>
              <Dropdown.Item onClick={handleOpenEditor}>Open lyric editor</Dropdown.Item>
            </Dropdown.Panel>
          </Dropdown>
      </div>
    </header>
  );
}
