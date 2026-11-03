import type { ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { DropdownMenu, Panel, ReacstButton, type MenuEntry } from '@lumacast/ui';
import './dock-header.css';

export interface DockHeaderProps {
  title: string;
  icon?: ReactNode;
  titleSuffix?: ReactNode;
  actions?: ReactNode;
  menuItems?: MenuEntry[];
  onHide: () => void;
  /** Supplies a caller-owned menu trigger for complex menus rendered alongside the header. */
  menuTrigger?: ReactNode;
}

export function DockHeader({
  title,
  icon,
  titleSuffix,
  actions,
  menuItems = [],
  onHide,
  menuTrigger,
}: DockHeaderProps) {
  const actionLabel = `${title} actions`;
  const defaultMenuItems: MenuEntry[] = [...menuItems];
  if (defaultMenuItems.length > 0) defaultMenuItems.push({ separator: true });
  defaultMenuItems.push({ id: 'dock.hide', label: `Hide ${title}`, onSelect: onHide });

  const headerActions = (
    <>
      {actions}
      {menuTrigger !== undefined
        ? menuTrigger
        : <DropdownMenu
            trigger={(
              <ReacstButton.Icon
                variant="ghost"
                size="md"
                label={actionLabel}
                className="stream-dock-header__menu-trigger"
              >
                <MoreHorizontal />
              </ReacstButton.Icon>
            )}
            entries={defaultMenuItems}
            align="end"
          />}
    </>
  );

  return (
    <Panel.Header data-dock-handle className="stream-dock-header cursor-grab select-none">
      <Panel.HeaderTitle icon={icon} className="stream-dock-header__title">
        <span className="stream-dock-header__title-text">{title}</span>
        {titleSuffix != null && <span className="stream-dock-header__title-suffix">{titleSuffix}</span>}
      </Panel.HeaderTitle>
      <Panel.HeaderActions className="stream-dock-header__actions">{headerActions}</Panel.HeaderActions>
    </Panel.Header>
  );
}
