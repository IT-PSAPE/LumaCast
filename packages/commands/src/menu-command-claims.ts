import type { ShortcutActionId } from './shortcuts';
import type { AppMenuCommandId } from './app-menu';

// The native menu chords that would re-trigger an app action underneath a
// context the renderer decided should not reach the app dispatcher (an
// editable surface, a `data-shortcuts-scope="ignore"` region, or an open
// modal overlay). `registerAccelerator: false` only applies on Linux/Windows;
// macOS always registers the accelerator, so the renderer must claim the
// parallel menu command even for keydowns it deliberately does NOT act on.
// Exact-match contract mirroring the Edit/Playback accelerator table in
// app/main/application-menu.ts: an omitted modifier must not be pressed.
export function menuCommandForEvent(event: KeyboardEvent): AppMenuCommandId | null {
  const meta = event.metaKey || event.ctrlKey;
  if (meta && !event.altKey) {
    const key = event.key.toLowerCase();
    if (key === 'z') return event.shiftKey ? 'edit.redo' : 'edit.undo';
    if (event.shiftKey) return null;
    if (key === 'c') return 'edit.copy';
    if (key === 'x') return 'edit.cut';
    if (key === 'v') return 'edit.paste';
    if (key === 'd') return 'edit.duplicate';
    if (key === 'k') return 'view.openCommandPalette';
    return null;
  }
  if (!meta && !event.altKey && !event.shiftKey) {
    if (event.key === 'Delete' || event.key === 'Backspace') return 'edit.delete';
    if (event.key === 'Escape') return 'edit.clearSelection';
    if (event.key === 'Enter') return 'playback.takeSlide';
    if (event.key === 'ArrowLeft') return 'playback.previousSlide';
    if (event.key === 'ArrowRight') return 'playback.nextSlide';
  }
  return null;
}
/**
 * Mapping from renderer shortcut that duplicates a native menu command.
 * When the renderer handles the keydown first, it claims the menu command
 * so the subsequent IPC menu event from Electron can be ignored.
 */
export const SHORTCUT_TO_MENU_COMMAND: Readonly<
  Partial<Record<ShortcutActionId, AppMenuCommandId>>
> = {
  copySelection: 'edit.copy',
  cutSelection: 'edit.cut',
  pasteSelection: 'edit.paste',
  duplicateSelection: 'edit.duplicate',
  deleteSelected: 'edit.delete',
  clearSelection: 'edit.clearSelection',
  undo: 'edit.undo',
  globalUndo: 'edit.undo',
  redo: 'edit.redo',
  globalRedo: 'edit.redo',
  openCommandPalette: 'view.openCommandPalette',
  takeSlide: 'playback.takeSlide',
  nudgeOrGoNext: 'playback.nextSlide',
  nudgeOrGoPrev: 'playback.previousSlide',
} as const;

// Worst-case observed delay between the renderer `keydown` and the
// Electron menu IPC is 17 ms (Cmd+X). 300 ms gives ~17× headroom for
// scheduling jitter under load, while remaining well below the fastest
// intentional mouse click on a menu item (typically >400-500 ms), so a
// deliberate click is never swallowed.
const DEFAULT_TTL_MS = 300;

export interface MenuCommandClaimRegistryOptions {
  now?: () => number;
  ttlMs?: number;
}

export interface MenuCommandClaimRegistry {
  claim(commandId: AppMenuCommandId): void;
  claimForShortcut(actionId: ShortcutActionId): void;
  consume(commandId: AppMenuCommandId): boolean;
  reset(): void;
}

export function createMenuCommandClaimRegistry(
  options: MenuCommandClaimRegistryOptions = {},
): MenuCommandClaimRegistry {
  const now = options.now ?? (() => Date.now());
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const claims = new Map<AppMenuCommandId, number>();

  return {
    claim(commandId: AppMenuCommandId): void {
      claims.set(commandId, now());
    },

    claimForShortcut(actionId: ShortcutActionId): void {
      const commandId = SHORTCUT_TO_MENU_COMMAND[actionId];
      if (commandId) {
        claims.set(commandId, now());
      }
    },

    consume(commandId: AppMenuCommandId): boolean {
      const claimedAt = claims.get(commandId);
      if (claimedAt === undefined) return false;
      // Consumed on read — always delete so a later click is not swallowed.
      claims.delete(commandId);
      return now() - claimedAt <= ttlMs;
    },

    reset(): void {
      claims.clear();
    },
  };
}

// Shared singleton used by the renderer hooks. Kept resettable/injectable
// via `createMenuCommandClaimRegistry` for unit tests — tests create their
// own registry with a fake clock instead of mutating this instance.
export const menuCommandClaimRegistry = createMenuCommandClaimRegistry();
