import type { CSSProperties, HTMLAttributes, Ref } from 'react';
import type { Id } from '@lumacast/kernel';
import type { RenderScene } from '@lumacast/composition';
import { Play } from 'lucide-react';
import { cn } from '@renderer/utils/cn';
import { LazySceneStage } from '@renderer/components/display/lazy-scene-stage';
import { ContextMenu, useContextMenuTrigger } from '../../components/overlays/context-menu';
import { SceneFrame } from '@renderer/components/display/scene-frame';
import { Thumbnail } from '@renderer/components/display/thumbnail';
import { useScrollAreaActiveItem } from '@renderer/components/layout/scroll-area';
import { useProjectContent } from '../../contexts/use-project-content';
import { getLabelColors } from '../../utils/label-colors';
import { SlideBindingsBadge } from '../automation/slide-bindings-badge';
import type { OutlineSlideRow } from './use-slide-list-view';
import { SlideActionsMenu } from './slide-actions-menu';

export interface SlideOutlineRowProps {
  row: OutlineSlideRow;
  scene: RenderScene;
  isFocused: boolean;
  isSelected: boolean;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
  onRangeSelect: (index: number, extendRange: boolean) => void;
  actionSlideIds: Id[];
  containerRef?: Ref<HTMLDivElement>;
  containerStyle?: CSSProperties;
  dragging?: boolean;
  dragHandleProps?: HTMLAttributes<HTMLElement>;
  overlay?: boolean;
}

export function SlideOutlineRowBody({ row, scene, isFocused, isSelected, onSelect, onOpen, onRangeSelect, actionSlideIds, containerRef, containerStyle, dragging = false, dragHandleProps, overlay = false }: SlideOutlineRowProps) {
  const { slides, slideTagsById } = useProjectContent();
  const slideOwned = slides.some((slide) => slide.id === row.slide.id);
  const tagColors = getLabelColors(row.slide.tagId ? slideTagsById.get(row.slide.tagId)?.colorKey ?? null : null);
  const activeRef = useScrollAreaActiveItem<HTMLDivElement>(isFocused && !overlay);
  const { ref: triggerRef, onContextMenu: triggerContextMenu, ...triggerHandlers } = useContextMenuTrigger({ disabled: overlay || !slideOwned });

  function handleSelect(event: React.MouseEvent<HTMLElement>) {
    onRangeSelect(row.index, event.shiftKey);
    if (!event.shiftKey) onSelect(row.index);
  }

  return (
    <>
      <Thumbnail.Row
        {...triggerHandlers}
        {...dragHandleProps}
        ref={(node) => {
          activeRef.current = node;
          triggerRef(node);
          if (typeof containerRef === 'function') containerRef(node);
          else if (containerRef) containerRef.current = node;
        }}
        style={containerStyle}
        onClick={overlay ? undefined : handleSelect}
        onContextMenu={overlay ? undefined : triggerContextMenu}
        onDoubleClick={overlay ? undefined : (event) => { if (!event.shiftKey) onOpen(row.index); }}
        variant="slide"
        selected={isSelected}
        className={cn('select-none bg-transparent', dragging ? 'cursor-grabbing shadow-lg' : 'cursor-grab')}
      >
        <Thumbnail.Preview className="border-secondary">
          <SceneFrame width={scene.width} height={scene.height} className="bg-tertiary" stageClassName="absolute inset-0" checkerboard>
            {row.elements.length === 0 ? (
              <div className="absolute inset-0 grid place-items-center text-sm uppercase tracking-wider text-tertiary">Empty</div>
            ) : null}
            <LazySceneStage scene={scene} surface="list" className="absolute inset-0" />
          </SceneFrame>
        </Thumbnail.Preview>
        <Thumbnail.Body className="content-center" style={tagColors ?? undefined}>
          <span className="shrink-0 text-sm font-normal tabular-nums text-tertiary">{row.index + 1}</span>
        </Thumbnail.Body>
        {row.state === 'live' ? (
          <Thumbnail.Overlay position="top-right" className="right-2 top-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-[2px] bg-brand text-white shadow-sm"><Play size={12} strokeWidth={1.9} /></span>
          </Thumbnail.Overlay>
        ) : null}
        <Thumbnail.Overlay position="bottom-left" className="bottom-2 left-2"><SlideBindingsBadge slideId={row.slide.id} /></Thumbnail.Overlay>
      </Thumbnail.Row>
      {slideOwned && !overlay ? (
        <ContextMenu.Portal><ContextMenu.Menu><SlideActionsMenu slideIds={actionSlideIds} /></ContextMenu.Menu></ContextMenu.Portal>
      ) : null}
    </>
  );
}
