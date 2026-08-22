import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Slide } from '@lumacast/composition';
import { ScrollArea } from '../../components/layout/scroll-area';
import { useThumbnailScene } from '../../contexts/canvas/canvas-context';
import { useContinuousSlideSections } from './use-continuous-slide-sections';
import { useDeckBrowser } from './deck-browser-context';
import type { PlaylistDeckSequenceItem } from './use-playlist-deck-sequence';
import { ContinuousSectionHeader } from './continuous-section-header';
import { GridSlideRow } from './grid-slide-row';

// ─── Row model for the virtualized grid ───────────────────────────

type GridRow =
  | { kind: 'header'; key: string; item: PlaylistDeckSequenceItem }
  | { kind: 'slide-row'; key: string; item: PlaylistDeckSequenceItem; slides: { slide: Slide; index: number }[] };

// Estimated row sizes for the virtualizer's first paint. Real heights are
// observed via measureElement after mount.
const HEADER_ROW_ESTIMATE = 36;
const GRID_ROW_ESTIMATE = 160;
const VIRTUAL_OVERSCAN = 6;

export function ContinuousSlideGridView({ items }: { items: PlaylistDeckSequenceItem[] }) {
  const sections = useContinuousSlideSections();
  const { gridItemSize } = useDeckBrowser();
  const getThumbnailScene = useThumbnailScene();
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo<GridRow[]>(() => {
    const result: GridRow[] = [];
    for (const item of items) {
      result.push({ kind: 'header', key: `h-${item.entryId}`, item });
      const slides = item.slides;
      for (let i = 0; i < slides.length; i += gridItemSize) {
        const chunk = slides.slice(i, i + gridItemSize).map((slide, j) => ({ slide, index: i + j }));
        result.push({
          kind: 'slide-row',
          key: `${item.entryId}-r-${i}`,
          item,
          slides: chunk,
        });
      }
    }
    return result;
  }, [items, gridItemSize]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: (index) => (rows[index].kind === 'header' ? HEADER_ROW_ESTIMATE : GRID_ROW_ESTIMATE),
    overscan: VIRTUAL_OVERSCAN,
    getItemKey: (index) => rows[index].key,
  });

  return (
    <ScrollArea.Root scrollPadding={16}>
      <ScrollArea.Viewport ref={viewportRef} style={{ contain: 'strict' }}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            return (
              <div
                key={virtualRow.key}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                  contain: 'layout paint',
                  willChange: 'transform',
                }}
                className="relative"
              >
                {row.kind === 'header'
                  ? <ContinuousSectionHeader
                      item={row.item}
                      isCurrent={row.item.entryId === sections.currentPlaylistEntryId}
                      isLive={row.item.entryId === sections.currentOutputPlaylistEntryId}
                    />
                  : <GridSlideRow
                      row={row}
                      sections={sections}
                      gridItemSize={gridItemSize}
                      getThumbnailScene={getThumbnailScene}
                    />}
              </div>
            );
          })}
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar>
        <ScrollArea.Thumb />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}
