import { useEffect, useRef } from 'react';
import { ItemIcon } from '../../components/display/entity-icon';
import { Thumbnail } from '../../components/display/thumbnail';
import { RenameField, type RenameFieldHandle } from '../../components/form/rename-field';
import { useContextMenuTrigger } from '../../components/overlays/context-menu';
import { useProjectContent } from '../../contexts/use-project-content';
import { writeItemDragData } from '../../utils/item-drag';
import { buildThumbnailScene } from '../canvas/build-render-scene';
import type { ItemLike, ItemProps } from './item-bin-types';
import { ItemContextMenuItems } from './item-context-menu-items';
import { ScenePreview } from './scene-preview';
import { useDeleteItem } from './use-delete-item';
import { useDuplicateItem } from './use-duplicate-item';

export function ItemBinTileBody<T extends ItemLike>({ item, itemRef, slides, isSelected, isEditing, isFirst, isLast, onOpen, onRename, onMove }: ItemProps<T>) {
  const { slideElementsBySlideId } = useProjectContent();
  const firstSlide = slides[0] ?? null;
  const firstSlideElements = firstSlide ? slideElementsBySlideId.get(firstSlide.id) ?? [] : [];
  const scene = firstSlide ? buildThumbnailScene(firstSlide, firstSlideElements) : null;
  const renameRef = useRef<RenameFieldHandle>(null);
  const handleDelete = useDeleteItem(itemRef, item.title);
  const handleDuplicate = useDuplicateItem(itemRef, item.title);
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger({ onDelete: () => { void handleDelete(); } });

  useEffect(() => {
    if (isEditing) renameRef.current?.startEditing();
  }, [isEditing]);

  function handleOpen() {
    onOpen(itemRef);
  }

  function handleDragStart(event: React.DragEvent<HTMLElement>) {
    writeItemDragData(event.dataTransfer, itemRef);
  }

  function handleRename(title: string) {
    onRename(itemRef, title);
  }

  return (
    <>
      <div
        {...triggerHandlers}
        ref={triggerRef}
        className="group cursor-grab rounded-xs focus-visible:ring-2 focus-visible:ring-brand"
        draggable
        onDragStart={handleDragStart}
      >
        <Thumbnail.Tile onClick={handleOpen} selected={isSelected}>
          <Thumbnail.Body>
            <ScenePreview scene={scene} />
          </Thumbnail.Body>
          <Thumbnail.Caption>
            <div className="flex items-center gap-2">
              <ItemIcon entity={itemRef} className="shrink-0 text-tertiary" size={14} strokeWidth={1.75} />
              <RenameField
                ref={renameRef}
                value={item.title}
                onValueChange={handleRename} className="label-xs"
              />
            </div>
          </Thumbnail.Caption>
        </Thumbnail.Tile>
      </div>
      <ItemContextMenuItems
        itemRef={itemRef}
        renameRef={renameRef}
        isFirst={isFirst}
        isLast={isLast}
        onMove={onMove}
        onDelete={() => { void handleDelete(); }}
        onDuplicate={handleDuplicate ? () => { void handleDuplicate(); } : undefined}
      />
    </>
  );
}
