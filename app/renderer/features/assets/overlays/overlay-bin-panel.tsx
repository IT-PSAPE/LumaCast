import { memo, useMemo, useRef, useState } from 'react';
import type { Id, Overlay } from '@core/types';
import { useWorkbench } from '../../../contexts/workbench-context';
import { useOverlayEditor } from '../../../contexts/asset-editor/asset-editor-context';
import { usePresentationOverlayLayer } from '../../../contexts/playback/playback-context';
import { overlayToLayerElements } from '@core/presentation-layers';
import { LazySceneStage } from '@renderer/components/display/lazy-scene-stage';
import { ContextMenu, useContextMenuTrigger } from '../../../components/overlays/context-menu';
import { useConfirm } from '../../../components/overlays/confirm-dialog';
import { RenameField, type RenameFieldHandle } from '../../../components/form/rename-field';
import { Thumbnail } from '../../../components/display/thumbnail';
import { SceneFrame } from '../../../components/display/scene-frame';
import { buildRenderScene } from '../../canvas/build-render-scene';
import { BinPanelLayout } from '@renderer/components/layout/collection-layout';
import { filterByText } from '../../../utils/filter-by-text';
import { useGridSize } from '../../../hooks/use-grid-size';
import type { ResourceDrawerViewMode } from '../../../types/ui';
import { BinShell } from '../../workbench/bin-shell';
import { useBinCollections, type BinCollectionsApi } from '../../workbench/use-bin-collections';

export function OverlayBinPanel() {
  const { actions: { setWorkbenchMode } } = useWorkbench();
  const { overlays: allOverlays, setCurrentOverlayId } = useOverlayEditor();
  const { activeOverlayIds, activateOverlay } = usePresentationOverlayLayer();
  const collections = useBinCollections('overlay');
  const [searchValue, setSearchValue] = useState('');
  const [viewMode, setViewMode] = useState<ResourceDrawerViewMode>('grid');
  const { gridSize, setGridSize, min, max, step } = useGridSize('lumacast.grid-size.overlay-bin', 3, 2, 4);

  const filteredByCollection = useMemo(
    () => collections.filterByActiveCollection(allOverlays),
    [allOverlays, collections],
  );

  const overlays = useMemo(
    () => filterByText(filteredByCollection, searchValue, (overlay: Overlay) => [overlay.name]),
    [filteredByCollection, searchValue],
  );

  return (
    <BinShell
      collections={collections}
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      searchPlaceholder="Search overlays…"
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      gridSize={gridSize}
      gridSizeMin={min}
      gridSizeMax={max}
      gridSizeStep={step}
      onGridSizeChange={setGridSize}
    >
      <BinPanelLayout gridItemSize={gridSize} mode={viewMode}>
        {overlays.map((overlay, index) => (
          <OverlayCard
            key={overlay.id}
            overlay={overlay}
            index={index}
            isActive={activeOverlayIds.includes(overlay.id)}
            onActivate={activateOverlay}
            onEdit={setCurrentOverlayId}
            setWorkbenchMode={setWorkbenchMode}
            collectionsApi={collections}
          />
        ))}
      </BinPanelLayout>
    </BinShell>
  );
}

interface OverlayCardProps {
  overlay: Overlay;
  index: number;
  isActive: boolean;
  onActivate: (id: Id) => void;
  onEdit: (id: Id) => void;
  setWorkbenchMode: (mode: 'overlay-editor') => void;
  collectionsApi: BinCollectionsApi;
}

function OverlayCardImpl(props: OverlayCardProps) {
  return (
    <ContextMenu.Root>
      <OverlayCardBody {...props} />
    </ContextMenu.Root>
  );
}

function OverlayCardBody({ overlay, index, isActive, onActivate, onEdit, setWorkbenchMode, collectionsApi }: OverlayCardProps) {
  const { updateOverlayDraft, deleteOverlay, duplicateOverlay } = useOverlayEditor();
  const scene = useMemo(() => buildRenderScene(null, overlayToLayerElements(overlay)), [overlay]);
  const renameRef = useRef<RenameFieldHandle>(null);
  const confirm = useConfirm();
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger();
  const otherCollections = collectionsApi.collections.filter((c) => c.id !== overlay.collectionId);

  function handleActivate() {
    onEdit(overlay.id);
    onActivate(overlay.id);
  }

  function handleEdit() {
    onEdit(overlay.id);
    setWorkbenchMode('overlay-editor');
  }

  function handleRename(next: string) {
    updateOverlayDraft({ id: overlay.id, name: next });
  }

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${overlay.name}"?`,
      description: 'This overlay will be permanently removed.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) await deleteOverlay(overlay.id);
  }

  return (
    <>
      <div {...triggerHandlers} ref={triggerRef}>
        <Thumbnail.Tile onClick={handleActivate} onDoubleClick={handleEdit} selected={isActive}>
          <Thumbnail.Body>
            <SceneFrame width={scene.width} height={scene.height} className="bg-tertiary" stageClassName="absolute inset-0" checkerboard>
              <LazySceneStage scene={scene} surface="list" className="absolute inset-0" />
            </SceneFrame>
          </Thumbnail.Body>
          <Thumbnail.Caption>
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-sm font-semibold tabular-nums text-secondary">{index + 1}</span>
              <RenameField ref={renameRef} value={overlay.name} onValueChange={handleRename} className="label-xs" />
            </div>
          </Thumbnail.Caption>
        </Thumbnail.Tile>
      </div>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          <ContextMenu.Item onSelect={handleEdit}>Edit</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => { renameRef.current?.startEditing(); }}>Rename</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => { duplicateOverlay(overlay.id); }}>Duplicate</ContextMenu.Item>
          {otherCollections.length > 0 ? (
            <ContextMenu.Submenu label="Move to collection">
              {otherCollections.map((collection) => (
                <ContextMenu.Item
                  key={collection.id}
                  onSelect={() => { void collectionsApi.assignItem('overlay', overlay.id, collection.id); }}
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
    </>
  );
}

const OverlayCard = memo(OverlayCardImpl);
