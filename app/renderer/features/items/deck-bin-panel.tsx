import { useEffect, useRef } from 'react';
import type { Id } from '@lumacast/kernel';
import type { ItemRef, Slide } from '@lumacast/composition';
import { RenameField, type RenameFieldHandle } from '@renderer/components/form/rename-field';
import { ContextMenu, useContextMenuTrigger } from '../../components/overlays/context-menu';
import { useConfirm } from '../../components/overlays/confirm-dialog';
import { ItemIcon } from '../../components/display/entity-icon';
import { SceneFrame } from '../../components/display/scene-frame';
import { SelectableRow } from '../../components/display/selectable-row';
import { Thumbnail } from '../../components/display/thumbnail';
import { Label } from '../../components/display/text';
import { useCast } from '../../contexts/app-context';
import { useNavigation } from '../../contexts/navigation-context';
import { itemRefKey, useProjectContent } from '../../contexts/use-project-content';
import { buildThumbnailScene } from '../canvas/build-render-scene';
import { SceneStage } from '../canvas/scene-stage';
import { BinPanelLayout } from '@renderer/components/layout/collection-layout';
import { useGridSize } from '../../hooks/use-grid-size';
import { BinShell } from '../workbench/bin-shell';
import { useDeckBin, type ItemBinSection } from './use-deck-bin';
import { writeItemDragData } from '../../utils/item-drag';
import type { ResourceDrawerViewMode } from '../../types/ui';

interface ItemLike {
  id: Id;
  title: string;
}

export function DeckBinPanel() {
  const {
    sections,
    editingItemRef,
    browseItem,
    isDetachedDeckBrowser,
    currentDrawerItemRef,
    handleRename,
    handleMove,
    slidesByItem,
    searchValue,
    setSearchValue,
    viewMode,
    setViewMode,
  } = useDeckBin();
  const { gridSize, setGridSize, min, max, step } = useGridSize('lumacast.grid-size.deck-bin', 6, 4, 8);

  return (
    <BinShell
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      searchPlaceholder="Search…"
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      gridSize={gridSize}
      gridSizeMin={min}
      gridSizeMax={max}
      gridSizeStep={step}
      onGridSizeChange={setGridSize}
    >
      <div className="flex flex-col gap-3">
        {sections.map((section) => (
          <ItemBinSectionBody
            key={section.type}
            section={section}
            gridSize={gridSize}
            viewMode={viewMode}
            isDetachedDeckBrowser={isDetachedDeckBrowser}
            currentDrawerItemRef={currentDrawerItemRef}
            editingItemRef={editingItemRef}
            slidesByItem={slidesByItem}
            onOpen={browseItem}
            onRename={handleRename}
            onMove={handleMove}
          />
        ))}
      </div>
    </BinShell>
  );
}

interface ItemBinSectionBodyProps<T extends ItemLike> {
  section: ItemBinSection<T>;
  gridSize: number;
  viewMode: ResourceDrawerViewMode;
  isDetachedDeckBrowser: boolean;
  currentDrawerItemRef: ItemRef | null;
  editingItemRef: ItemRef | null;
  slidesByItem: ReadonlyMap<string, Slide[]>;
  onOpen: (itemRef: ItemRef) => void;
  onRename: (itemRef: ItemRef, title: string) => void;
  onMove: (itemRef: ItemRef, direction: 'up' | 'down') => void;
}

function ItemBinSectionBody<T extends ItemLike>({
  section,
  gridSize,
  viewMode,
  isDetachedDeckBrowser,
  currentDrawerItemRef,
  editingItemRef,
  slidesByItem,
  onOpen,
  onRename,
  onMove,
}: ItemBinSectionBodyProps<T>) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label.xs className="px-1 text-tertiary">{section.label}</Label.xs>
      {section.items.length === 0 ? (
        <div className="px-1 text-xs text-tertiary">No {section.label.toLowerCase()} yet.</div>
      ) : (
        <BinPanelLayout gridItemSize={gridSize} mode={viewMode}>
          {section.items.map((item, index) => {
            const itemRef: ItemRef = { type: section.type, id: item.id };
            const shared = {
              item,
              itemRef,
              slides: slidesByItem.get(itemRefKey(itemRef)) ?? [],
              isSelected: isDetachedDeckBrowser && currentDrawerItemRef !== null
                && currentDrawerItemRef.type === section.type && currentDrawerItemRef.id === item.id,
              isEditing: editingItemRef !== null && editingItemRef.type === section.type && editingItemRef.id === item.id,
              isFirst: index === 0,
              isLast: index === section.items.length - 1,
              onOpen,
              onRename,
              onMove,
            };
            return viewMode === 'list'
              ? <ItemBinRow key={item.id} {...shared} />
              : <ItemBinTile key={item.id} {...shared} />;
          })}
        </BinPanelLayout>
      )}
    </div>
  );
}

interface ItemProps<T extends ItemLike> {
  item: T;
  itemRef: ItemRef;
  slides: Slide[];
  isSelected: boolean;
  isEditing: boolean;
  isFirst: boolean;
  isLast: boolean;
  onOpen: (itemRef: ItemRef) => void;
  onRename: (itemRef: ItemRef, title: string) => void;
  onMove: (itemRef: ItemRef, direction: 'up' | 'down') => void;
}

function ItemContextMenuItems({ itemRef, renameRef, isFirst, isLast, onMove, onDelete, onDuplicate }: {
  itemRef: ItemRef;
  renameRef: React.RefObject<RenameFieldHandle | null>;
  isFirst: boolean;
  isLast: boolean;
  onMove: (itemRef: ItemRef, direction: 'up' | 'down') => void;
  onDelete: () => void;
  onDuplicate?: () => void;
}) {
  return (
    <ContextMenu.Portal>
      <ContextMenu.Menu>
        <ContextMenu.Item disabled={isFirst} onSelect={() => onMove(itemRef, 'up')}>Move up</ContextMenu.Item>
        <ContextMenu.Item disabled={isLast} onSelect={() => onMove(itemRef, 'down')}>Move down</ContextMenu.Item>
        <ContextMenu.Separator />
        <ContextMenu.Item onSelect={() => { renameRef.current?.startEditing(); }}>Rename</ContextMenu.Item>
        {onDuplicate && <ContextMenu.Item onSelect={onDuplicate}>Duplicate</ContextMenu.Item>}
        <ContextMenu.Separator />
        <ContextMenu.Item variant="destructive" onSelect={onDelete}>Delete</ContextMenu.Item>
      </ContextMenu.Menu>
    </ContextMenu.Portal>
  );
}

function useDeleteItem(itemRef: ItemRef, title: string) {
  const { deleteItem } = useNavigation();
  const confirm = useConfirm();

  return async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${title}"?`,
      description: 'This permanently removes the item and all its slides. This action cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) await deleteItem(itemRef);
  };
}

// Talks don't support duplication (D1: there is simply no duplicateTalk).
export function useDuplicateItem(itemRef: ItemRef, title: string) {
  const { mutatePatch, setStatusText } = useCast();
  const { browseItem } = useNavigation();

  if (itemRef.type === 'talk') return null;
  const duplicableType = itemRef.type;

  return async function handleDuplicate() {
    try {
      const result = await window.castApi.duplicateItem({ type: duplicableType, id: itemRef.id });
      await mutatePatch(async () => result.patch);
      browseItem({ type: duplicableType, id: result.itemId });
      setStatusText(`Duplicated "${title}"`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusText(`Failed to duplicate: ${message}`);
    }
  };
}

function ItemBinRow<T extends ItemLike>(props: ItemProps<T>) {
  return (
    <ContextMenu.Root>
      <ItemBinRowBody {...props} />
    </ContextMenu.Root>
  );
}

function ItemBinRowBody<T extends ItemLike>({ item, itemRef, slides, isSelected, isEditing, isFirst, isLast, onOpen, onRename, onMove }: ItemProps<T>) {
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
      <SelectableRow.Root
        {...triggerHandlers}
        ref={triggerRef}
        selected={isSelected}
        onClick={handleOpen}
        className="h-9 cursor-grab focus-visible:ring-2 focus-visible:ring-brand"
        draggable
        onDragStart={handleDragStart}
      >
        <SelectableRow.Leading>
          <ItemIcon entity={itemRef} size={14} strokeWidth={1.75} />
        </SelectableRow.Leading>
        <SelectableRow.Label>
          <RenameField ref={renameRef} value={item.title} onValueChange={handleRename} className="label-xs" />
        </SelectableRow.Label>
        <SelectableRow.Trailing>
          <span className="text-xs text-tertiary">{slides.length} {slides.length === 1 ? 'slide' : 'slides'}</span>
        </SelectableRow.Trailing>
      </SelectableRow.Root>
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

function ItemBinTile<T extends ItemLike>(props: ItemProps<T>) {
  return (
    <ContextMenu.Root>
      <ItemBinTileBody {...props} />
    </ContextMenu.Root>
  );
}

function ItemBinTileBody<T extends ItemLike>({ item, itemRef, slides, isSelected, isEditing, isFirst, isLast, onOpen, onRename, onMove }: ItemProps<T>) {
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

function ScenePreview({ scene }: { scene: ReturnType<typeof buildThumbnailScene> | null }) {
  if (!scene) {
    return (
      <div className="absolute inset-0 grid place-items-center bg-tertiary text-sm uppercase tracking-wider text-tertiary">
        Empty
      </div>
    );
  }

  return (
    <SceneFrame width={scene.width} height={scene.height} className="bg-tertiary" stageClassName="absolute inset-0" checkerboard>
      <SceneStage scene={scene} surface="list" className="absolute inset-0 pointer-events-none" />
    </SceneFrame>
  );
}
