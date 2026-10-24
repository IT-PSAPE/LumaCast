import type { SerializedMenuItem } from '../../shared/application-menu';
import type { MenuEntry, MenubarMenu } from '@lumacast/ui';
import { primaryShortcutLabel, type StreamPlatform } from '../../shared/platform-capabilities';

// The LumaStream app menu model: a pure function from app state to a
// `MenubarMenu[]` (rendered by `TitleBar`'s `Menubar`). Kept OBS-minimal per
// the parity spec's decisions — Scene Collection/Profile pickers move out of
// the top bar into here, Tools and the rarer OBS items (Lock Docks, Full-Height
// Docks, Custom Browser Docks, preview scaling, rotate/flip transforms, Safe
// Mode, crash reports, …) are dropped.

export type AppMenuId = 'file' | 'edit' | 'view' | 'docks' | 'profile' | 'sceneCollection' | 'help';

export interface AppMenuContext {
  platform: StreamPlatform;
  studioMode: boolean;
  multiviewOpen: boolean;
  undoAvailable: boolean;
  redoAvailable: boolean;
  sourceSelected: boolean;
  clipboardAvailable: boolean;
  docks: Array<{ id: string; label: string; visible: boolean }>;
  collections: Array<{ id: string; name: string }>;
  activeCollectionId: string | null;
  profiles: Array<{ id: string; name: string }>;
  activeProfileId: string | null;
  actions: AppMenuActions;
}

export interface AppMenuActions {
  openSettings(): void;
  quit(): void;
  importCollection(): void;
  exportCollection(): void;
  showRecordings(): void;
  remux(): void;
  undo(): void;
  redo(): void;
  copySource(): void;
  pasteSource(): void;
  deleteSource(): void;
  fitSource(): void;
  stretchSource(): void;
  centerSource(): void;
  resetTransform(): void;
  toggleStudioMode(): void;
  openMultiview(): void;
  openPreviewProjector(): void;
  openProgramProjector(): void;
  toggleDock(id: string): void;
  resetUi(): void;
  activateCollection(id: string): void;
  newCollection(): void;
  duplicateCollection(): void;
  renameCollection(): void;
  deleteCollection(): void;
  activateProfile(id: string): void;
  newProfile(): void;
  duplicateProfile(): void;
  renameProfile(): void;
  deleteProfile(): void;
  importProfile(): void;
  exportProfile(): void;
  about(): void;
  shortcuts(): void;
}

function buildFileMenu(context: AppMenuContext): MenubarMenu {
  const { actions } = context;
  const entries: MenuEntry[] = [
    { id: 'file.importCollection', label: 'Import Scene Collection…', onSelect: actions.importCollection },
    { id: 'file.exportCollection', label: 'Export Scene Collection…', onSelect: actions.exportCollection },
    { separator: true },
    { id: 'file.showRecordings', label: 'Show Recordings', onSelect: actions.showRecordings },
    { id: 'file.remux', label: 'Remux Recordings…', onSelect: actions.remux },
    { separator: true },
    { id: 'file.settings', label: 'Settings…', onSelect: actions.openSettings },
    { separator: true },
    {
      id: 'file.quit',
      label: 'Quit',
      shortcut: context.platform === 'darwin' ? primaryShortcutLabel(context.platform, 'Q') : undefined,
      onSelect: actions.quit,
    },
  ];
  return { id: 'file', label: 'File', entries };
}

function buildEditMenu(context: AppMenuContext): MenubarMenu {
  const { actions, platform, sourceSelected } = context;
  const entries: MenuEntry[] = [
    {
      id: 'edit.undo',
      label: 'Undo',
      shortcut: primaryShortcutLabel(platform, 'Z'),
      disabled: !context.undoAvailable,
      onSelect: actions.undo,
    },
    {
      id: 'edit.redo',
      label: 'Redo',
      shortcut: primaryShortcutLabel(platform, 'Z', true),
      disabled: !context.redoAvailable,
      onSelect: actions.redo,
    },
    { separator: true },
    {
      id: 'edit.copy',
      label: 'Copy',
      shortcut: primaryShortcutLabel(platform, 'C'),
      disabled: !sourceSelected,
      onSelect: actions.copySource,
    },
    {
      id: 'edit.paste',
      label: 'Paste',
      shortcut: primaryShortcutLabel(platform, 'V'),
      disabled: !context.clipboardAvailable,
      onSelect: actions.pasteSource,
    },
    {
      id: 'edit.delete',
      label: 'Delete',
      shortcut: 'Delete',
      disabled: !sourceSelected,
      onSelect: actions.deleteSource,
    },
    { separator: true },
    {
      id: 'edit.transform',
      label: 'Transform',
      disabled: !sourceSelected,
      children: [
        { id: 'edit.transform.fit', label: 'Fit to Screen', shortcut: primaryShortcutLabel(platform, 'F'), onSelect: actions.fitSource },
        { id: 'edit.transform.stretch', label: 'Stretch to Screen', shortcut: primaryShortcutLabel(platform, 'S'), onSelect: actions.stretchSource },
        { id: 'edit.transform.center', label: 'Center', shortcut: primaryShortcutLabel(platform, 'D'), onSelect: actions.centerSource },
        { id: 'edit.transform.reset', label: 'Reset Transform', shortcut: primaryShortcutLabel(platform, 'R'), onSelect: actions.resetTransform },
      ],
    },
  ];
  return { id: 'edit', label: 'Edit', entries };
}

function buildViewMenu(context: AppMenuContext): MenubarMenu {
  const { actions } = context;
  const entries: MenuEntry[] = [
    { id: 'view.studioMode', label: 'Studio Mode', checked: context.studioMode, onSelect: actions.toggleStudioMode },
    // Multiview (Windowed) toggles a singleton window: checked while it's
    // open, and selecting the item again closes it.
    { id: 'view.multiview', label: 'Multiview (Windowed)', checked: context.multiviewOpen, onSelect: actions.openMultiview },
    { separator: true },
    // Preview only exists in Studio Mode (the single-stage layout has no separate preview output).
    { id: 'view.previewProjector', label: 'Preview Projector', disabled: !context.studioMode, onSelect: actions.openPreviewProjector },
    { id: 'view.programProjector', label: 'Program Projector', onSelect: actions.openProgramProjector },
    { separator: true },
    { id: 'view.resetUi', label: 'Reset UI', onSelect: actions.resetUi },
  ];
  return { id: 'view', label: 'View', entries };
}

function buildDocksMenu(context: AppMenuContext): MenubarMenu {
  const { actions } = context;
  const entries: MenuEntry[] = [
    ...context.docks.map((dock): MenuEntry => ({
      id: `docks.${dock.id}`,
      label: dock.label,
      checked: dock.visible,
      onSelect: () => actions.toggleDock(dock.id),
    })),
    { separator: true },
    { id: 'docks.reset', label: 'Reset Docks', onSelect: actions.resetUi },
  ];
  return { id: 'docks', label: 'Docks', entries };
}

function buildProfileMenu(context: AppMenuContext): MenubarMenu {
  const { actions } = context;
  const hasActive = context.activeProfileId !== null;
  const entries: MenuEntry[] = [
    ...context.profiles.map((profile): MenuEntry => ({
      id: `profile.${profile.id}`,
      label: profile.name,
      checked: profile.id === context.activeProfileId,
      onSelect: () => actions.activateProfile(profile.id),
    })),
    { separator: true },
    { id: 'profile.new', label: 'New…', onSelect: actions.newProfile },
    { id: 'profile.duplicate', label: 'Duplicate…', disabled: !hasActive, onSelect: actions.duplicateProfile },
    { id: 'profile.rename', label: 'Rename…', disabled: !hasActive, onSelect: actions.renameProfile },
    { id: 'profile.remove', label: 'Remove…', danger: true, disabled: !hasActive, onSelect: actions.deleteProfile },
    { separator: true },
    { id: 'profile.import', label: 'Import…', onSelect: actions.importProfile },
    { id: 'profile.export', label: 'Export…', onSelect: actions.exportProfile },
  ];
  return { id: 'profile', label: 'Profile', entries };
}

function buildSceneCollectionMenu(context: AppMenuContext): MenubarMenu {
  const { actions } = context;
  const hasActive = context.activeCollectionId !== null;
  const entries: MenuEntry[] = [
    { id: 'sceneCollection.new', label: 'New…', onSelect: actions.newCollection },
    { id: 'sceneCollection.duplicate', label: 'Duplicate…', disabled: !hasActive, onSelect: actions.duplicateCollection },
    { id: 'sceneCollection.rename', label: 'Rename…', disabled: !hasActive, onSelect: actions.renameCollection },
    { id: 'sceneCollection.remove', label: 'Remove…', danger: true, disabled: !hasActive, onSelect: actions.deleteCollection },
    { separator: true },
    { id: 'sceneCollection.import', label: 'Import…', onSelect: actions.importCollection },
    { id: 'sceneCollection.export', label: 'Export…', onSelect: actions.exportCollection },
    { separator: true },
    ...context.collections.map((collection): MenuEntry => ({
      id: `sceneCollection.${collection.id}`,
      label: collection.name,
      checked: collection.id === context.activeCollectionId,
      onSelect: () => actions.activateCollection(collection.id),
    })),
  ];
  return { id: 'sceneCollection', label: 'Scene Collection', entries };
}

function buildHelpMenu(context: AppMenuContext): MenubarMenu {
  const { actions } = context;
  const entries: MenuEntry[] = [
    { id: 'help.shortcuts', label: 'Keyboard Shortcuts…', onSelect: actions.shortcuts },
    { id: 'help.about', label: 'About LumaStream', onSelect: actions.about },
  ];
  return { id: 'help', label: 'Help', entries };
}

export function buildAppMenus(context: AppMenuContext): MenubarMenu[] {
  return [
    buildFileMenu(context),
    buildEditMenu(context),
    buildViewMenu(context),
    buildDocksMenu(context),
    buildProfileMenu(context),
    buildSceneCollectionMenu(context),
    buildHelpMenu(context),
  ];
}

// --- Native (macOS) / hamburger (Windows/Linux) menu serialization ---------
//
// The real macOS menu bar (`Menu.setApplicationMenu`, built in
// `main/application-menu.ts`) can't hold React closures, so `serializeAppMenus`
// turns the same `MenubarMenu[]` `buildAppMenus` already produces into a plain,
// JSON-safe template sent over `stream:set-application-menu`; `collectMenuActions`
// keeps the id -> `onSelect` map on the renderer side so `stream:menu-action`
// dispatch (see `features/chrome/use-native-menu.ts`) can still call into the
// real action. The Windows/Linux hamburger menu never serializes anything —
// it renders `buildAppMenus`' `MenubarMenu[]` directly as a `PointContextMenu`.

export type { SerializedMenuItem } from '../../shared/application-menu';

// The symbols `primaryShortcutLabel` renders on darwin, mapped to the Electron
// accelerator modifier they correspond to.
const ACCELERATOR_SYMBOLS: Record<string, string> = { '⌃': 'Control', '⇧': 'Shift', '⌥': 'Alt', '⌘': 'CommandOrControl' };
const NAMED_ACCELERATOR_KEYS = new Set(['Delete', 'Backspace', 'Tab', 'Enter', 'Escape', 'Space', 'Home', 'End', 'PageUp', 'PageDown', 'Insert']);

function isFunctionKeyLabel(value: string): boolean {
  return /^F([1-9]|1\d|2[0-4])$/.test(value);
}

function isArrowKeyLabel(value: string): boolean {
  return /^Arrow(Up|Down|Left|Right)$/.test(value);
}

/** Converts a shortcut label as rendered by `primaryShortcutLabel`/the menu's own literal labels (e.g. '⇧⌘Z', 'Ctrl+Shift+Z', 'Delete', 'F2') into an Electron accelerator string ('Shift+CommandOrControl+Z', 'Delete', 'F2'). Returns `undefined` for anything it can't parse into at least one key. */
export function shortcutToAccelerator(shortcut: string | undefined): string | undefined {
  if (!shortcut) return undefined;
  if (NAMED_ACCELERATOR_KEYS.has(shortcut) || isFunctionKeyLabel(shortcut)) return shortcut;
  if (isArrowKeyLabel(shortcut)) return shortcut.slice('Arrow'.length);
  if (shortcut.includes('+')) {
    return shortcut
      .split('+')
      .map((part) => (part === 'Ctrl' || part === 'Control' || part === 'Cmd' || part === 'Command' ? 'CommandOrControl' : part))
      .join('+');
  }
  const modifiers: string[] = [];
  let key = '';
  for (const character of shortcut) {
    const modifier = ACCELERATOR_SYMBOLS[character];
    if (modifier) modifiers.push(modifier);
    else key += character;
  }
  if (!key) return undefined;
  return [...modifiers, key.toUpperCase()].join('+');
}

// Shortcuts the in-window keydown handler (`features/hotkeys/use-hotkeys.ts`)
// already owns end-to-end: registering them as native accelerators too would
// steal the key before it reaches an input (Delete/Backspace while renaming
// or typing) or double-fire against the handler's own Transform (Cmd+F/S/D/R)
// and arrow-nudge logic. They still show a hint in the menu; they just don't
// register, via `registerAccelerator: false`.
function isDisplayOnlyAccelerator(id: string, shortcut: string): boolean {
  if (id.startsWith('edit.transform.')) return true;
  if (shortcut === 'Delete' || shortcut === 'Backspace') return true;
  if (isFunctionKeyLabel(shortcut)) return true;
  if (isArrowKeyLabel(shortcut)) return true;
  return false;
}

function serializeEntries(entries: MenuEntry[], menuId: AppMenuId, platform: StreamPlatform): SerializedMenuItem[] {
  const items: SerializedMenuItem[] = [];
  entries.forEach((entry, index) => {
    if ('separator' in entry) {
      items.push({ id: `${menuId}.separator-${index}`, label: '', type: 'separator' });
      return;
    }
    if ('heading' in entry) return; // native menus have no heading row; dropped (unused by buildAppMenus today).

    const item: SerializedMenuItem = { id: entry.id, label: entry.label };
    const isRadioList = menuId === 'profile' || menuId === 'sceneCollection';
    if (entry.children && entry.children.length > 0) {
      item.type = 'submenu';
      item.submenu = serializeEntries(entry.children, menuId, platform);
    } else if (entry.checked !== undefined) {
      item.type = isRadioList ? 'radio' : 'checkbox';
      item.checked = entry.checked;
    }
    if (entry.disabled) item.disabled = true;

    const accelerator = shortcutToAccelerator(entry.shortcut);
    if (accelerator) {
      item.accelerator = accelerator;
      if (isDisplayOnlyAccelerator(entry.id, entry.shortcut!)) item.registerAccelerator = false;
    }
    // The native macOS App menu (built in `main/application-menu.ts`) owns a
    // real Cmd+Q via its own `role: 'quit'` item; File's own Quit stays for
    // parity with the Windows/Linux hamburger menu, but on macOS its
    // accelerator is display-only so the two never fight over the same chord.
    if (entry.id === 'file.quit' && platform === 'darwin') item.registerAccelerator = false;

    items.push(item);
  });
  return items;
}

/** Converts `buildAppMenus`' output into the plain template `main/application-menu.ts` builds the real macOS menu from — one top-level submenu per menu. */
export function serializeAppMenus(menus: MenubarMenu[], platform: StreamPlatform): SerializedMenuItem[] {
  return menus.map((menu): SerializedMenuItem => ({
    id: menu.id,
    label: menu.label,
    type: 'submenu',
    submenu: serializeEntries(menu.entries, menu.id as AppMenuId, platform),
  }));
}

function collectActions(entries: MenuEntry[], actions: Map<string, () => void>): void {
  for (const entry of entries) {
    if ('separator' in entry || 'heading' in entry) continue;
    if (entry.onSelect) actions.set(entry.id, entry.onSelect);
    if (entry.children) collectActions(entry.children, actions);
  }
}

/** Flattens every actionable item's `id -> onSelect` across all menus, for dispatching `stream:menu-action`/hamburger-menu selections by id. */
export function collectMenuActions(menus: MenubarMenu[]): Map<string, () => void> {
  const actions = new Map<string, () => void>();
  for (const menu of menus) collectActions(menu.entries, actions);
  return actions;
}
