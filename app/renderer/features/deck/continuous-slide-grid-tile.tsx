import { memo } from 'react';
import { Play } from 'lucide-react';
import type { Id } from '@core/types';
import { LazySceneStage } from '@renderer/components/display/lazy-scene-stage';
import { SceneFrame } from '@renderer/components/display/scene-frame';
import { Thumbnail } from '@renderer/components/display/thumbnail';
import { useScrollAreaActiveItem } from '@renderer/components/layout/scroll-area';
import type { RenderScene } from '@lumacast/composition';

interface ContinuousSlideGridTileProps {
  entryId: Id;
  itemId: Id;
  index: number;
  scene: RenderScene;
  selected: boolean;
  isLive: boolean;
  isEmpty: boolean;
  textPreview: string;
  onActivate: (entryId: Id, itemId: Id, slideIndex: number) => void;
  onEdit: (entryId: Id, itemId: Id, slideIndex: number) => void;
}

function ContinuousSlideGridTileImpl({ entryId, itemId, index, scene, selected, isLive, isEmpty, textPreview, onActivate, onEdit }: ContinuousSlideGridTileProps) {
  const ref = useScrollAreaActiveItem(selected);

  function handleClick() {
    onActivate(entryId, itemId, index);
  }

  function handleDoubleClick() {
    onEdit(entryId, itemId, index);
  }

  return (
    <Thumbnail.Tile ref={ref} onClick={handleClick} onDoubleClick={handleDoubleClick} selected={selected}>
      <Thumbnail.Body>
        <SceneFrame
          width={scene.width}
          height={scene.height}
          className="bg-tertiary"
          stageClassName="absolute inset-0"
          checkerboard
        >
          {isEmpty ? (
            <div className="absolute inset-0 z-10 grid place-items-center text-sm uppercase tracking-wider text-tertiary">
              Empty
            </div>
          ) : null}
          <LazySceneStage scene={scene} surface="list" className="absolute inset-0" />
        </SceneFrame>
      </Thumbnail.Body>
      {isLive ? (
        <Thumbnail.Overlay position="top-left">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-[2px] bg-brand_solid text-white shadow-sm">
            <Play size={12} strokeWidth={1.9} />
          </span>
        </Thumbnail.Overlay>
      ) : null}
      <Thumbnail.Caption>
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-sm font-semibold tabular-nums text-secondary">{index + 1}</span>
          <span className="min-w-0 truncate text-sm text-tertiary">{textPreview}</span>
        </div>
      </Thumbnail.Caption>
    </Thumbnail.Tile>
  );
}

export const ContinuousSlideGridTile = memo(ContinuousSlideGridTileImpl);
