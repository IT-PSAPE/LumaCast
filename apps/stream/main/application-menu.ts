import { app, Menu, webContents as webContentsModule, type MenuItemConstructorOptions, type WebContents } from 'electron';
import type { SerializedMenuItem } from '../shared/application-menu';

// Builds the real macOS application menu (`Menu.setApplicationMenu`) from the
// renderer's `SerializedMenuItem[]` template (see `shared/application-menu.ts` and `renderer/chrome/app-menu.ts`'s
// `serializeAppMenus`), and dispatches clicks back into the renderer by id over
// `stream:menu-action`. Windows/Linux keep `titleBarStyle: 'hidden'` with no
// native menu bar at all — their menu is the title bar's hamburger button,
// rendered entirely in the renderer (`renderer/chrome/title-bar.tsx`) — so
// `applyApplicationMenu` just clears any menu there.

const MAX_MENU_DEPTH = 4;
const MAX_MENU_ITEMS = 200;
const MAX_LABEL_LENGTH = 200;
const MAX_ID_LENGTH = 200;
const MAX_ACCELERATOR_LENGTH = 64;

const SERIALIZED_ITEM_TYPES = new Set(['normal', 'separator', 'checkbox', 'radio', 'submenu']);
const SERIALIZED_ROLES = new Set(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll', 'quit', 'about']);
const ALLOWED_FIELDS = new Set(['id', 'label', 'type', 'checked', 'disabled', 'accelerator', 'registerAccelerator', 'role', 'submenu']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateItem(value: unknown, depth: number, counter: { count: number }): SerializedMenuItem {
  if (depth > MAX_MENU_DEPTH) throw new Error('The application menu is nested too deeply.');
  counter.count += 1;
  if (counter.count > MAX_MENU_ITEMS) throw new Error('The application menu has too many items.');
  if (!isPlainObject(value)) throw new Error('Invalid application menu item.');
  for (const key of Object.keys(value)) {
    if (!ALLOWED_FIELDS.has(key)) throw new Error(`Unknown application menu field: ${key}.`);
  }
  const { id, label, type, checked, disabled, accelerator, registerAccelerator, role, submenu } = value;
  if (typeof id !== 'string' || id.length < 1 || id.length > MAX_ID_LENGTH) throw new Error('Invalid application menu item id.');
  if (typeof label !== 'string' || label.length > MAX_LABEL_LENGTH) throw new Error('Invalid application menu item label.');
  if (type !== undefined && (typeof type !== 'string' || !SERIALIZED_ITEM_TYPES.has(type))) throw new Error('Invalid application menu item type.');
  if (checked !== undefined && typeof checked !== 'boolean') throw new Error('Invalid application menu item checked flag.');
  if (disabled !== undefined && typeof disabled !== 'boolean') throw new Error('Invalid application menu item disabled flag.');
  if (accelerator !== undefined && (typeof accelerator !== 'string' || accelerator.length > MAX_ACCELERATOR_LENGTH)) throw new Error('Invalid application menu item accelerator.');
  if (registerAccelerator !== undefined && typeof registerAccelerator !== 'boolean') throw new Error('Invalid application menu item registerAccelerator flag.');
  if (role !== undefined && (typeof role !== 'string' || !SERIALIZED_ROLES.has(role))) throw new Error('Invalid application menu item role.');

  const item: SerializedMenuItem = { id, label };
  if (type !== undefined) item.type = type as SerializedMenuItem['type'];
  if (checked !== undefined) item.checked = checked;
  if (disabled !== undefined) item.disabled = disabled;
  if (accelerator !== undefined) item.accelerator = accelerator;
  if (registerAccelerator !== undefined) item.registerAccelerator = registerAccelerator;
  if (role !== undefined) item.role = role as SerializedMenuItem['role'];
  if (submenu !== undefined) {
    if (!Array.isArray(submenu)) throw new Error('Invalid application menu submenu.');
    item.submenu = submenu.map((child) => validateItem(child, depth + 1, counter));
  }
  return item;
}

/**
 * Validates an untrusted `stream:set-application-menu` payload before it ever
 * reaches `Menu.buildFromTemplate`: bounded nesting (depth) and size (item
 * count), length-capped strings, and only the fields `SerializedMenuItem`
 * declares — anything else throws, same as the other IPC handlers in `ipc.ts`.
 */
export function validateSerializedMenu(value: unknown): SerializedMenuItem[] {
  if (!Array.isArray(value)) throw new Error('Invalid application menu.');
  const counter = { count: 0 };
  return value.map((item) => validateItem(item, 1, counter));
}

// These four ids are rendered as plain items (no Electron `role`) specifically
// so their `click` can run *both* the native text-editing command and notify
// the renderer — Electron's own docs for `role` are explicit that "when
// specified the click property will be ignored", so a role-based Undo could
// never also dispatch `edit.undo` for the renderer's source-undo. The
// renderer ignores the dispatch itself when a text field has focus (see
// `features/chrome/use-native-menu.ts`), so this is what makes Cmd+Z/C/V
// behave correctly for both typing and selected sources.
const NATIVE_EDIT_ACTIONS: Record<string, (contents: WebContents | null) => void> = {
  'edit.undo': (contents) => contents?.undo(),
  'edit.redo': (contents) => contents?.redo(),
  'edit.copy': (contents) => contents?.copy(),
  'edit.paste': (contents) => contents?.paste(),
};

function toElectronItem(item: SerializedMenuItem, send: (id: string) => void): MenuItemConstructorOptions {
  if (item.type === 'separator') return { type: 'separator' };

  const options: MenuItemConstructorOptions = { id: item.id, label: item.label };
  if (item.type === 'checkbox' || item.type === 'radio') options.type = item.type;
  if (item.checked !== undefined) options.checked = item.checked;
  if (item.disabled) options.enabled = false;
  if (item.accelerator) options.accelerator = item.accelerator;
  if (item.registerAccelerator !== undefined) options.registerAccelerator = item.registerAccelerator;

  if (item.submenu && item.submenu.length > 0) {
    options.submenu = item.submenu.map((child) => toElectronItem(child, send));
    return options;
  }

  // A role item (the Cut/Select All this module appends to Edit, and every
  // role in the hardcoded App/Window menus below) performs its native action
  // on its own; it never originates from the renderer's template, so it never
  // needs to dispatch an id back.
  if (item.role) {
    options.role = item.role;
    return options;
  }

  options.click = () => {
    NATIVE_EDIT_ACTIONS[item.id]?.(webContentsModule.getFocusedWebContents());
    send(item.id);
  };
  return options;
}

/** Appends the standard Cut/Select All commands to the renderer's Edit submenu — native roles, not part of `app-menu.ts`'s shared File/Edit/.../Help model (the hamburger menu on Windows/Linux has no native text-editing roles to borrow). */
function withEditExtras(item: SerializedMenuItem): SerializedMenuItem {
  if (item.id !== 'edit' || !item.submenu) return item;
  return {
    ...item,
    submenu: [
      ...item.submenu,
      { id: 'edit.cut', label: 'Cut', role: 'cut' },
      { id: 'edit.selectAll', label: 'Select All', role: 'selectAll' },
    ],
  };
}

function buildAppMenu(send: (id: string) => void): MenuItemConstructorOptions {
  return {
    label: app.name,
    submenu: [
      { id: 'help.about', label: `About ${app.name}`, click: () => send('help.about') },
      { type: 'separator' },
      { id: 'file.settings', label: 'Settings…', accelerator: 'Cmd+,', click: () => send('file.settings') },
      { type: 'separator' },
      { role: 'services', submenu: [] },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  };
}

/**
 * Builds and installs the native macOS application menu from the renderer's
 * serialized template, or clears it on Windows/Linux (where the title bar's
 * hamburger button is the only menu — see `windowChromeOptions` (`@lumacast/desktop`), which
 * hides the native title bar there with no menu-bar room to show one anyway).
 * `send` is called with an item's id whenever a (non-role) item is clicked.
 */
export function applyApplicationMenu(template: SerializedMenuItem[], send: (id: string) => void): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  const items: MenuItemConstructorOptions[] = [
    buildAppMenu(send),
    ...template.map((item) => toElectronItem(withEditExtras(item), send)),
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(items));
}
