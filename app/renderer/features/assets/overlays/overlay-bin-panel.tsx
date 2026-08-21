import { useMemo } from 'react';
import type { Overlay } from '@lumacast/composition';
import { useWorkbench } from '../../../contexts/workbench-context';
import { useOverlayEditor } from '../../../contexts/asset-editor/asset-editor-context';
import { usePresentationOverlayLayer } from '../../../contexts/playback/playback-context';
import { filterByText } from '../../../utils/filter-by-text';
import { BinPanelLayout } from '@renderer/components/layout/collection-layout';
import { BinShell } from '@renderer/components/layout/bin-shell';
import { useBinControls } from '@renderer/components/controls/bin-controls';
import { OverlayCard } from './overlay-card';

export function OverlayBinPanel() {
  const { actions: { setWorkbenchMode } } = useWorkbench();
  const { overlays: allOverlays, setCurrentOverlayId } = useOverlayEditor();
  const { activeOverlayIds, activateOverlay } = usePresentationOverlayLayer();
  const { state: { searchValue, viewMode, grid } } = useBinControls();
  const gridSize = grid?.value ?? 3;

  const overlays = useMemo(
    () => filterByText(allOverlays, searchValue, (overlay: Overlay) => [overlay.name]),
    [allOverlays, searchValue],
  );

  return (
    <BinShell>
      <BinShell.Content>
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
            />
          ))}
        </BinPanelLayout>
      </BinShell.Content>
    </BinShell>
  );
}
