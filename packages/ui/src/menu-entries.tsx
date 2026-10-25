import { useCallback, useState, type ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import { cn } from './cn';
import { ContextMenu } from './context-menu';

// A data-driven menu description shared by every point-anchored context menu
// and the app menu bar: both render the same `MenuEntry[]` shape through
// `MenuEntries`, so a menu built for one reads naturally as the other.

export interface MenuItem {
  id: string;
  label: string;
  /** Decorative leading glyph, shown beside the label (hidden from assistive tech). */
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  onSelect?: () => void;
  children?: MenuEntry[];
}

export type MenuEntry = MenuItem | { separator: true } | { heading: string };

function isSeparatorEntry(entry: MenuEntry): entry is { separator: true } {
  return 'separator' in entry;
}

function isHeadingEntry(entry: MenuEntry): entry is { heading: string } {
  return 'heading' in entry;
}

// Matches lucide's `Check` at 24x24 / stroke-width 2: @lumacast/ui may depend
// only on `@lumacast/kernel`, so the glyph is inlined rather than pulled from
// an icon package.
function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// Mirrors the row styling `ContextMenu.Item` applies in context-menu.tsx. A
// checked entry has to render `Menu.CheckboxItem` directly (it supplies the
// `menuitemcheckbox` role/`aria-checked` that `ContextMenu.Item` doesn't), so
// its row classes are restated here to keep every entry's row identical.
const ITEM_ROW_CLASSES = 'flex w-full min-w-0 select-none items-center gap-2 truncate rounded px-2 py-1.5 text-left text-sm outline-hidden';

function entryRowClassName(danger: boolean | undefined, disabled: boolean | undefined) {
  return cn(
    ITEM_ROW_CLASSES,
    danger
      ? 'text-error data-[highlighted]:bg-error/15'
      : 'text-secondary data-[highlighted]:bg-tertiary data-[popup-open]:bg-tertiary',
    disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
  );
}

function EntryLabel({ item }: { item: MenuItem }) {
  return (
    <>
      <span className="flex size-3.5 shrink-0 items-center justify-center">
        {item.checked ? <CheckIcon /> : null}
      </span>
      {item.icon ? <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-4">{item.icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.shortcut ? <span className="ml-3 shrink-0 whitespace-nowrap text-[11px] tracking-wide text-tertiary">{item.shortcut}</span> : null}
    </>
  );
}

export interface MenuEntriesProps {
  entries: MenuEntry[];
  onClose?: () => void;
}

/**
 * Renders a `MenuEntry[]` as items/separators/headings/submenus, using the
 * same `ContextMenu.Item`/`.Separator`/`.Submenu` parts whether it sits inside
 * a point-anchored `ContextMenu.Root` (via `PointContextMenu`) or inside a
 * plain Base UI `Menu.Root` (a `Menubar` dropdown) — `ContextMenu.Submenu`'s
 * flyout degrades gracefully with no `ContextMenu.Root` ancestor.
 */
export function MenuEntries({ entries, onClose }: MenuEntriesProps) {
  return (
    <>
      {entries.map((entry, index) => {
        if (isSeparatorEntry(entry)) {
          return <ContextMenu.Separator key={`separator-${index}`} />;
        }

        if (isHeadingEntry(entry)) {
          return (
            <div
              key={`heading-${index}`}
              className="select-none px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-tertiary"
            >
              {entry.heading}
            </div>
          );
        }

        if (entry.children && entry.children.length > 0) {
          return (
            <ContextMenu.Submenu key={entry.id} label={entry.label} disabled={entry.disabled}>
              <MenuEntries entries={entry.children} onClose={onClose} />
            </ContextMenu.Submenu>
          );
        }

        if (entry.checked !== undefined) {
          // A checked item owns its state externally (the `checked` prop), so
          // `onCheckedChange` only reports the toggle upward — it never
          // flips local state itself (base-ui's internal `setChecked` is a
          // no-op while `checked` is controlled).
          return (
            <Menu.CheckboxItem
              key={entry.id}
              checked={entry.checked}
              disabled={entry.disabled}
              closeOnClick
              render={<button type="button" />}
              nativeButton
              className={entryRowClassName(entry.danger, entry.disabled)}
              onCheckedChange={() => {
                entry.onSelect?.();
                onClose?.();
              }}
            >
              <EntryLabel item={entry} />
            </Menu.CheckboxItem>
          );
        }

        return (
          <ContextMenu.Item
            key={entry.id}
            disabled={entry.disabled}
            variant={entry.danger ? 'destructive' : 'default'}
            onSelect={() => {
              entry.onSelect?.();
              onClose?.();
            }}
          >
            <EntryLabel item={entry} />
          </ContextMenu.Item>
        );
      })}
    </>
  );
}

export interface PointContextMenuProps {
  open: boolean;
  position: { x: number; y: number } | null;
  entries: MenuEntry[];
  label: string;
  onClose: () => void;
}

/** A right-click menu anchored to a point, rendered from a `MenuEntry[]` description. */
export function PointContextMenu({ open, position, entries, label, onClose }: PointContextMenuProps) {
  if (!open || !position) return null;

  return (
    <ContextMenu.Root open={open} position={position} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <ContextMenu.Portal>
        <ContextMenu.Menu aria-label={label}>
          <MenuEntries entries={entries} onClose={onClose} />
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export interface PointContextMenuTrigger {
  clientX: number;
  clientY: number;
  preventDefault(): void;
}

export interface UsePointContextMenuResult {
  open: boolean;
  position: { x: number; y: number } | null;
  show: (event: PointContextMenuTrigger) => void;
  close: () => void;
}

/** State for a `PointContextMenu`: `show` opens it at an event's pointer position, `close` dismisses it. */
export function usePointContextMenu(): UsePointContextMenuResult {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

  const show = useCallback((event: PointContextMenuTrigger) => {
    event.preventDefault();
    setPosition({ x: event.clientX, y: event.clientY });
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setPosition(null);
  }, []);

  return { open, position, show, close };
}
