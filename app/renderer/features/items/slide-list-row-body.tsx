import type { CSSProperties, HTMLAttributes, Ref } from 'react';
import type { Id } from '@lumacast/kernel';
import { cn } from '@renderer/utils/cn';
import { LazySceneStage } from '@renderer/components/display/lazy-scene-stage';
import { RenameField } from '@renderer/components/form/rename-field';
import { ContextMenu, useContextMenuTrigger } from '../../components/overlays/context-menu';
import { useConfirm } from '../../components/overlays/confirm-dialog';
import { SceneFrame } from '@renderer/components/display/scene-frame';
import { Thumbnail } from '@renderer/components/display/thumbnail';
import { useScrollAreaActiveItem } from '@renderer/components/layout/scroll-area';
import { useSlides } from '../../contexts/slide-context';
import { SlideAutomationMenu } from '../automation/slide-automation-menu';
import { SlideBindingsBadge } from '../automation/slide-bindings-badge';
import { SlideBindingsMenu } from '../automation/slide-bindings-menu';
import { Play } from 'lucide-react';
import type { OutlineSlideRow } from './use-slide-list-view';
import type { RenderScene } from '@lumacast/composition';

export interface SlideOutlineRowProps {
  row: OutlineSlideRow;
  scene: RenderScene;
  isFocused: boolean;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
  onTextCommit: (slideId: Id, nextText: string) => void;
  containerRef?: Ref<HTMLDivElement>;
  containerStyle?: CSSProperties;
  dragging?: boolean;
  dragHandleProps?: HTMLAttributes<HTMLElement>;
  overlay?: boolean;
}

export function SlideOutlineRowBody({
  row,
  scene,
  isFocused,
  onSelect,
  onOpen,
  onTextCommit,
  containerRef,
  containerStyle,
  dragging = false,
  dragHandleProps,
  overlay = false,
}: SlideOutlineRowProps) {
  // Gating: this row component is shared between single-mode and continuous-mode
  // browsers. Slide actions live on the slide-context for the *current* deck item;
  // in continuous mode the row may belong to a different deck item, so we disable
  // the menu when the slide isn't part of the active context.
  const { slides, duplicateSlide, deleteSlide, moveSlide } = useSlides();
  const confirm = useConfirm();
  const slideIndex = slides.findIndex((s) => s.id === row.slide.id);
  const slideOwned = slideIndex !== -1;
  const isFirst = slideIndex === 0;
  const isLast = slideIndex === slides.length - 1;

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete slide ${row.index + 1}?`,
      description: 'This slide and all its elements will be permanently removed.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) await deleteSlide(row.slide.id);
  }

  const activeRef = useScrollAreaActiveItem<HTMLDivElement>(isFocused && !overlay);
  const { ref: triggerRef, onContextMenu: triggerContextMenu, ...triggerHandlers } = useContextMenuTrigger({ disabled: overlay || !slideOwned });

  function handleSelect() {
    onSelect(row.index);
  }

  function handleContextMenu(event: React.MouseEvent<HTMLElement>) {
    // Right-click should open the menu only — never change which slide is
    // focused or live (see matching note in slide-grid-tile.tsx).
    triggerContextMenu(event);
  }

  function handleOpen() {
    onOpen(row.index);
  }

  function handleTextCommit(nextText: string) {
    onTextCommit(row.slide.id, nextText);
  }

  function renderRowText() {
    if (!row.textEditable) {
      return (
        <span className="w-full truncate text-md font-medium text-secondary">
          {row.primaryText}
        </span>
      );
    }

    return (
      <RenameField
        value={row.text}
        onValueChange={handleTextCommit} className="label-xs"
      />
    );
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
        onContextMenu={overlay ? undefined : handleContextMenu}
        onDoubleClick={overlay || row.textEditable ? undefined : handleOpen}
        variant="slide"
        selected={isFocused}
        className={cn('bg-transparent', dragging ? 'cursor-grabbing opacity-70 shadow-lg' : 'cursor-grab')}
      >
        <Thumbnail.Preview className="border-secondary">
          <SceneFrame width={scene.width} height={scene.height} className="bg-tertiary" stageClassName="absolute inset-0">
            {row.elements.length === 0 ? (
              <div className="absolute inset-0 grid place-items-center text-sm uppercase tracking-wider text-tertiary">
                Empty
              </div>
            ) : null}
            <LazySceneStage scene={scene} surface="list" className="absolute inset-0" />
          </SceneFrame>
        </Thumbnail.Preview>
        <Thumbnail.Body className={row.textEditable ? 'content-start' : 'content-center'}>
          <>
            <div className={cn('flex gap-2', row.textEditable ? 'items-start' : 'items-center')}>
              <span className="shrink-0 text-sm font-normal tabular-nums text-tertiary">{row.index + 1}.</span>
              {renderRowText()}
            </div>

            {!row.textEditable && row.secondaryText ? (
              <p className="m-0 truncate text-sm text-tertiary" title={row.secondaryText}>
                {row.secondaryText}
              </p>
            ) : null}
          </>
        </Thumbnail.Body>
        {row.state === 'live' ? (
          <Thumbnail.Overlay position="top-right" className="right-2 top-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-[2px] bg-brand_solid text-white shadow-sm">
              <Play size={12} strokeWidth={1.9} />
            </span>
          </Thumbnail.Overlay>
        ) : null}
        <Thumbnail.Overlay position="bottom-left" className="bottom-2 left-2">
          <SlideBindingsBadge slideId={row.slide.id} />
        </Thumbnail.Overlay>
      </Thumbnail.Row>
      {slideOwned && !overlay && (
        <ContextMenu.Portal>
          <ContextMenu.Menu>
            <ContextMenu.Item onSelect={() => { void duplicateSlide(row.slide.id); }}>Duplicate</ContextMenu.Item>
            <ContextMenu.Item disabled={isFirst} onSelect={() => { void moveSlide(row.slide.id, 'up'); }}>Move up</ContextMenu.Item>
            <ContextMenu.Item disabled={isLast} onSelect={() => { void moveSlide(row.slide.id, 'down'); }}>Move down</ContextMenu.Item>
            <ContextMenu.Separator />
            <SlideAutomationMenu slideId={row.slide.id} />
            <SlideBindingsMenu slideId={row.slide.id} />
            <ContextMenu.Separator />
            <ContextMenu.Item variant="destructive" onSelect={() => { void handleDelete(); }}>Delete</ContextMenu.Item>
          </ContextMenu.Menu>
        </ContextMenu.Portal>
      )}
    </>
  );
}
