import { useCallback, type KeyboardEvent } from 'react';
import { menuCommandClaimRegistry, menuCommandForEvent } from '@lumacast/commands';

interface SlideSelectionKeyboardOptions {
  selectAll: () => void;
  clearSelection: () => void;
  duplicateSelected: () => Promise<void>;
  deleteSelected: () => Promise<void>;
}

/** Keep slide collection shortcuts local to the focused slide list or grid. */
export function useSlideSelectionKeyboard({ selectAll, clearSelection, duplicateSelected, deleteSelected }: SlideSelectionKeyboardOptions) {
  return useCallback((event: KeyboardEvent<HTMLElement>) => {
    const target = event.target;
    if (target instanceof HTMLElement && (
      target.isContentEditable
      || target.closest('input, textarea, select, [contenteditable="true"]')
    )) return;

    const hasModifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    const command = !event.altKey && !event.shiftKey && hasModifier;
    const handled = command && key === 'a'
      ? selectAll
      : command && key === 'd'
        ? () => { void duplicateSelected().catch(() => undefined); }
        : !hasModifier && !event.altKey && !event.shiftKey && (event.key === 'Delete' || event.key === 'Backspace')
          ? () => { void deleteSelected().catch(() => undefined); }
          : !hasModifier && !event.altKey && !event.shiftKey && event.key === 'Escape'
            ? clearSelection
            : null;
    if (!handled) return;

    event.preventDefault();
    event.stopPropagation();
    const menuCommand = menuCommandForEvent(event.nativeEvent);
    if (menuCommand) menuCommandClaimRegistry.claim(menuCommand);
    handled();
  }, [clearSelection, deleteSelected, duplicateSelected, selectAll]);
}
