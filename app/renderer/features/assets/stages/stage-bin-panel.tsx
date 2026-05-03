import { memo, useMemo, useRef, useState } from 'react';
import type { Id, Stage } from '@core/types';
import { LazySceneStage } from '@renderer/components/display/lazy-scene-stage';
import { ContextMenu, useContextMenuTrigger } from '../../../components/overlays/context-menu';
import { useConfirm } from '../../../components/overlays/confirm-dialog';
import { RenameField, type RenameFieldHandle } from '../../../components/form/rename-field';
import { Thumbnail } from '../../../components/display/thumbnail';
import { SceneFrame } from '../../../components/display/scene-frame';
import { buildRenderScene } from '../../canvas/build-render-scene';
import { BinPanelLayout } from '@renderer/components/layout/collection-layout';
import { useStagePlayback } from '../../../contexts/playback/playback-context';
import { useStageEditor } from '../../../contexts/asset-editor/asset-editor-context';
import { useWorkbench } from '../../../contexts/workbench-context';
import { useProjectContent } from '../../../contexts/use-project-content';
import { filterByText } from '../../../utils/filter-by-text';
import { useGridSize } from '../../../hooks/use-grid-size';
import type { ResourceDrawerViewMode } from '../../../types/ui';
import { BinShell } from '../../workbench/bin-shell';
import { useBinCollections, type BinCollectionsApi } from '../../workbench/use-bin-collections';

export function StageBinPanel() {
  const { stages: allStages } = useProjectContent();
  const { currentStageId, setCurrentStageId } = useStagePlayback();
  const { setCurrentStageId: setEditorStageId } = useStageEditor();
  const { actions: { setWorkbenchMode } } = useWorkbench();
  const collections = useBinCollections('stage');
  const [searchValue, setSearchValue] = useState('');
  const [viewMode, setViewMode] = useState<ResourceDrawerViewMode>('grid');
  const { gridSize, setGridSize, min, max, step } = useGridSize('lumacast.grid-size.stage-bin', 3, 2, 4);

  const filteredByCollection = useMemo(
    () => collections.filterByActiveCollection(allStages),
    [allStages, collections],
  );

  const stages = useMemo(
    () => filterByText(filteredByCollection, searchValue, (stage: Stage) => [stage.name]),
    [filteredByCollection, searchValue],
  );

  return (
    <BinShell
      collections={collections}
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      searchPlaceholder="Search stages…"
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      gridSize={gridSize}
      gridSizeMin={min}
      gridSizeMax={max}
      gridSizeStep={step}
      onGridSizeChange={setGridSize}
    >
      <BinPanelLayout gridItemSize={gridSize} mode={viewMode}>
        {stages.map((stage, index) => (
          <StageCard
            key={stage.id}
            stage={stage}
            index={index}
            isActive={stage.id === currentStageId}
            onActivate={setCurrentStageId}
            onEdit={(id) => {
              setEditorStageId(id);
              setCurrentStageId(id);
              setWorkbenchMode('stage-editor');
            }}
            collectionsApi={collections}
          />
        ))}
      </BinPanelLayout>
    </BinShell>
  );
}

interface StageCardProps {
  stage: Stage;
  index: number;
  isActive: boolean;
  onActivate: (id: Id | null) => void;
  onEdit: (id: Id) => void;
  collectionsApi: BinCollectionsApi;
}

function StageCardImpl(props: StageCardProps) {
  return (
    <ContextMenu.Root>
      <StageCardBody {...props} />
    </ContextMenu.Root>
  );
}

function StageCardBody({ stage, index, isActive, onActivate, onEdit, collectionsApi }: StageCardProps) {
  const { updateStageDraft, deleteStage, duplicateStage } = useStageEditor();
  const scene = useMemo(() => buildRenderScene(null, stage.elements), [stage.elements]);
  const renameRef = useRef<RenameFieldHandle>(null);
  const confirm = useConfirm();
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger();

  function handleActivate() {
    onActivate(isActive ? null : stage.id);
  }

  function handleEdit() {
    onEdit(stage.id);
  }

  function handleRename(next: string) {
    updateStageDraft({ id: stage.id, name: next });
  }

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${stage.name}"?`,
      description: 'This stage layout will be permanently removed.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) await deleteStage(stage.id);
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
              <RenameField ref={renameRef} value={stage.name} onValueChange={handleRename} className="label-xs" />
            </div>
          </Thumbnail.Caption>
        </Thumbnail.Tile>
      </div>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          <ContextMenu.Item onSelect={handleEdit}>Edit</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => { renameRef.current?.startEditing(); }}>Rename</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => { duplicateStage(stage.id); }}>Duplicate</ContextMenu.Item>
          {collectionsApi.collections.filter((c) => c.id !== stage.collectionId).length > 0 ? (
            <ContextMenu.Submenu label="Move to collection">
              {collectionsApi.collections.filter((c) => c.id !== stage.collectionId).map((collection) => (
                <ContextMenu.Item
                  key={collection.id}
                  onSelect={() => { void collectionsApi.assignItem('stage', stage.id, collection.id); }}
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

const StageCard = memo(StageCardImpl);
