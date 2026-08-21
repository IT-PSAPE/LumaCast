import type { Id } from '@lumacast/kernel';
import type { RenderScene, SceneSurface, Slide } from '@lumacast/composition';
import { ThumbnailGrid } from '@renderer/components/layout/thumbnail-grid';
import { getSlideVisualState, slideTextPreview } from '../../utils/slides';
import { ContinuousSlideGridTile } from './continuous-slide-grid-tile';
import { useContinuousSlideSections } from './use-continuous-slide-sections';
import type { PlaylistDeckSequenceItem } from './use-playlist-deck-sequence';

interface GridSlideRowProps {
  row: {
    item: PlaylistDeckSequenceItem;
    slides: { slide: Slide; index: number }[];
  };
  sections: ReturnType<typeof useContinuousSlideSections>;
  gridItemSize: number;
  getThumbnailScene: (slideId: Id, surface: SceneSurface) => RenderScene | null;
}

export function GridSlideRow({ row, sections, gridItemSize, getThumbnailScene }: GridSlideRowProps) {
  const isCurrentPresentation = row.item.entryId === sections.currentPlaylistEntryId;
  const isLivePresentation = row.item.entryId === sections.currentOutputPlaylistEntryId;
  return (
    <ThumbnailGrid
      columns={gridItemSize}
      className="gap-1.5 px-2 py-1"
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
            itemRef={row.item.itemRef}
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
    </ThumbnailGrid>
  );
}
