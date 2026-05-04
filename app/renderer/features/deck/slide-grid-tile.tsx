import { memo, type ButtonHTMLAttributes, type CSSProperties, type Ref } from 'react';
import { GripVertical, Play } from 'lucide-react';
import type { Id } from '@core/types';
import { ContextMenu, useContextMenuTrigger } from '@renderer/components/overlays/context-menu';
import { useConfirm } from '@renderer/components/overlays/confirm-dialog';
import { LazySceneStage } from '@renderer/components/display/lazy-scene-stage';
import { SceneFrame } from '@renderer/components/display/scene-frame';
import { Thumbnail } from '@renderer/components/display/thumbnail';
import { useScrollAreaActiveItem } from '@renderer/components/layout/scroll-area';
import { useSlides } from '@renderer/contexts/slide-context';
import type { RenderScene } from '../canvas/scene-types';

interface SlideGridTileProps {
  slideId: Id;
  index: number;
  scene: RenderScene;
  selected: boolean;
  isLive: boolean;
  isEmpty: boolean;
  textPreview: string;
  onActivate: (index: number) => void;
  onFocus: (index: number) => void;
  containerRef?: Ref<HTMLDivElement>;
  containerStyle?: CSSProperties;
  dragging?: boolean;
  dragHandleProps?: ButtonHTMLAttributes<HTMLButtonElement>;
}

function SlideGridTileImpl(props: SlideGridTileProps) {
  return (
    <ContextMenu.Root>
      <SlideGridTileBody {...props} />
    </ContextMenu.Root>
  );
}

function SlideGridTileBody({
  slideId,
  index,
  scene,
  selected,
  isLive,
  isEmpty,
  textPreview,
  onActivate,
  onFocus,
  containerRef,
  containerStyle,
  dragging = false,
  dragHandleProps,
}: SlideGridTileProps) {
  const { slides, duplicateSlide, deleteSlide, moveSlide } = useSlides();
  const confirm = useConfirm();
  const isFirst = index === 0;
  const isLast = index === slides.length - 1;
  const activeRef = useScrollAreaActiveItem<HTMLDivElement>(selected);
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger();

  function handleClick() {
    onActivate(index);
  }

  function handleDoubleClick() {
    onFocus(index);
  }

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete slide ${index + 1}?`,
      description: 'This slide and all its elements will be permanently removed.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) await deleteSlide(slideId);
  }

  return (
    <>
      <Thumbnail.Tile
        {...triggerHandlers}
        ref={(node) => {
          activeRef.current = node;
          triggerRef(node);
          if (typeof containerRef === 'function') containerRef(node);
          else if (containerRef) containerRef.current = node;
        }}
        style={containerStyle}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        selected={selected}
        className={dragging ? 'opacity-70 shadow-lg' : undefined}
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
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-[2px] bg-brand_solid text-white shadow-sm">
              <Play size={12} strokeWidth={1.9} />
            </span>
          </Thumbnail.Overlay>
        ) : null}
        <Thumbnail.Overlay position="top-right" className="right-2 top-2">
          <button
            type="button"
            {...dragHandleProps}
            onClick={(event) => { event.stopPropagation(); }}
            className="inline-flex h-5 w-5 cursor-grab items-center justify-center rounded-[2px] bg-black/45 text-white/85 shadow-sm transition-colors hover:bg-black/60 active:cursor-grabbing"
            title="Reorder slide"
            aria-label={`Reorder slide ${index + 1}`}
          >
            <GripVertical size={12} strokeWidth={1.9} />
          </button>
        </Thumbnail.Overlay>
        <Thumbnail.Caption>
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-sm font-semibold tabular-nums text-secondary">{index + 1}</span>
            <span className="min-w-0 truncate text-sm text-tertiary">{textPreview}</span>
          </div>
        </Thumbnail.Caption>
      </Thumbnail.Tile>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          <ContextMenu.Item onSelect={() => { void duplicateSlide(slideId); }}>Duplicate</ContextMenu.Item>
          <ContextMenu.Item disabled={isFirst} onSelect={() => { void moveSlide(slideId, 'up'); }}>Move up</ContextMenu.Item>
          <ContextMenu.Item disabled={isLast} onSelect={() => { void moveSlide(slideId, 'down'); }}>Move down</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item variant="destructive" onSelect={() => { void handleDelete(); }}>Delete</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}

export const SlideGridTile = memo(SlideGridTileImpl);
