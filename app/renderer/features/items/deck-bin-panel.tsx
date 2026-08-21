import { BinShell } from '@renderer/components/layout/bin-shell';
import { useBinControls } from '@renderer/components/controls/bin-controls';
import { useCreateItem } from './create-item';
import { ItemBinSectionBody } from './item-bin-section-body';
import { useDeckBin } from './use-deck-bin';

export { useDuplicateItem } from './use-duplicate-item';

export function DeckBinPanel() {
  const { open: openCreateItem } = useCreateItem();
  const {
    sections,
    editingItemRef,
    browseItem,
    isDetachedDeckBrowser,
    currentDrawerItemRef,
    handleRename,
    handleMove,
    slidesByItem,
  } = useDeckBin();
  const { state: { viewMode, grid } } = useBinControls();
  const gridSize = grid?.value ?? 6;

  return (
    <BinShell>
      <BinShell.Content>
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
              onCreate={() => openCreateItem(section.type)}
            />
          ))}
        </div>
      </BinShell.Content>
    </BinShell>
  );
}
