import type { SlideElement, TextElementPayload } from '@core/types';
import { Box, Film, Image, Square, Type } from 'lucide-react';
import { EmptyState } from '@renderer/components/display/empty-state';
import { SelectableRow } from '@renderer/components/display/selectable-row';
import { useElements } from '@renderer/contexts/canvas/canvas-context';
import { useInspector } from '@renderer/features/inspector/inspector-context';
import { LAYER_ORDER } from '@renderer/types/ui';
import { compactText } from '@renderer/utils/slides';

export function ThemeEditorLayersPanel() {
  const { effectiveElements, selectedElementId, selectElement } = useElements();
  const { setInspectorTab } = useInspector();

  const orderedElements = effectiveElements
    .slice()
    .sort((a, b) => {
      const layerDiff = LAYER_ORDER[b.layer] - LAYER_ORDER[a.layer];
      if (layerDiff !== 0) return layerDiff;
      return b.zIndex - a.zIndex;
    });

  if (orderedElements.length === 0) {
    return (
      <EmptyState.Root data-ui-region="object-list-panel">
        <EmptyState.Title>No objects in this theme.</EmptyState.Title>
      </EmptyState.Root>
    );
  }

  return (
    <div data-ui-region="object-list-panel" className="flex w-full flex-col gap-1.5">
      {orderedElements.map((element) => (
        <ThemeLayerRow key={element.id} element={element} isSelected={element.id === selectedElementId} onSelect={selectElement} onSetInspectorTab={setInspectorTab} />
      ))}
    </div>
  );
}

function ThemeLayerRow({
  element,
  isSelected,
  onSelect,
  onSetInspectorTab,
}: {
  element: SlideElement;
  isSelected: boolean;
  onSelect: (id: SlideElement['id'] | null) => void;
  onSetInspectorTab: ReturnType<typeof useInspector>['setInspectorTab'];
}) {
  function handleClick() {
    onSelect(element.id);
    onSetInspectorTab(element.type === 'text' ? 'text' : element.type === 'video' ? 'video' : 'shape');
  }

  return (
    <SelectableRow.Root selected={isSelected} onClick={handleClick} className="w-full">
      <SelectableRow.Leading>
        <ElementTypeIcon type={element.type} />
      </SelectableRow.Leading>
      <SelectableRow.Label>{elementTitle(element)}</SelectableRow.Label>
    </SelectableRow.Root>
  );
}

function elementTitle(element: SlideElement): string {
  if (element.type !== 'text') return capitalize(element.type);
  const payload = element.payload as TextElementPayload;
  const rawText = String(payload.text ?? '').trim();
  if (!rawText) return 'Text';
  return compactText(rawText, 32);
}

function capitalize(value: string): string {
  if (!value) return value;
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function ElementTypeIcon({ type }: { type: SlideElement['type'] }) {
  const className = 'text-tertiary';
  if (type === 'text') return <Type size={12} strokeWidth={2} className={className} />;
  if (type === 'shape') return <Square size={12} strokeWidth={2} className={className} />;
  if (type === 'image') return <Image size={12} strokeWidth={2} className={className} />;
  if (type === 'video') return <Film size={12} strokeWidth={2} className={className} />;
  return <Box size={12} strokeWidth={2} className={className} />;
}
