import { memo, useMemo, useRef, useState } from 'react';
import { Play, Workflow } from 'lucide-react';
import type { Id, Macro } from '@core/types';
import { useWorkbench } from '../../contexts/workbench-context';
import { ContextMenu, useContextMenuTrigger } from '../../components/overlays/context-menu';
import { useConfirm } from '../../components/overlays/confirm-dialog';
import { RenameField, type RenameFieldHandle } from '../../components/form/rename-field';
import { Thumbnail } from '../../components/display/thumbnail';
import { BinPanelLayout } from '@renderer/components/layout/collection-layout';
import { filterByText } from '../../utils/filter-by-text';
import { useGridSize } from '../../hooks/use-grid-size';
import type { ResourceDrawerViewMode } from '../../types/ui';
import { BinShell } from '../workbench/bin-shell';
import type { BinCollectionsApi } from '../workbench/use-bin-collections';
import { useAutomation } from './automation-context';

interface MacroBinPanelProps {
  collections: BinCollectionsApi;
  hideFooterPicker?: boolean;
}

export function MacroBinPanel({ collections, hideFooterPicker = false }: MacroBinPanelProps) {
  const { actions: { setWorkbenchMode } } = useWorkbench();
  const { state: { macros, currentMacroId }, actions: { setCurrentMacroId, runMacro, deleteMacro, duplicateMacro, updateMacroFields, refresh } } = useAutomation();
  const [searchValue, setSearchValue] = useState('');
  const [viewMode, setViewMode] = useState<ResourceDrawerViewMode>('grid');
  const { gridSize, setGridSize, min, max, step } = useGridSize('lumacast.grid-size.macro-bin', 3, 2, 4);

  const filteredByCollection = useMemo(
    () => collections.filterByActiveCollection(macros),
    [macros, collections],
  );

  const filteredMacros = useMemo(
    () => filterByText(filteredByCollection, searchValue, (macro: Macro) => [macro.name, macro.description]),
    [filteredByCollection, searchValue],
  );

  function handleOpenMacro(id: Id) {
    setCurrentMacroId(id);
    setWorkbenchMode('macro-editor');
  }

  return (
    <BinShell
      collections={hideFooterPicker ? undefined : collections}
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      searchPlaceholder="Search macros…"
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      gridSize={gridSize}
      gridSizeMin={min}
      gridSizeMax={max}
      gridSizeStep={step}
      onGridSizeChange={setGridSize}
    >
      <BinPanelLayout gridItemSize={gridSize} mode={viewMode}>
        {filteredMacros.map((macro, index) => (
          <MacroCard
            key={macro.id}
            macro={macro}
            index={index}
            isSelected={macro.id === currentMacroId}
            onSelect={setCurrentMacroId}
            onOpen={handleOpenMacro}
            onRunMacro={runMacro}
            onDeleteMacro={deleteMacro}
            onDuplicateMacro={duplicateMacro}
            onRename={(name) => { void updateMacroFields(macro.id, { name }); }}
            onMoveToCollection={async (collectionId) => {
              await collections.assignItem('macro', macro.id, collectionId);
              await refresh();
            }}
            collectionsApi={collections}
          />
        ))}
      </BinPanelLayout>
    </BinShell>
  );
}

interface MacroCardProps {
  macro: Macro;
  index: number;
  isSelected: boolean;
  onSelect: (id: Id | null) => void;
  onOpen: (id: Id) => void;
  onRunMacro: (id: Id) => Promise<void>;
  onDeleteMacro: (id: Id) => Promise<void>;
  onDuplicateMacro: (id: Id) => Promise<Macro | null>;
  onRename: (next: string) => void;
  onMoveToCollection: (collectionId: Id) => Promise<void>;
  collectionsApi: BinCollectionsApi;
}

function MacroCardImpl(props: MacroCardProps) {
  return (
    <ContextMenu.Root>
      <MacroCardBody {...props} />
    </ContextMenu.Root>
  );
}

function MacroCardBody({ macro, index, isSelected, onSelect, onOpen, onRunMacro, onDeleteMacro, onDuplicateMacro, onRename, onMoveToCollection, collectionsApi }: MacroCardProps) {
  const renameRef = useRef<RenameFieldHandle>(null);
  const confirm = useConfirm();
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger();
  const otherCollections = collectionsApi.collections.filter((c) => c.id !== macro.collectionId);
  const cueCountLabel = `${macro.cues.length} ${macro.cues.length === 1 ? 'cue' : 'cues'}`;

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${macro.name}"?`,
      description: 'This macro will be permanently removed. Existing slide bindings to it are also removed.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) await onDeleteMacro(macro.id);
  }

  return (
    <>
      <div {...triggerHandlers} ref={triggerRef}>
        <Thumbnail.Tile onClick={() => onSelect(macro.id)} onDoubleClick={() => onOpen(macro.id)} selected={isSelected}>
          <Thumbnail.Body>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-tertiary text-secondary">
              <Workflow className="size-7" strokeWidth={1.5} />
              <span className="text-xs text-tertiary">{cueCountLabel}</span>
            </div>
          </Thumbnail.Body>
          <Thumbnail.Caption>
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-sm font-semibold tabular-nums text-secondary">{index + 1}</span>
              <RenameField ref={renameRef} value={macro.name} onValueChange={onRename} className="label-xs" />
            </div>
          </Thumbnail.Caption>
        </Thumbnail.Tile>
      </div>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          <ContextMenu.Item onSelect={() => onOpen(macro.id)}>Edit</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => { renameRef.current?.startEditing(); }}>Rename</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => { void onDuplicateMacro(macro.id); }}>Duplicate</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => { void onRunMacro(macro.id); }}>
            <span className="inline-flex items-center gap-1.5">
              <Play className="size-3.5" />Run now
            </span>
          </ContextMenu.Item>
          <ContextMenu.Submenu label="Move to collection">
            {otherCollections.length > 0 ? (
              otherCollections.map((collection) => (
                <ContextMenu.Item
                  key={collection.id}
                  onSelect={() => { void onMoveToCollection(collection.id); }}
                >
                  {collection.name}
                </ContextMenu.Item>
              ))
            ) : (
              <ContextMenu.Item disabled onSelect={() => {}}>No other collections</ContextMenu.Item>
            )}
          </ContextMenu.Submenu>
          <ContextMenu.Separator />
          <ContextMenu.Item variant="destructive" onSelect={() => { void handleDelete(); }}>Delete</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}

const MacroCard = memo(MacroCardImpl);
