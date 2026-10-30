import { useMemo } from 'react';
import type { Overlay } from '@lumacast/composition';
import { useConfirm } from '@lumacast/ui';
import { useWorkbench } from '../../../contexts/workbench-context';
import { useOverlayEditor } from '../../../contexts/asset-editor/asset-editor-context';
import { usePresentationOverlayLayer } from '../../../contexts/playback/playback-context';
import { useMultiSelection } from '@lumacast/selection';
import { filterByText } from '../../../utils/filter-by-text';
import { BinPanelLayout } from '@renderer/components/layout/collection-layout';
import { BinShell } from '@renderer/components/layout/bin-shell';
import { useBinControls } from '@renderer/components/controls/bin-controls';
import { OverlayCard } from './overlay-card';
import { runSelectionActions, useMultiSelectionKeyHandler } from '@lumacast/selection';

export function OverlayBinPanel() {
  const { actions: { setWorkbenchMode } } = useWorkbench();
  const { overlays: allOverlays, setCurrentOverlayId, deleteOverlay, duplicateOverlay } = useOverlayEditor();
  const { activeOverlayIds, activateOverlay } = usePresentationOverlayLayer();
  const { state: { searchValue, viewMode, grid } } = useBinControls();
  const confirm = useConfirm();
  const gridSize = grid?.value ?? 3;

  const overlays = useMemo(
    () => filterByText(allOverlays, searchValue, (overlay: Overlay) => [overlay.name]),
    [allOverlays, searchValue],
  );
  const orderedIds = overlays.map((overlay) => overlay.id);
  const selection = useMultiSelection(orderedIds, 'overlays');
  const handleSelectionKeys = useMultiSelectionKeyHandler({
    selectedCount: selection.selectedIds.size,
    selectAll: selection.selectAll,
    clearSelection: selection.clearSelection,
  });

  function handleSelectionClick(id: string, modifiers: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) {
    selection.select(id, modifiers);
    return Boolean(modifiers.shiftKey || modifiers.metaKey || modifiers.ctrlKey);
  }

  function handleContextMenuTarget(id: string) {
    if (!selection.selectedIds.has(id)) selection.select(id);
  }

  async function handleDeleteResource(clickedId: string) {
    const ids = selection.actionIds(clickedId);
    if (ids.length === 0) return;
    const nameById = new Map(overlays.map((overlay) => [overlay.id, overlay.name]));
    const ok = await confirm({
      title: ids.length === 1 ? `Delete "${nameById.get(ids[0]) ?? 'overlay'}"?` : `Delete ${ids.length} overlays?`,
      description: ids.length === 1
        ? 'This overlay will be permanently removed.'
        : 'These overlays will be permanently removed.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (ok) await runSelectionActions(ids, (id) => deleteOverlay(id));
  }

  function handleDuplicateResource(clickedId: string) {
    void runSelectionActions(selection.actionIds(clickedId), (id) => duplicateOverlay(id));
  }

  return (
    <BinShell>
      <BinShell.Content data-shortcuts-scope="ignore" onKeyDown={handleSelectionKeys}>
        <BinPanelLayout gridItemSize={gridSize} mode={viewMode} virtualize>
          {overlays.map((overlay) => (
            <OverlayCard
              key={overlay.id}
              overlay={overlay}
              isActive={activeOverlayIds.includes(overlay.id)}
              isResourceSelected={selection.selectedIds.has(overlay.id)}
              onActivate={activateOverlay}
              onEdit={setCurrentOverlayId}
              setWorkbenchMode={setWorkbenchMode}
              onSelectionClick={handleSelectionClick}
              onContextMenuTarget={handleContextMenuTarget}
              onDeleteResource={handleDeleteResource}
              onDuplicateResource={handleDuplicateResource}
            />
          ))}
        </BinPanelLayout>
      </BinShell.Content>
    </BinShell>
  );
}
