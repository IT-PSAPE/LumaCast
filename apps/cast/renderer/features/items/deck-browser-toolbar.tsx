import { useState } from 'react';
import { SlideTimingModal } from './slide-timing-modal';
import { LayoutGrid, List, SlidersHorizontal } from 'lucide-react';
import { Dropdown } from '../../components/form/dropdown';
import { InspectorSlider } from '../../components/form/inspector-slider';
import { useNavigation } from '../../contexts/navigation-context';
import { useSlides } from '../../contexts/slide-context';
import { useDeckBrowser } from './deck-browser-context';
import { useLyricEditor } from './lyric-editor';
import { PlaylistTabItem } from './playlist-tab-item';
import type { PlaylistDeckSequenceItem } from './use-playlist-deck-sequence';

interface DeckBrowserToolbarProps {
  items: PlaylistDeckSequenceItem[];
  showPlaylistTabs: boolean;
}

export function DeckBrowserToolbar({ items, showPlaylistTabs }: DeckBrowserToolbarProps) {
  const [timingOpen, setTimingOpen] = useState(false);
  const { open: openLyricEditor } = useLyricEditor();
  const { createSlide } = useSlides();
  const { currentItem, currentItemRef } = useNavigation();
  const { slideBrowserMode, setSlideBrowserMode, gridItemSize, gridSizeMin, gridSizeMax, gridSizeStep, setGridItemSize } = useDeckBrowser();

  const isGridMode = slideBrowserMode === 'grid';

  function handleAddSlide() {
    if (currentItem) void createSlide();
  }

  function handleOpenEditor() {
    if (currentItemRef?.type === 'lyric') openLyricEditor();
  }

  return (
    <header className="flex h-9 shrink-0 items-center gap-2 border-b border-secondary bg-primary/80 px-2">
        {/* Left: content info */}
        {showPlaylistTabs && (
          <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
            <PlaylistTabItem items={items} />
          </div>
        )}

        {/* Right: toolbar controls */}
        <div className="ml-auto flex items-center gap-1.5">
          <Dropdown>
            <Dropdown.Trigger
              aria-label="View options"
              className="cursor-pointer rounded-sm bg-tertiary p-1.5 text-secondary transition-colors hover:bg-tertiary hover:text-primary"
            >
              <SlidersHorizontal size={14} strokeWidth={1.75} />
            </Dropdown.Trigger>
            {/* Ordered by reach frequency: slide actions, size, then view. */}
            <Dropdown.Panel placement="bottom-end" className="min-w-64">
              <Dropdown.Item disabled={!currentItem} onClick={handleAddSlide}>Add slide</Dropdown.Item>
              <Dropdown.Item disabled={currentItemRef?.type !== 'lyric'} onClick={handleOpenEditor}>Open lyric editor</Dropdown.Item>
              <Dropdown.Item disabled={!currentItemRef} onClick={() => setTimingOpen(true)}>Slide timing</Dropdown.Item>
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
            </Dropdown.Panel>
          </Dropdown>
        </div>
      <SlideTimingModal isOpen={timingOpen} onClose={() => setTimingOpen(false)} />
    </header>
  );
}
