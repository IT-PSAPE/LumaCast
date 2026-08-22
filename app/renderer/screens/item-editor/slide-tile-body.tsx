import type { CSSProperties, HTMLAttributes, Ref } from 'react';
import { ContextMenu, useContextMenuTrigger } from '../../components/overlays/context-menu';
import { useConfirm } from '../../components/overlays/confirm-dialog';
import { Thumbnail } from '../../components/display/thumbnail';
import { SceneFrame } from '@renderer/components/display/scene-frame';
import { LazySceneStage } from '@renderer/components/display/lazy-scene-stage';
import { Play } from 'lucide-react';
import { useScrollAreaActiveItem } from '@renderer/components/layout/scroll-area';
import type { Id } from '@lumacast/kernel';
import type { RenderScene } from '@lumacast/composition';
import { useItemEditorScreen } from './screen-context';

export interface SlideTileProps {
  slideId: Id;
  scene: RenderScene;
  index: number;
  isActive: boolean;
  isLive: boolean;
  isEmpty: boolean;
  textPreview: string;
  onSelect: () => void;
  containerRef?: Ref<HTMLDivElement>;
  containerStyle?: CSSProperties;
  dragging?: boolean;
  dragHandleProps?: HTMLAttributes<HTMLElement>;
  overlay?: boolean;
}

export function SlideTileBody({
  slideId,
  scene,
  index,
  isActive,
  isLive,
  isEmpty,
  textPreview,
  onSelect,
  containerRef,
  containerStyle,
  dragging = false,
  dragHandleProps,
  overlay = false,
}: SlideTileProps) {
  const { state, actions } = useItemEditorScreen();
  const confirm = useConfirm();
  const isFirst = index === 0;
  const isLast = index === state.slides.length - 1;
  const activeRef = useScrollAreaActiveItem<HTMLDivElement>(isActive && !overlay);
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger({ disabled: overlay });

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete slide ${index + 1}?`,
      description: 'This slide and all its elements will be permanently removed.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) await actions.deleteSlide(slideId);
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
        className={dragging ? 'cursor-grabbing opacity-70 shadow-lg' : 'cursor-grab active:cursor-grabbing'}
        onClick={overlay ? undefined : onSelect}
        onDoubleClick={overlay ? undefined : onSelect}
        selected={isActive}
      >
        <Thumbnail.Body>
          <SceneFrame width={scene.width} height={scene.height} className="bg-tertiary" stageClassName="absolute inset-0" checkerboard>
            {isEmpty && (
              <div className="absolute inset-0 z-10 grid place-items-center text-sm uppercase tracking-wider text-tertiary">
                Empty
              </div>
            )}
            <LazySceneStage scene={scene} surface="list" className="absolute inset-0" />
          </SceneFrame>
        </Thumbnail.Body>
        {isLive && (
          <Thumbnail.Overlay position="top-left">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-[2px] bg-brand_solid text-white shadow-sm">
              <Play size={12} strokeWidth={1.9} />
            </span>
          </Thumbnail.Overlay>
        )}
        <Thumbnail.Caption>
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-sm font-semibold tabular-nums text-secondary">{index + 1}</span>
            <span className="min-w-0 truncate text-sm text-tertiary">{textPreview}</span>
          </div>
        </Thumbnail.Caption>
      </Thumbnail.Tile>
      {!overlay ? (
        <ContextMenu.Portal>
          <ContextMenu.Menu>
            <ContextMenu.Item onSelect={() => { void actions.duplicateSlide(slideId); }}>Duplicate</ContextMenu.Item>
            <ContextMenu.Item disabled={isFirst} onSelect={() => { void actions.moveSlide(slideId, 'up'); }}>Move up</ContextMenu.Item>
            <ContextMenu.Item disabled={isLast} onSelect={() => { void actions.moveSlide(slideId, 'down'); }}>Move down</ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item variant="destructive" onSelect={() => { void handleDelete(); }}>Delete</ContextMenu.Item>
          </ContextMenu.Menu>
        </ContextMenu.Portal>
      ) : null}
    </>
  );
}
