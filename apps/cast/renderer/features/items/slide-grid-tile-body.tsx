import type { CSSProperties, HTMLAttributes, Ref } from 'react';
import { Play } from 'lucide-react';
import type { Id } from '@lumacast/kernel';
import { ContextMenu, useContextMenuTrigger } from '@renderer/components/overlays/context-menu';
import { LazySceneStage } from '@renderer/components/display/lazy-scene-stage';
import { SceneFrame } from '@renderer/components/display/scene-frame';
import { Thumbnail } from '@renderer/components/display/thumbnail';
import { useScrollAreaActiveItem } from '@renderer/components/layout/scroll-area';
import { SlideBindingsBadge } from '../automation/slide-bindings-badge';
import type { RenderScene } from '@lumacast/composition';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { getLabelColors } from '@renderer/utils/label-colors';
import { SlideActionsMenu } from './slide-actions-menu';

export interface SlideGridTileProps {
  slideId: Id;
  index: number;
  scene: RenderScene;
  selected: boolean;
  focused: boolean;
  isLive: boolean;
  isEmpty: boolean;
  onActivate: (index: number) => void;
  onFocus: (index: number) => void;
  onRangeSelect: (index: number, extendRange: boolean) => void;
  actionSlideIds: Id[];
  containerRef?: Ref<HTMLDivElement>;
  containerStyle?: CSSProperties;
  dragging?: boolean;
  dragHandleProps?: HTMLAttributes<HTMLElement>;
  overlay?: boolean;
}

export function SlideGridTileBody({
  slideId,
  index,
  scene,
  selected,
  focused,
  isLive,
  isEmpty,
  onActivate,
  onFocus,
  onRangeSelect,
  actionSlideIds,
  containerRef,
  containerStyle,
  dragging = false,
  dragHandleProps,
  overlay = false,
}: SlideGridTileProps) {
  const { slides, slideTagsById } = useProjectContent();
  const slide = slides.find((entry) => entry.id === slideId);
  const tagColors = getLabelColors(slide?.tagId ? slideTagsById.get(slide.tagId)?.colorKey ?? null : null);
  const activeRef = useScrollAreaActiveItem<HTMLDivElement>(focused && !overlay);
  const { ref: triggerRef, onContextMenu: triggerContextMenu, ...triggerHandlers } = useContextMenuTrigger({ disabled: overlay });

  function handleClick(event: React.MouseEvent<HTMLElement>) {
    onRangeSelect(index, event.shiftKey);
    if (event.shiftKey) return;
    onActivate(index);
  }

  function handleDoubleClick(event: React.MouseEvent<HTMLElement>) {
    if (event.shiftKey) return;
    onFocus(index);
  }

  function handleContextMenu(event: React.MouseEvent<HTMLElement>) {
    // Right-click only opens the context menu — it must not activate the
    // slide. Operators routinely right-click on slides they have NOT staged
    // (to attach automation, delete, etc.), and switching the live slide
    // out from under them would be destructive.
    triggerContextMenu(event);
  }

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
        onClick={overlay ? undefined : handleClick}
        onContextMenu={overlay ? undefined : handleContextMenu}
        onDoubleClick={overlay ? undefined : handleDoubleClick}
        selected={selected}
        variant="slide"
        className={dragging ? 'select-none cursor-grabbing shadow-lg' : 'select-none cursor-grab'}
      >
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
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-[2px] bg-brand text-white shadow-sm">
              <Play size={12} strokeWidth={1.9} />
            </span>
          </Thumbnail.Overlay>
        ) : null}
        <Thumbnail.Overlay position="top-right">
          <SlideBindingsBadge slideId={slideId} />
        </Thumbnail.Overlay>
        <Thumbnail.Caption className="border-secondary py-0.5" style={tagColors ?? undefined}>
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-sm font-normal tabular-nums text-tertiary">{index + 1}</span>
          </div>
        </Thumbnail.Caption>
      </Thumbnail.Tile>
      {!overlay ? (
        <ContextMenu.Portal>
          <ContextMenu.Menu>
            <SlideActionsMenu slideIds={actionSlideIds} />
          </ContextMenu.Menu>
        </ContextMenu.Portal>
      ) : null}
    </>
  );
}
