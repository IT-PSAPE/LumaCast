export type ShortcutCategory = 'editing' | 'navigation' | 'view' | 'playback';
export type ShortcutContext = 'always' | 'editSlideBrowser' | 'editWithSelection';

export interface ShortcutModifiers {
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface ShortcutAccelerator {
  mac: string;
  other: string;
}

export type ShortcutActionId =
  | 'copySelection'
  | 'cutSelection'
  | 'pasteSelection'
  | 'duplicateSelection'
  | 'undo'
  | 'redo'
  | 'globalUndo'
  | 'globalRedo'
  | 'openCommandPalette'
  | 'setPlaylistBrowserMode'
  | 'setSlideBrowserMode'
  | 'takeSlide'
  | 'deleteSelected'
  | 'clearSelection'
  | 'nudgeOrGoNext'
  | 'nudgeOrGoPrev'
  | 'nudgeUp'
  | 'nudgeDown'
  | 'activateSlide';

export interface ShortcutDefinition {
  id: ShortcutActionId;
  label: string;
  category: ShortcutCategory;
  context: ShortcutContext;
  key: string;
  modifiers?: ShortcutModifiers;
  accelerator: ShortcutAccelerator;
}

export const SHORTCUTS: readonly ShortcutDefinition[] = [
  {
    id: 'copySelection',
    label: 'Copy',
    category: 'editing',
    context: 'editSlideBrowser',
    key: 'c',
    modifiers: { meta: true },
    accelerator: { mac: 'Cmd+C', other: 'Ctrl+C' },
  },
  {
    id: 'cutSelection',
    label: 'Cut',
    category: 'editing',
    context: 'editWithSelection',
    key: 'x',
    modifiers: { meta: true },
    accelerator: { mac: 'Cmd+X', other: 'Ctrl+X' },
  },
  {
    id: 'pasteSelection',
    label: 'Paste',
    category: 'editing',
    context: 'editSlideBrowser',
    key: 'v',
    modifiers: { meta: true },
    accelerator: { mac: 'Cmd+V', other: 'Ctrl+V' },
  },
  {
    id: 'duplicateSelection',
    label: 'Duplicate',
    category: 'editing',
    context: 'editWithSelection',
    key: 'd',
    modifiers: { meta: true },
    accelerator: { mac: 'Cmd+D', other: 'Ctrl+D' },
  },
  {
    id: 'redo',
    label: 'Redo',
    category: 'editing',
    context: 'editSlideBrowser',
    key: 'z',
    modifiers: { meta: true, shift: true },
    accelerator: { mac: 'Cmd+Shift+Z', other: 'Ctrl+Shift+Z' },
  },
  {
    id: 'undo',
    label: 'Undo',
    category: 'editing',
    context: 'editSlideBrowser',
    key: 'z',
    modifiers: { meta: true, shift: false },
    accelerator: { mac: 'Cmd+Z', other: 'Ctrl+Z' },
  },
  {
    id: 'globalRedo',
    label: 'Redo (app)',
    category: 'editing',
    context: 'always',
    key: 'z',
    modifiers: { meta: true, shift: true },
    accelerator: { mac: 'Cmd+Shift+Z', other: 'Ctrl+Shift+Z' },
  },
  {
    id: 'globalUndo',
    label: 'Undo (app)',
    category: 'editing',
    context: 'always',
    key: 'z',
    modifiers: { meta: true, shift: false },
    accelerator: { mac: 'Cmd+Z', other: 'Ctrl+Z' },
  },
  {
    id: 'openCommandPalette',
    label: 'Open command palette',
    category: 'navigation',
    context: 'always',
    key: 'k',
    modifiers: { meta: true },
    accelerator: { mac: 'Cmd+K', other: 'Ctrl+K' },
  },
  {
    id: 'setPlaylistBrowserMode',
    label: 'Switch playlist view (current / tabs / continuous)',
    category: 'view',
    context: 'always',
    key: '1-3',
    modifiers: { alt: true, shift: true },
    accelerator: { mac: 'Alt+Shift+1-3', other: 'Alt+Shift+1-3' },
  },
  {
    id: 'setSlideBrowserMode',
    label: 'Switch slide view (grid / list)',
    category: 'view',
    context: 'always',
    key: '1-2',
    modifiers: { alt: true, shift: false },
    accelerator: { mac: 'Alt+1-2', other: 'Alt+1-2' },
  },
  {
    id: 'takeSlide',
    label: 'Take selected slide',
    category: 'playback',
    context: 'always',
    key: 'Enter|Space',
    accelerator: { mac: 'Enter / Space', other: 'Enter / Space' },
  },
  {
    id: 'deleteSelected',
    label: 'Delete selected element or slide',
    category: 'editing',
    context: 'editSlideBrowser',
    key: 'Delete|Backspace',
    accelerator: { mac: 'Delete / Backspace', other: 'Delete / Backspace' },
  },
  {
    id: 'clearSelection',
    label: 'Clear selection',
    category: 'editing',
    context: 'editWithSelection',
    key: 'Escape',
    accelerator: { mac: 'Escape', other: 'Escape' },
  },
  {
    id: 'nudgeOrGoNext',
    label: 'Nudge right (editing) or next slide',
    category: 'editing',
    context: 'always',
    key: 'ArrowRight',
    accelerator: { mac: 'Right Arrow', other: 'Right Arrow' },
  },
  {
    id: 'nudgeOrGoPrev',
    label: 'Nudge left (editing) or previous slide',
    category: 'editing',
    context: 'always',
    key: 'ArrowLeft',
    accelerator: { mac: 'Left Arrow', other: 'Left Arrow' },
  },
  {
    id: 'nudgeUp',
    label: 'Nudge selection up (Shift = 10px)',
    category: 'editing',
    context: 'editWithSelection',
    key: 'ArrowUp',
    accelerator: { mac: 'Up Arrow', other: 'Up Arrow' },
  },
  {
    id: 'nudgeDown',
    label: 'Nudge selection down (Shift = 10px)',
    category: 'editing',
    context: 'editWithSelection',
    key: 'ArrowDown',
    accelerator: { mac: 'Down Arrow', other: 'Down Arrow' },
  },
  {
    id: 'activateSlide',
    label: 'Take slide by index',
    category: 'playback',
    context: 'always',
    key: '1-9',
    accelerator: { mac: '1-9', other: '1-9' },
  },
];
