import { useEffect, useState, type CSSProperties, type MouseEventHandler, type ReactNode } from 'react';
import type { InlineWindowMenuItem } from '@core/ipc';
import { ReacstButton } from '@renderer/components/controls/button';

const isMac = window.castApi.platform === 'darwin';
const isWindows = window.castApi.platform === 'win32';
const dragRegionStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;
const WINDOW_MENU_POPUP_OFFSET = 2;

interface WindowsInlineMenuBarProps {
  children: ReactNode;
}

export function WindowsInlineMenuBar({ children }: WindowsInlineMenuBarProps) {
  const [items, setItems] = useState<InlineWindowMenuItem[]>([]);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (!isWindows) return;
    let cancelled = false;

    void window.castApi.getInlineWindowMenuItems().then((nextItems) => {
      if (cancelled) return;
      setItems(nextItems);
    }).catch((error) => {
      console.error('[WindowsInlineMenuBar]', error);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const hasMenuItems = isWindows && items.length > 0;

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

  const headerStyle: CSSProperties = {
    ...dragRegionStyle,
    height: '36px',
  };

  if (!isWindows) {
    return (
      <header
        data-ui-region="app-toolbar"
        className="border-b border-primary bg-primary px-3 py-1.5"
        style={isMac ? { ...headerStyle, paddingLeft: '78px', height: undefined } : { ...headerStyle, height: undefined }}
      >
        {children}
      </header>
    );
  }

  return (
    <header
      data-ui-region="app-toolbar"
      className="border-b border-primary bg-primary px-3"
      style={headerStyle}
    >
      <div className="flex h-full items-center gap-3">
        <div
          data-ui-region="windows-inline-menu-bar"
          className="flex shrink-0 items-center gap-0.5 rounded-md border border-primary bg-secondary/60 p-0.5"
          style={noDragStyle}
        >
          {hasMenuItems ? items.map((item) => (
            <ReacstButton
              key={item.id}
              variant="ghost"
              data-menu-id={item.id}
              onClick={handleMenuButtonClick}
              active={activeMenuId === item.id}
              className="min-h-7 rounded-sm px-2.5 py-1 label-xs text-secondary hover:bg-quaternary"
            >
              {item.label}
            </ReacstButton>
          )) : null}
        </div>

        <div className="flex min-w-0 flex-1 items-center pr-[138px]">
          {children}
        </div>
      </div>
    </header>
  );
}
