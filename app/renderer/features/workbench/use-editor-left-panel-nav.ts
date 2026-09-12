import { useEffect } from 'react';
import type { Id } from '@lumacast/kernel';
import { useElements } from '../../contexts/canvas/canvas-context';

function isReservedTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  const isEditable = target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.getAttribute('contenteditable') === 'true';
  if (isEditable) return true;

  return target.closest([
    'button',
    'a[href]',
    'select',
    '[role="button"]',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="option"]',
    '[role="listbox"]',
    '[role="combobox"]',
    '[data-shortcuts-scope="ignore"]',
  ].join(', ')) !== null;
}

interface NavItem {
  id: Id;
}

interface UseEditorLeftPanelNavOptions<T extends NavItem> {
  items: readonly T[];
  currentId: Id | null;
  activate: (id: Id, index: number) => void;
}

export function useEditorLeftPanelNav<T extends NavItem>({ items, currentId, activate }: UseEditorLeftPanelNavOptions<T>) {
  const { selectedElementId } = useElements();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (selectedElementId) return;
      const target = event.target as HTMLElement | null;
      if (isReservedTarget(target)) return;
      if (items.length === 0) return;

      const currentIndex = currentId ? items.findIndex((item) => item.id === currentId) : -1;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const resolvedIndex = currentIndex === -1 ? 0 : currentIndex + delta;
      const nextIndex = Math.max(0, Math.min(items.length - 1, resolvedIndex));
      if (nextIndex === currentIndex) return;
      event.preventDefault();
      activate(items[nextIndex].id, nextIndex);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [items, currentId, activate, selectedElementId]);
}
