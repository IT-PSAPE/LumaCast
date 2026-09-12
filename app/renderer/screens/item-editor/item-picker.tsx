import { useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import type { ItemRef } from '@lumacast/composition';
import { ItemIcon } from '../../components/display/entity-icon';
import { Popover } from '../../components/overlays/popover';
import { useItemEditorScreen } from './screen-context';
import { ItemPickerOption } from './item-picker-option';

// Combobox-style picker that replaces the static item title in the edit
// screen's left panel. Click the trigger to open a popover with a search
// input and a filtered list of items; pick one to switch.
export function ItemPicker() {
  const { state, actions } = useItemEditorScreen();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return state.pickerItems;
    return state.pickerItems.filter((item) => item.title.toLowerCase().includes(q));
  }, [filter, state.pickerItems]);

  const listboxId = 'item-editor-item-picker-listbox';
  const activeOptionId = filtered[highlightedIndex] ? `item-editor-item-option-${filtered[highlightedIndex].itemRef.id}` : undefined;

  function handleOpen() {
    setOpen(true);
    setFilter('');
    setHighlightedIndex(0);
    // Focus the search input on next paint, after the popover mounts.
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleClose() {
    setOpen(false);
  }

  function handleSelect(itemRef: ItemRef) {
    actions.browseItem(itemRef);
    handleClose();
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((prev) => Math.min(prev + 1, Math.max(0, filtered.length - 1)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = filtered[highlightedIndex];
      if (target) handleSelect(target.itemRef);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      handleClose();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={open ? handleClose : handleOpen}
        aria-label="Select item"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        className="h-6.5 flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1 py-0.5 text-left transition-colors hover:bg-tertiary"
        title={state.currentItem?.title ?? 'No item selected'}
      >
        {state.currentItemRef ? <ItemIcon entity={state.currentItemRef} className="shrink-0 text-tertiary" /> : null}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary">
          {state.currentItem?.title ?? 'No item selected'}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-tertiary" />
      </button>
      <Popover anchor={triggerRef.current} open={open} onClose={handleClose} placement="bottom-start" offset={4} axisLock>
        <div className="flex w-72 flex-col overflow-hidden rounded-md border border-primary bg-primary shadow-lg">
          <div className="flex items-center gap-1.5 border-b border-primary px-2 py-1.5">
            <Search className="size-3.5 shrink-0 text-tertiary" />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-activedescendant={activeOptionId}
              aria-autocomplete="list"
              data-shortcuts-scope="ignore"
              value={filter}
              onChange={(event) => { setFilter(event.target.value); setHighlightedIndex(0); }}
              onKeyDown={handleInputKeyDown}
              placeholder="Search items"
              className="min-w-0 flex-1 bg-transparent text-sm text-primary outline-none placeholder:text-tertiary"
            />
          </div>
          <div ref={listRef} id={listboxId} role="listbox" aria-label="Items" className="max-h-72 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <div className="px-2 py-1.5 text-sm text-tertiary">No items match.</div>
            ) : (
              filtered.map((item, index) => (
                <ItemPickerOption
                  key={item.itemRef.id}
                  item={item}
                  isCurrent={state.currentItemRef !== null && state.currentItemRef.type === item.itemRef.type && state.currentItemRef.id === item.itemRef.id}
                  isHighlighted={index === highlightedIndex}
                  onSelect={handleSelect}
                  onHighlight={() => setHighlightedIndex(index)}
                />
              ))
            )}
          </div>
        </div>
      </Popover>
    </>
  );
}
