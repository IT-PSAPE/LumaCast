import type { CSSProperties, HTMLAttributes, Ref } from 'react';
import type { Id } from '@lumacast/kernel';
import type { RenderScene } from '@lumacast/composition';
import { Play } from 'lucide-react';
import { ContextMenu, useContextMenuTrigger } from '../../components/overlays/context-menu';
import { Thumbnail } from '../../components/display/thumbnail';
import { SceneFrame } from '@renderer/components/display/scene-frame';
import { LazySceneStage } from '@renderer/components/display/lazy-scene-stage';
import { useScrollAreaActiveItem } from '@renderer/components/layout/scroll-area';
import { useProjectContent } from '../../contexts/use-project-content';
import { getLabelColors } from '../../utils/label-colors';
import { SlideActionsMenu } from '../../features/items/slide-actions-menu';

export interface SlideTileProps {
  slideId: Id;
  scene: RenderScene;
  index: number;
  isActive: boolean;
  isSelected: boolean;
  isLive: boolean;
  isEmpty: boolean;
  actionSlideIds: Id[];
  onSelect: (extendRange: boolean) => void;
  containerRef?: Ref<HTMLDivElement>;
  containerStyle?: CSSProperties;
  dragging?: boolean;
  dragHandleProps?: HTMLAttributes<HTMLElement>;
  overlay?: boolean;
}

export function SlideTileBody({ slideId, scene, index, isActive, isSelected, isLive, isEmpty, actionSlideIds, onSelect, containerRef, containerStyle, dragging = false, dragHandleProps, overlay = false }: SlideTileProps) {
  const { slides, slideTagsById } = useProjectContent();
  const slide = slides.find((entry) => entry.id === slideId);
  const tagColors = getLabelColors(slide?.tagId ? slideTagsById.get(slide.tagId)?.colorKey ?? null : null);
  const activeRef = useScrollAreaActiveItem<HTMLDivElement>(isActive && !overlay);
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger({ disabled: overlay });

  return (
    <>
      <Thumbnail.Tile
        {...triggerHandlers}
        {...dragHandleProps}
        ref={(node) => {
          activeRef.current = node;
          triggerRef(node);
          if (typeof containerRef === 'function') containerRef(node);
          else if (containerRef) containerRef.current = node;
        }}
        style={containerStyle}
        className={dragging ? 'select-none cursor-grabbing shadow-lg' : 'select-none cursor-grab active:cursor-grabbing'}
        onClick={overlay ? undefined : (event) => onSelect(event.shiftKey)}
        onDoubleClick={overlay ? undefined : (event) => { if (!event.shiftKey) onSelect(false); }}
        selected={isSelected}
      >
        <Thumbnail.Body>
          <SceneFrame width={scene.width} height={scene.height} className="bg-tertiary" stageClassName="absolute inset-0" checkerboard>
            {isEmpty ? <div className="absolute inset-0 z-10 grid place-items-center text-sm uppercase tracking-wider text-tertiary">Empty</div> : null}
            <LazySceneStage scene={scene} surface="list" className="absolute inset-0" />
          </SceneFrame>
        </Thumbnail.Body>
        {isLive ? (
          <Thumbnail.Overlay position="top-left">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-[2px] bg-brand text-white shadow-sm"><Play size={12} strokeWidth={1.9} /></span>
          </Thumbnail.Overlay>
        ) : null}
        <Thumbnail.Caption style={tagColors ?? undefined}>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-secondary">{index + 1}</span>
        </Thumbnail.Caption>
      </Thumbnail.Tile>
      {!overlay ? (
        <ContextMenu.Portal><ContextMenu.Menu><SlideActionsMenu slideIds={actionSlideIds} /></ContextMenu.Menu></ContextMenu.Portal>
      ) : null}
    </>
  );
}
