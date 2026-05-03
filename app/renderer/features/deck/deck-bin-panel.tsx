import { useEffect, useRef } from 'react';
import type { DeckItem, Id, Slide } from '@core/types';
import { RenameField, type RenameFieldHandle } from '@renderer/components/form/rename-field';
import { ContextMenu, useContextMenuTrigger } from '../../components/overlays/context-menu';
import { useConfirm } from '../../components/overlays/confirm-dialog';
import { DeckItemIcon } from '../../components/display/entity-icon';
import { SceneFrame } from '../../components/display/scene-frame';
import { SelectableRow } from '../../components/display/selectable-row';
import { Thumbnail } from '../../components/display/thumbnail';
import { useProjectContent } from '../../contexts/use-project-content';
import { useLibraryPanelManagement } from '../library/use-library-panel-management';
import { buildThumbnailScene } from '../canvas/build-render-scene';
import { SceneStage } from '../canvas/scene-stage';
import { BinPanelLayout } from '@renderer/components/layout/collection-layout';
import { useGridSize } from '../../hooks/use-grid-size';
import { BinShell } from '../workbench/bin-shell';
import type { BinCollectionsApi } from '../workbench/use-bin-collections';
import { useDeckBin } from './use-deck-bin';
import { writeDeckItemDragData } from '../../utils/deck-item-drag';

export function DeckBinPanel() {
  const {
    filteredDeckItems,
    editingDeckItemId,
    browseDeckItem,
    isDetachedDeckBrowser,
    currentDrawerDeckItemId,
    handleRename,
    slidesByDeckItemId,
    collections,
    searchValue,
    setSearchValue,
    viewMode,
    setViewMode,
  } = useDeckBin();
  const { gridSize, setGridSize, min, max, step } = useGridSize('lumacast.grid-size.deck-bin', 6, 4, 8);

  return (
    <BinShell
      collections={collections}
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      searchPlaceholder="Search deck…"
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      gridSize={gridSize}
      gridSizeMin={min}
      gridSizeMax={max}
      gridSizeStep={step}
      onGridSizeChange={setGridSize}
    >
      <BinPanelLayout
        gridItemSize={gridSize}
        mode={viewMode}
      >
        {filteredDeckItems.map((presentation) => {
          const shared = {
            item: presentation,
            slides: slidesByDeckItemId.get(presentation.id) ?? [],
            isSelected: isDetachedDeckBrowser && currentDrawerDeckItemId === presentation.id,
            isEditing: editingDeckItemId === presentation.id,
            onOpen: browseDeckItem,
            onRename: handleRename,
            collectionsApi: collections,
          };
          return viewMode === 'list'
            ? <DeckItemRow key={presentation.id} {...shared} />
            : <DeckItemTile key={presentation.id} {...shared} />;
        })}
      </BinPanelLayout>
    </BinShell>
  );
}

interface DeckItemProps {
  item: DeckItem;
  slides: Slide[];
  isSelected: boolean;
  isEditing: boolean;
  onOpen: (itemId: Id) => void;
  onRename: (itemId: Id, title: string) => void;
  collectionsApi: BinCollectionsApi;
}

function DeckItemContextMenuItems({ item, renameRef, collectionsApi }: { item: DeckItem; renameRef: React.RefObject<RenameFieldHandle | null>; collectionsApi: BinCollectionsApi }) {
  const { deleteDeckItem } = useLibraryPanelManagement();
  const confirm = useConfirm();
  const otherCollections = collectionsApi.collections.filter((c) => c.id !== item.collectionId);

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${item.title}"?`,
      description: 'This permanently removes the item and all its slides. This action cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) await deleteDeckItem(item.id);
  }

  return (
    <ContextMenu.Portal>
      <ContextMenu.Menu>
        <ContextMenu.Item onSelect={() => { renameRef.current?.startEditing(); }}>Rename</ContextMenu.Item>
        {otherCollections.length > 0 ? (
          <ContextMenu.Submenu label="Move to collection">
            {otherCollections.map((collection) => (
              <ContextMenu.Item
                key={collection.id}
                onSelect={() => { void collectionsApi.assignItem(item.type === 'lyric' ? 'lyric' : 'presentation', item.id, collection.id); }}
              >
                {collection.name}
              </ContextMenu.Item>
            ))}
          </ContextMenu.Submenu>
        ) : null}
        <ContextMenu.Separator />
        <ContextMenu.Item variant="destructive" onSelect={() => { void handleDelete(); }}>Delete</ContextMenu.Item>
      </ContextMenu.Menu>
    </ContextMenu.Portal>
  );
}

function DeckItemRow(props: DeckItemProps) {
  return (
    <ContextMenu.Root>
      <DeckItemRowBody {...props} />
    </ContextMenu.Root>
  );
}

function DeckItemRowBody({ item, slides, isSelected, isEditing, onOpen, onRename, collectionsApi }: DeckItemProps) {
  const renameRef = useRef<RenameFieldHandle>(null);
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger();

  useEffect(() => {
    if (isEditing) renameRef.current?.startEditing();
  }, [isEditing]);

  function handleOpen() {
    onOpen(item.id);
  }

  function handleDragStart(event: React.DragEvent<HTMLElement>) {
    writeDeckItemDragData(event.dataTransfer, item.id);
  }

  function handleRename(title: string) {
    onRename(item.id, title);
  }

  return (
    <>
      <SelectableRow.Root
        {...triggerHandlers}
        ref={triggerRef}
        selected={isSelected}
        onClick={handleOpen}
        className="h-9 cursor-grab"
        draggable
        onDragStart={handleDragStart}
      >
        <SelectableRow.Leading>
          <DeckItemIcon entity={item} size={14} strokeWidth={1.75} />
        </SelectableRow.Leading>
        <SelectableRow.Label>
          <RenameField ref={renameRef} value={item.title} onValueChange={handleRename} className="label-xs" />
        </SelectableRow.Label>
        <SelectableRow.Trailing>
          <span className="text-xs text-tertiary">{slides.length} {slides.length === 1 ? 'slide' : 'slides'}</span>
        </SelectableRow.Trailing>
      </SelectableRow.Root>
      <DeckItemContextMenuItems item={item} renameRef={renameRef} collectionsApi={collectionsApi} />
    </>
  );
}

function DeckItemTile(props: DeckItemProps) {
  return (
    <ContextMenu.Root>
      <DeckItemTileBody {...props} />
    </ContextMenu.Root>
  );
}

function DeckItemTileBody({ item, slides, isSelected, isEditing, onOpen, onRename, collectionsApi }: DeckItemProps) {
  const { slideElementsBySlideId } = useProjectContent();
  const firstSlide = slides[0] ?? null;
  const firstSlideElements = firstSlide ? slideElementsBySlideId.get(firstSlide.id) ?? [] : [];
  const scene = firstSlide ? buildThumbnailScene(firstSlide, firstSlideElements) : null;
  const renameRef = useRef<RenameFieldHandle>(null);
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger();

  useEffect(() => {
    if (isEditing) renameRef.current?.startEditing();
  }, [isEditing]);

  function handleOpen() {
    onOpen(item.id);
  }

  function handleDragStart(event: React.DragEvent<HTMLElement>) {
    writeDeckItemDragData(event.dataTransfer, item.id);
  }

  function handleRename(title: string) {
    onRename(item.id, title);
  }

  return (
    <>
      <div
        {...triggerHandlers}
        ref={triggerRef}
        className="group cursor-grab"
        draggable
        onDragStart={handleDragStart}
      >
        <Thumbnail.Tile onClick={handleOpen} selected={isSelected}>
          <Thumbnail.Body>
            <ScenePreview scene={scene} />
          </Thumbnail.Body>
          <Thumbnail.Caption>
            <div className="flex items-center gap-2">
              <DeckItemIcon entity={item} className="shrink-0 text-tertiary" size={14} strokeWidth={1.75} />
              <RenameField
                ref={renameRef}
                value={item.title}
                onValueChange={handleRename} className="label-xs"
              />
            </div>
          </Thumbnail.Caption>
        </Thumbnail.Tile>
      </div>
      <DeckItemContextMenuItems item={item} renameRef={renameRef} collectionsApi={collectionsApi} />
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
