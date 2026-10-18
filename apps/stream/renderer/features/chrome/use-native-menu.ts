import { useEffect, useRef } from 'react';
import type { MenubarMenu } from '@lumacast/ui';
import { collectMenuActions, serializeAppMenus } from '../../chrome/app-menu';
import type { StreamAPI } from '../../../shared/desktop-api';
import type { StreamPlatform } from '../../../shared/platform-capabilities';

export interface UseNativeMenuParams {
  api: StreamAPI;
  platform: StreamPlatform;
  menus: MenubarMenu[];
}

// Undo/Redo/Copy/Paste reach the renderer through `stream:menu-action` even
// while a text field has focus (main's `click` handler calls the focused
// webContents' native undo()/redo()/copy()/paste() *and* sends the id, so the
// same Cmd+Z/C/V works for both typing and selected sources — see
// `main/application-menu.ts`). When a text field already handled it natively,
// the renderer's own action (scene undo, source copy/paste) must not also run.
const TEXT_EDITING_ACTION_IDS = new Set(['edit.undo', 'edit.redo', 'edit.copy', 'edit.paste']);

function focusIsEditable(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
    || (active instanceof HTMLElement && active.isContentEditable);
}

/**
 * Keeps the real macOS application menu in sync with the same `MenubarMenu[]`
 * the hamburger menu renders on Windows/Linux, and dispatches
 * `stream:menu-action` back into the matching `onSelect`. The debounce
 * coalesces the burst of context changes a single user action can cause
 * (selection, undo stack, dock visibility, …) into one `setApplicationMenu`
 * call. Windows/Linux never talk to main here — `platform !== 'darwin'` skips
 * the sync entirely, since their menu lives only in the renderer.
 */
export function useNativeMenu({ api, platform, menus }: UseNativeMenuParams): void {
  const actionsRef = useRef<Map<string, () => void>>(new Map());
  actionsRef.current = collectMenuActions(menus);

  // A hot-reloaded renderer can briefly run against a preload that predates these
  // methods; skip native sync until main/preload catch up instead of crashing.
  useEffect(() => {
    if (typeof api.onMenuAction !== 'function') return;
    return api.onMenuAction((id) => {
      if (TEXT_EDITING_ACTION_IDS.has(id) && focusIsEditable()) return;
      actionsRef.current.get(id)?.();
    });
  }, [api]);

  useEffect(() => {
    if (platform !== 'darwin' || typeof api.setApplicationMenu !== 'function') return;
    const timer = window.setTimeout(() => {
      void api.setApplicationMenu(serializeAppMenus(menus, platform)).catch(() => undefined);
    }, 50);
    return () => window.clearTimeout(timer);
  }, [api, platform, menus]);
}
