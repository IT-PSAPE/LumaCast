export type ShortcutCategory = 'editing' | 'navigation' | 'view' | 'playback';
export type ShortcutContext = 'always' | 'editSlideBrowser' | 'editWithSelection';

export interface ShortcutModifiers {
  /**
   * Exact-match contract: an omitted modifier means that modifier MUST NOT be
   * pressed. Use the literal `'any'` to explicitly tolerate either state.
   * `'any'` is needed for shortcuts like the nudge actions where the handler
   * reads `event.shiftKey` at dispatch time to choose a distance (1px vs
   * 10px) — the shortcut must match both with and without Shift held. All
   * other shortcuts declare their exact required modifiers so a chord that is
   * a strict superset does not match.
   *
   * `meta` is the Cmd-or-Ctrl union (`event.metaKey || event.ctrlKey`), kept
   * from the previous contract.
   */
  meta?: boolean | 'any';
  shift?: boolean | 'any';
  alt?: boolean | 'any';
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
    modifiers: { meta: true, shift: false, alt: false },
    accelerator: { mac: 'Cmd+C', other: 'Ctrl+C' },
  },
  {
    id: 'cutSelection',
    label: 'Cut',
    category: 'editing',
    context: 'editWithSelection',
    key: 'x',
    modifiers: { meta: true, shift: false, alt: false },
    accelerator: { mac: 'Cmd+X', other: 'Ctrl+X' },
  },
  {
    id: 'pasteSelection',
    label: 'Paste',
    category: 'editing',
    context: 'editSlideBrowser',
    key: 'v',
    modifiers: { meta: true, shift: false, alt: false },
    accelerator: { mac: 'Cmd+V', other: 'Ctrl+V' },
  },
  {
    id: 'duplicateSelection',
    label: 'Duplicate',
    category: 'editing',
    context: 'editWithSelection',
    key: 'd',
    modifiers: { meta: true, shift: false, alt: false },
    accelerator: { mac: 'Cmd+D', other: 'Ctrl+D' },
  },
  {
    id: 'redo',
    label: 'Redo',
    category: 'editing',
    context: 'editSlideBrowser',
    key: 'z',
    modifiers: { meta: true, shift: true, alt: false },
    accelerator: { mac: 'Cmd+Shift+Z', other: 'Ctrl+Shift+Z' },
  },
  {
    id: 'undo',
    label: 'Undo',
    category: 'editing',
    context: 'editSlideBrowser',
    key: 'z',
    modifiers: { meta: true, shift: false, alt: false },
    accelerator: { mac: 'Cmd+Z', other: 'Ctrl+Z' },
  },
  {
    id: 'globalRedo',
    label: 'Redo (app)',
    category: 'editing',
    context: 'always',
    key: 'z',
    modifiers: { meta: true, shift: true, alt: false },
    accelerator: { mac: 'Cmd+Shift+Z', other: 'Ctrl+Shift+Z' },
  },
  {
    id: 'globalUndo',
    label: 'Undo (app)',
    category: 'editing',
    context: 'always',
    key: 'z',
    modifiers: { meta: true, shift: false, alt: false },
    accelerator: { mac: 'Cmd+Z', other: 'Ctrl+Z' },
  },
  {
    id: 'openCommandPalette',
    label: 'Open command palette',
    category: 'navigation',
    context: 'always',
    key: 'k',
    modifiers: { meta: true, shift: false, alt: false },
    accelerator: { mac: 'Cmd+K', other: 'Ctrl+K' },
  },
  {
    id: 'setSlideBrowserMode',
    label: 'Switch slide view (grid / list)',
    category: 'view',
    context: 'always',
    key: '1-2',
    modifiers: { meta: false, alt: true, shift: false },
    accelerator: { mac: 'Alt+1-2', other: 'Alt+1-2' },
  },
  {
    id: 'takeSlide',
    label: 'Take selected slide',
    category: 'playback',
    context: 'always',
    key: 'Enter|Space',
    modifiers: { meta: false, shift: false, alt: false },
    accelerator: { mac: 'Enter / Space', other: 'Enter / Space' },
  },
  {
    id: 'deleteSelected',
    label: 'Delete selected element or slide',
    category: 'editing',
    context: 'always',
    key: 'Delete|Backspace',
    modifiers: { meta: false, shift: false, alt: false },
    accelerator: { mac: 'Delete / Backspace', other: 'Delete / Backspace' },
  },
  {
    id: 'clearSelection',
    label: 'Clear selection',
    category: 'editing',
    context: 'editWithSelection',
    key: 'Escape',
    modifiers: { meta: false, shift: false, alt: false },
    accelerator: { mac: 'Escape', other: 'Escape' },
  },
  {
    id: 'nudgeOrGoNext',
    label: 'Nudge right (editing) or next slide',
    category: 'editing',
    context: 'always',
    key: 'ArrowRight',
    modifiers: { meta: false, shift: 'any', alt: false },
    accelerator: { mac: 'Right Arrow', other: 'Right Arrow' },
  },
  {
    id: 'nudgeOrGoPrev',
    label: 'Nudge left (editing) or previous slide',
    category: 'editing',
    context: 'always',
    key: 'ArrowLeft',
    modifiers: { meta: false, shift: 'any', alt: false },
    accelerator: { mac: 'Left Arrow', other: 'Left Arrow' },
  },
  {
    id: 'nudgeUp',
    label: 'Nudge selection up (Shift = 10px)',
    category: 'editing',
    context: 'editWithSelection',
    key: 'ArrowUp',
    modifiers: { meta: false, shift: 'any', alt: false },
    accelerator: { mac: 'Up Arrow', other: 'Up Arrow' },
  },
  {
    id: 'nudgeDown',
    label: 'Nudge selection down (Shift = 10px)',
    category: 'editing',
    context: 'editWithSelection',
    key: 'ArrowDown',
    modifiers: { meta: false, shift: 'any', alt: false },
    accelerator: { mac: 'Down Arrow', other: 'Down Arrow' },
  },
  {
    id: 'activateSlide',
    label: 'Take slide by index',
    category: 'playback',
    context: 'always',
    key: '1-9',
    modifiers: { meta: false, shift: false, alt: false },
    accelerator: { mac: '1-9', other: '1-9' },
  },
];
