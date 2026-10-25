import { useEffect, useState, type MouseEventHandler } from 'react';
import type { InlineWindowMenuItem } from '@lumacast/protocol';
import { cn } from '@lumacast/ui';

// Windows and Linux hide the native menu bar with the custom title bar, so menus render inline there.
const needsInlineMenu = window.castApi?.platform === 'win32' || window.castApi?.platform === 'linux';
const WINDOW_MENU_POPUP_OFFSET = 2;

// Menu buttons for the inline menu bar (Windows and Linux). Rendered inside WindowChrome.Start
// (already no-drag); each button opens the native Electron menu over IPC.
export function InlineMenuBar() {
  const [items, setItems] = useState<InlineWindowMenuItem[]>([]);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (!needsInlineMenu) return;
    let cancelled = false;

    void window.castApi.getInlineWindowMenuItems().then((nextItems) => {
      if (cancelled) return;
      setItems(nextItems);
    }).catch((error) => {
      console.error('[InlineMenuBar]', error);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const hasMenuItems = needsInlineMenu && items.length > 0;

  async function handleOpenMenu(item: InlineWindowMenuItem, button: HTMLButtonElement) {
    const rect = button.getBoundingClientRect();

    setActiveMenuId(item.id);
    try {
      await window.castApi.popupInlineWindowMenu(item.id, {
        x: rect.left,
        y: rect.bottom + WINDOW_MENU_POPUP_OFFSET,
      });
    } finally {
      setActiveMenuId(null);
    }
  }

  const handleMenuButtonClick: MouseEventHandler<HTMLButtonElement> = (event) => {
    const itemId = event.currentTarget.dataset.menuId;
    if (!itemId) return;
    const item = items.find((menuItem) => menuItem.id === itemId);
    if (!item) return;
    void handleOpenMenu(item, event.currentTarget);
  };

  if (!hasMenuItems) return null;

  return (
    <div data-ui-region="inline-menu-bar" className="flex h-full shrink-0 items-stretch">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          data-menu-id={item.id}
          onClick={handleMenuButtonClick}
          className={cn(
            'flex h-full items-center px-3 label-xs text-secondary transition-colors hover:bg-tertiary/60',
            activeMenuId === item.id && 'bg-tertiary/60 text-primary',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
