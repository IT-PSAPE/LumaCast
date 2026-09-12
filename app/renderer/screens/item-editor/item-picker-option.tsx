import type { ItemRef } from '@lumacast/composition';
import { cn } from '@renderer/utils/cn';
import { ItemIcon } from '../../components/display/entity-icon';
import { useItemEditorScreen } from './screen-context';

export function ItemPickerOption({
  item,
  isCurrent,
  isHighlighted,
  onSelect,
  onHighlight,
}: {
  item: ReturnType<typeof useItemEditorScreen>['state']['pickerItems'][number];
  isCurrent: boolean;
  isHighlighted: boolean;
  onSelect: (itemRef: ItemRef) => void;
  onHighlight: () => void;
}) {
  function handleSelect() {
    onSelect(item.itemRef);
  }

  return (
    <button
      id={`item-editor-item-option-${item.itemRef.id}`}
      type="button"
      role="option"
      aria-selected={isHighlighted}
      onClick={handleSelect}
      onMouseEnter={onHighlight}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors',
        isCurrent ? 'text-primary' : 'text-secondary',
        isHighlighted ? 'bg-tertiary text-primary' : 'hover:bg-tertiary hover:text-primary',
      )}
    >
      <ItemIcon entity={item.itemRef} className="shrink-0 text-tertiary" />
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      {isCurrent ? <span className="shrink-0 text-xs uppercase tracking-wide text-tertiary">current</span> : null}
    </button>
  );
}
