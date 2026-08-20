import { AppWindow, LayoutGrid, List, RectangleHorizontal, Rows3, SlidersHorizontal } from 'lucide-react';
import { Dropdown } from '../../components/form/dropdown';
import { InspectorSlider } from '../../components/form/inspector-slider';
import { Tabs } from '../../components/display/tabs';
import { useCast } from '../../contexts/app-context';
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
  const { snapshot } = useCast();
  const { currentItem, currentItemRef, currentPlaylistId, isDetachedDeckBrowser } = useNavigation();
  const { slideBrowserMode, setSlideBrowserMode, setPlaylistBrowserMode, gridItemSize, gridSizeMin, gridSizeMax, gridSizeStep, setGridItemSize } = useDeckBrowser();

  const isGridMode = slideBrowserMode === 'grid';
  const showPlaylistModes = !isDetachedDeckBrowser && (isGridMode || slideBrowserMode === 'list');
  const showContentInfo = headerVariant !== 'hidden';
  const currentPlaylist = snapshot?.playlists.find((playlist) => playlist.id === currentPlaylistId) ?? null;

  function handleAddSlide() {
    if (currentItem) void createSlide();
  }

  function handleOpenEditor() {
    if (currentItemRef?.type === 'lyric') openLyricEditor();
  }

  return (
    <header className="flex h-9 shrink-0 items-center gap-2 border-b border-secondary bg-primary/80 px-2">
        {/* Left: content info */}
        {showContentInfo && (
          <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
            {headerVariant === 'tabs' ? (
              <PlaylistTabItem items={items} />
            ) : (
              <span className="truncate text-sm font-medium text-primary" title={headerVariant === 'continuous' ? currentPlaylist?.name : currentItem?.title}>
                {headerVariant === 'continuous' ? currentPlaylist?.name ?? 'Playlist' : currentItem?.title ?? 'No item selected'}
              </span>
            )}
          </div>
        )}

        {/* Right: toolbar controls */}
        <div className="ml-auto flex items-center gap-1.5">
          <Dropdown>
            <Dropdown.Trigger
              aria-label="View options"
              className="cursor-pointer rounded-sm bg-tertiary p-1.5 text-secondary transition-colors hover:bg-quaternary hover:text-primary"
            >
              <SlidersHorizontal size={14} strokeWidth={1.75} />
            </Dropdown.Trigger>
            {/* Ordered by reach frequency: the two slide actions first, then
                size, then the view and playlist-layout choices. */}
            <Dropdown.Panel placement="bottom-end" className="min-w-64">
              <Dropdown.Item onClick={handleAddSlide}>Add slide</Dropdown.Item>
              <Dropdown.Item onClick={handleOpenEditor}>Open lyric editor</Dropdown.Item>
              {isGridMode && (
                <>
                  <Dropdown.Separator />
                  <div className="px-1 py-1.5">
                    <InspectorSlider
                      value={gridItemSize}
                      min={gridSizeMin}
                      max={gridSizeMax}
                      step={gridSizeStep}
                      onChange={setGridItemSize}
                      label="Size"
                      ariaLabel="Grid size"
                    />
                  </div>
                </>
              )}
              <Dropdown.Separator />
              <Dropdown.Item onClick={() => setSlideBrowserMode('grid')}>
                <LayoutGrid className="size-4" /> Grid
              </Dropdown.Item>
              <Dropdown.Item onClick={() => setSlideBrowserMode('list')}>
                <List className="size-4" /> List
              </Dropdown.Item>
              {showPlaylistModes && (
                <>
                  <Dropdown.Separator />
                  <Dropdown.Item onClick={() => setPlaylistBrowserMode('current')}>
                    <RectangleHorizontal className="size-4" /> Current
                  </Dropdown.Item>
                  <Dropdown.Item onClick={() => setPlaylistBrowserMode('tabs')}>
                    <AppWindow className="size-4" /> Tabs
                  </Dropdown.Item>
                  <Dropdown.Item onClick={() => setPlaylistBrowserMode('continuous')}>
                    <Rows3 className="size-4" /> Continuous
                  </Dropdown.Item>
                </>
              )}
            </Dropdown.Panel>
          </Dropdown>
        </div>
    </header>
  );
}
