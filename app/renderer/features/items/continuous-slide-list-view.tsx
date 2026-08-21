import { useCallback, useMemo, useRef } from 'react';
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import type { Id } from '@lumacast/kernel';
import type { Slide } from '@lumacast/composition';
import { ScrollArea } from '../../components/layout/scroll-area';
import { useRenderScenes } from '../../contexts/canvas/canvas-context';
import { useContinuousSlideSections } from './use-continuous-slide-sections';
import { useSlideOutlineTextEditing } from './use-slide-outline-text-editing';
import type { OutlineSlideRow } from './use-slide-list-view';
import { SlideOutlineRow } from './slide-list-row';
import type { PlaylistDeckSequenceItem } from './use-playlist-deck-sequence';
import { ContinuousSectionHeader } from './continuous-section-header';
import { getSlideVisualState, slideTextDetails } from '../../utils/slides';

// ─── Row model for the virtualized list ──────────────────────────

type ListRow =
  | { kind: 'header'; key: string; item: PlaylistDeckSequenceItem }
  | { kind: 'slide'; key: string; item: PlaylistDeckSequenceItem; slide: Slide; index: number };

// Estimated row sizes for the virtualizer's first paint. Real heights are
// observed via measureElement after mount.
const HEADER_ROW_ESTIMATE = 36;
const LIST_SLIDE_ROW_ESTIMATE = 56;
const VIRTUAL_OVERSCAN = 6;

export function ContinuousSlideListView({ items }: { items: PlaylistDeckSequenceItem[] }) {
  const sections = useContinuousSlideSections();
  const { getThumbnailScene } = useRenderScenes();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const { updateText } = useSlideOutlineTextEditing();

  const rows = useMemo<ListRow[]>(() => {
    const result: ListRow[] = [];
    for (const item of items) {
      result.push({ kind: 'header', key: `h-${item.entryId}`, item });
      item.slides.forEach((slide, index) => {
        result.push({ kind: 'slide', key: `${item.entryId}-${slide.id}`, item, slide, index });
      });
    }
    return result;
  }, [items]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: (index) => (rows[index].kind === 'header' ? HEADER_ROW_ESTIMATE : LIST_SLIDE_ROW_ESTIMATE),
    overscan: VIRTUAL_OVERSCAN,
    getItemKey: (index) => rows[index].key,
  });

  const renderListSlide = useCallback((row: Extract<ListRow, { kind: 'slide' }>) => {
    const isCurrentPresentation = row.item.entryId === sections.currentPlaylistEntryId;
    const isLivePresentation = row.item.entryId === sections.currentOutputPlaylistEntryId;
    const elements = sections.slideElementsBySlideId.get(row.slide.id) ?? [];
    const details = slideTextDetails(elements);
    const scene = getThumbnailScene(row.slide.id, 'list');
    if (!scene) return null;
    const textEditable = row.item.itemRef.type === 'lyric';
    const outlineRow = {
      slide: row.slide,
      index: row.index,
      state: getSlideVisualState(
        row.index,
        isLivePresentation ? sections.liveSlideIndex : -1,
        isCurrentPresentation ? sections.currentSlideIndex : -1,
        elements,
      ),
      elements,
      text: details.text,
      primaryText: details.primaryLine,
      secondaryText: details.secondaryLine,
      textElementId: details.textElement?.id ?? null,
      textEditable,
    } satisfies OutlineSlideRow;

    function handleSelect() {
      sections.handleActivateSlide(row.item.entryId, row.item.itemRef, row.index);
    }
    function handleOpen() {
      sections.handleEditSlide(row.item.entryId, row.item.itemRef, row.index);
    }
    function handleTextCommit(_slideId: Id, nextText: string) {
      updateText({
        elements: outlineRow.elements,
        nextText,
        slideIndex: outlineRow.index,
        textEditable: outlineRow.textEditable,
        textElementId: outlineRow.textElementId,
      });
    }

    return (
      <div className="px-2">
        <SlideOutlineRow
          row={outlineRow}
          scene={scene}
          isFocused={isCurrentPresentation && row.index === sections.currentSlideIndex}
          onSelect={handleSelect}
          onOpen={handleOpen}
          onTextCommit={handleTextCommit}
        />
      </div>
    );
  }, [sections, getThumbnailScene, updateText]);

  return (
    <ScrollArea.Root>
      <ScrollArea.Viewport ref={viewportRef} style={{ contain: 'strict' }}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtualizer.getVirtualItems().map((virtualRow: VirtualItem) => {
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
              >
                {row.kind === 'header'
                  ? <ContinuousSectionHeader
                      item={row.item}
                      isCurrent={row.item.entryId === sections.currentPlaylistEntryId}
                      isLive={row.item.entryId === sections.currentOutputPlaylistEntryId}
                    />
                  : renderListSlide(row)}
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
