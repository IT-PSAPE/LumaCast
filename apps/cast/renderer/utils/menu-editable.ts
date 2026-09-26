import { menuCommandClaimRegistry, menuCommandForEvent, type AppMenuCommandId } from '@lumacast/commands';

// Owned-scope helpers for native-menu Edit commands. A focused editable field
// owns cut/copy/paste/delete/undo/redo: the browser (or the clipboard
// fallback below) handles the operation and the command must never fall
// through to a canvas or global action underneath.

// A plain input/textarea, a contenteditable element, or a node nested inside
// a contenteditable region. Mirrors the keyboard shortcut hook's editable
// detection so menu clicks and chords agree on what "text focused" means.
export function getMenuEditableTarget(node: EventTarget | Node | null): HTMLElement | null {
  if (!(node instanceof HTMLElement)) return null;
  if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) return node;
  if (node.isContentEditable) return node;
  return node.closest<HTMLElement>('[contenteditable="true"]');
}

// Read-only (or disabled) fields cannot be modified: native cut/paste/delete
// are no-ops there, but the focused field still owns the command so nothing
// behind it is affected. Copy is still allowed to run natively.
export function isReadOnlyEditableTarget(target: HTMLElement): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return target.readOnly || target.disabled;
  }
  return false;
}

// Regions that opt out of app-level editing (dialogs, menus, pickers) via
// `data-shortcuts-scope="ignore"`. Mirrors the keyboard shortcut hook.
export function isMenuScopeIgnored(node: EventTarget | Node | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  return node.closest('[data-shortcuts-scope="ignore"]') !== null;
}

// document.execCommand is unavailable in some hosts and returns false for
// commands the browser refuses (notably 'paste' outside a trusted gesture).
// Never throws; a false return means "not handled natively", not "fall
// through to canvas" — callers decide ownership separately.
export function tryNativeEditCommand(command: string, value?: string): boolean {
  try {
    if (typeof document.execCommand !== 'function') return false;
    return document.execCommand(command, false, value) === true;
  } catch {
    return false;
  }
}

export interface MenuTextInsertion {
  target: HTMLInputElement | HTMLTextAreaElement;
  start: number;
  end: number;
  value: string;
}

// Captures the caret for an async clipboard paste. Returns null for
// contenteditable targets (caller uses the live DOM selection instead) and
// for inputs whose selection API is unavailable (e.g. type="number").
export function snapshotMenuTextInsertion(target: HTMLElement): MenuTextInsertion | null {
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return null;
  if (isReadOnlyEditableTarget(target)) return null;
  try {
    const start = target.selectionStart;
    const end = target.selectionEnd;
    if (start === null || end === null) return null;
    return { target, start, end, value: target.value };
  } catch {
    return null;
  }
}

// Inserts clipboard text into an input/textarea after an async clipboard
// read. Fails closed: when focus moved away, the node detached, or the
// insertion otherwise cannot land exactly where captured, nothing is
// inserted anywhere. Never throws and never reports fake success.
export function applyMenuTextInsertion(insertion: MenuTextInsertion, text: string): boolean {
  const { target } = insertion;
  try {
    if (text === '' || !target.isConnected || document.activeElement !== target || isReadOnlyEditableTarget(target)) return false;
    if (target.value !== insertion.value || target.selectionStart !== insertion.start || target.selectionEnd !== insertion.end) return false;
    const value = target.value;
    const from = Math.max(0, Math.min(Math.min(insertion.start, insertion.end), value.length));
    const to = Math.max(0, Math.min(Math.max(insertion.start, insertion.end), value.length));
    target.focus();
    // Native insert preserves the field's own undo history and notifies
    // listeners; fall back to a React-compatible manual splice below.
    if (tryNativeEditCommand('insertText', text)) return true;
    const next = `${value.slice(0, from)}${text}${value.slice(to)}`;
    // Assign through the native setter so React-controlled inputs observe
    // the change instead of silently diverging from the DOM value.
    const prototype = target instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor?.set) descriptor.set.call(target, next);
    else target.value = next;
    target.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text,
    }));
    const caret = from + text.length;
    try {
      target.setSelectionRange(caret, caret);
    } catch {
      // Caret placement is best-effort; the text already landed.
    }
    return true;
  } catch {
    return false;
  }
}

// Contenteditable equivalent of applyMenuTextInsertion: only the native
// insert path exists, so failure means "do nothing", never a manual DOM
// patch that could corrupt the editor's model.
export function applyMenuContentEditableInsertion(target: HTMLElement, text: string): boolean {
  try {
    if (text === '' || !target.isConnected || document.activeElement !== target) return false;
    target.focus();
    return tryNativeEditCommand('insertText', text);
  } catch {
    return false;
  }
}

// Mouse-driven Edit > Paste into a focused editable field. Tries the native
// paste first, then falls back to reading the clipboard through the main
// process and inserting at the live selection. Revalidates focus after the
// async read so a focus change mid-read inserts nothing anywhere. All errors
// (clipboard denial, detached node, missing execCommand) are absorbed: a
// failed menu paste does nothing rather than touching canvas state.
export async function pasteClipboardTextIntoEditable(target: HTMLElement): Promise<void> {
  if (isReadOnlyEditableTarget(target)) return;
  if (tryNativeEditCommand('paste')) return;
  const insertion = snapshotMenuTextInsertion(target);
  const selection = window.getSelection();
  const range = !insertion && selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  let text: string;
  try {
    text = await window.castApi.readClipboardText();
  } catch {
    return;
  }
  if (!text) return;
  if (!target.isConnected || document.activeElement !== target) return;
  if (insertion) {
    applyMenuTextInsertion(insertion, text);
    return;
  }
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
  const currentSelection = window.getSelection();
  if (!range || !currentSelection?.rangeCount) return;
  const currentRange = currentSelection.getRangeAt(0);
  if (range.startContainer !== currentRange.startContainer || range.startOffset !== currentRange.startOffset
    || range.endContainer !== currentRange.endContainer || range.endOffset !== currentRange.endOffset) return;
  applyMenuContentEditableInsertion(target, text);
}

// ─── Stale menu-claim guard ─────────────────────────────────────────────
// The keyboard hook claims the parallel native-menu command for every chord
// it sees (including chords the browser owns), and claims expire 300 ms
// after the keydown. A genuine menu echo arrives within milliseconds of its
// keydown, while a deliberate mouse click lands later — but a claim with no
// matching recent keydown at all is certainly stale (e.g. the echo already
// consumed, or the keydown happened in another context). Without protocol
// changes the keydown/echo pair cannot be correlated exactly, so this guard
// only drops a claim when a matching keydown was observed recently;
// otherwise the explicit click is honored instead of swallowed.
const STALE_MENU_CLICK_GUARD_MS = 350;

const lastMenuCommandKeydownAt = new Map<AppMenuCommandId, number>();

export function noteMenuCommandKeydown(event: KeyboardEvent): void {
  const command = menuCommandForEvent(event);
  if (command !== null) lastMenuCommandKeydownAt.set(command, Date.now());
}

export function consumeLiveMenuClaim(commandId: AppMenuCommandId): boolean {
  if (!menuCommandClaimRegistry.consume(commandId)) return false;
  const pressedAt = lastMenuCommandKeydownAt.get(commandId);
  return pressedAt !== undefined && Date.now() - pressedAt <= STALE_MENU_CLICK_GUARD_MS;
}

// Test support: keydown history is module-global, so hook tests reset it
// between cases to keep stale/fresh claim assertions deterministic.
export function resetMenuCommandKeydownHistory(): void {
  lastMenuCommandKeydownAt.clear();
}
