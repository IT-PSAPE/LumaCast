import { useCallback, useMemo, useRef } from 'react';
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import { isLyricDeckItem } from '@core/deck-items';
import type { Id, Slide } from '@core/types';
import { Label } from '@renderer/components/display/text';
import { EmptyState } from '../../components/display/empty-state';
import { ScrollArea } from '../../components/layout/scroll-area';
import { useRenderScenes } from '../../contexts/canvas/canvas-context';
import { getSlideVisualState, slideTextDetails, slideTextPreview } from '../../utils/slides';
import type { RenderScene, SceneSurface } from '../canvas/scene-types';
import { ContinuousSlideGridTile } from './continuous-slide-grid-tile';
import { useContinuousSlideSections } from './use-continuous-slide-sections';
import { useDeckBrowser } from './deck-browser-context';
import type { PlaylistDeckSequenceItem } from './use-playlist-deck-sequence';
import { useSlideOutlineTextEditing } from './use-slide-outline-text-editing';
import type { OutlineSlideRow } from './use-slide-list-view';
import { SlideOutlineRow } from './slide-list-row';
import type { SlideBrowserContentVariant } from './use-deck-browser-view';

interface ContinuousSlideBrowserProps {
  items: PlaylistDeckSequenceItem[];
  variant: SlideBrowserContentVariant;
}

// ─── Row models for the virtualized lists ──────────────────────────

type ListRow =
  | { kind: 'header'; key: string; item: PlaylistDeckSequenceItem }
  | { kind: 'slide'; key: string; item: PlaylistDeckSequenceItem; slide: Slide; index: number };

type GridRow =
  | { kind: 'header'; key: string; item: PlaylistDeckSequenceItem }
  | {
      kind: 'slide-row';
      key: string;
      item: PlaylistDeckSequenceItem;
      slides: { slide: Slide; index: number }[];
    };

// Estimated row sizes for the virtualizer's first paint. Real heights are
// observed via measureElement after mount.
const HEADER_ROW_ESTIMATE = 36;
const LIST_SLIDE_ROW_ESTIMATE = 56;
const GRID_ROW_ESTIMATE = 160;
const VIRTUAL_OVERSCAN = 6;

export function ContinuousSlideBrowser({ items, variant }: ContinuousSlideBrowserProps) {
  if (variant !== 'continuous-grid' && variant !== 'continuous-list') return null;

  if (items.length === 0) {
    return (
      <EmptyState.Root>
        <EmptyState.Title>No playlist items available.</EmptyState.Title>
      </EmptyState.Root>
    );
  }

  return variant === 'continuous-grid'
    ? <ContinuousSlideGridView items={items} />
    : <ContinuousSlideListView items={items} />;
}

// ─── Grid view ──────────────────────────────────────────────────────

function ContinuousSlideGridView({ items }: { items: PlaylistDeckSequenceItem[] }) {
  const sections = useContinuousSlideSections();
  const { gridItemSize } = useDeckBrowser();
  const { getThumbnailScene } = useRenderScenes();
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
    <ScrollArea.Root>
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

interface GridSlideRowProps {
  row: Extract<GridRow, { kind: 'slide-row' }>;
  sections: ReturnType<typeof useContinuousSlideSections>;
  gridItemSize: number;
  getThumbnailScene: (slideId: Id, surface: SceneSurface) => RenderScene | null;
}

function GridSlideRow({ row, sections, gridItemSize, getThumbnailScene }: GridSlideRowProps) {
  const isCurrentPresentation = row.item.entryId === sections.currentPlaylistEntryId;
  const isLivePresentation = row.item.entryId === sections.currentOutputPlaylistEntryId;
  return (
    <div
      className="grid gap-1.5 px-2 py-1"
      style={{ gridTemplateColumns: `repeat(${gridItemSize}, minmax(0, 1fr))` }}
      role="grid"
      aria-label={`${row.item.item.title} slides`}
    >
      {row.slides.map(({ slide, index }) => {
        const elements = sections.slideElementsBySlideId.get(slide.id) ?? [];
        const state = getSlideVisualState(
          index,
          isLivePresentation ? sections.liveSlideIndex : -1,
          isCurrentPresentation ? sections.currentSlideIndex : -1,
          elements,
        );
        const scene = getThumbnailScene(slide.id, 'list');
        if (!scene) return null;
        return (
          <ContinuousSlideGridTile
            key={slide.id}
            entryId={row.item.entryId}
            itemId={row.item.item.id}
            index={index}
            scene={scene}
            selected={isCurrentPresentation && index === sections.currentSlideIndex}
            isLive={state === 'live'}
            isEmpty={state === 'warning'}
            textPreview={slideTextPreview(elements)}
            onActivate={sections.handleActivateSlide}
            onEdit={sections.handleEditSlide}
          />
        );
      })}
    </div>
  );
}

// ─── List view ──────────────────────────────────────────────────────

function ContinuousSlideListView({ items }: { items: PlaylistDeckSequenceItem[] }) {
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
    const textEditable = isLyricDeckItem(row.item.item);
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
      sections.handleActivateSlide(row.item.entryId, row.item.item.id, row.index);
    }
    function handleOpen() {
      sections.handleEditSlide(row.item.entryId, row.item.item.id, row.index);
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

// ─── Section header ─────────────────────────────────────────────────

function ContinuousSectionHeader({ item, isCurrent, isLive = false }: { item: PlaylistDeckSequenceItem; isCurrent: boolean; isLive?: boolean }) {
  return (
    <div className="z-10 flex h-9 w-full items-center gap-2 border-b border-primary bg-tertiary px-2 py-1">
      <div className="flex min-w-0 items-center gap-2">
        <Label.xs className="mr-auto truncate font-medium text-primary">{item.item.title}</Label.xs>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {isCurrent ? <span className="rounded-sm bg-brand_solid/20 px-1.5 py-0.5 text-[10px] font-medium uppercase text-brand_solid">Current</span> : null}
          {isLive ? <span className="rounded-sm bg-error_primary/20 px-1.5 py-0.5 text-[10px] font-medium uppercase text-error">Live</span> : null}
        </div>
      </div>
    </div>
  );
}
