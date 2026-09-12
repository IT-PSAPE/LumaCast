import { describe, expect, it } from 'vitest';
import { SHORTCUTS, type ShortcutActionId, type ShortcutDefinition } from '../../../../packages/commands/src/shortcuts';

describe('SHORTCUTS table', () => {
  it('every ShortcutActionId appears exactly once', () => {
    const allIds: ShortcutActionId[] = [
      'copySelection', 'cutSelection', 'pasteSelection', 'duplicateSelection',
      'undo', 'redo', 'globalUndo', 'globalRedo',
      'openCommandPalette', 'setSlideBrowserMode',
      'takeSlide', 'deleteSelected', 'clearSelection',
      'nudgeOrGoNext', 'nudgeOrGoPrev', 'nudgeUp', 'nudgeDown', 'activateSlide',
    ];
    const ids = SHORTCUTS.map((s) => s.id);
    for (const id of allIds) {
      expect(ids.filter((i) => i === id)).toHaveLength(1);
    }
    expect(ids).toHaveLength(allIds.length);
  });

  it('table is unambiguous except for the two deliberate context-only pairs', () => {
    function modifiersKey(s: { key: string; modifiers?: { meta?: boolean | 'any'; shift?: boolean | 'any'; alt?: boolean | 'any' } }) {
      const m = s.modifiers ?? {};
      return `${s.key}|${m.meta ?? '-'}|${m.shift ?? '-'}|${m.alt ?? '-'}`;
    }

    const bySignature = new Map<string, ShortcutDefinition[]>();
    for (const s of SHORTCUTS) {
      const sig = modifiersKey(s);
      const existing = bySignature.get(sig) ?? [];
      existing.push(s);
      bySignature.set(sig, existing);
    }

    const ambiguousPairs = [...bySignature.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([, group]) => group.map((s) => `${s.id}(ctx:${s.context})`).join(' vs '));

    expect(ambiguousPairs).toEqual([
      'redo(ctx:editSlideBrowser) vs globalRedo(ctx:always)',
      'undo(ctx:editSlideBrowser) vs globalUndo(ctx:always)',
    ]);
  });

  it('scoped undo/redo are placed before their global counterparts (first-match-wins ordering)', () => {
    const ids = SHORTCUTS.map((s) => s.id);
    const undoIdx = ids.indexOf('undo');
    const globalUndoIdx = ids.indexOf('globalUndo');
    const redoIdx = ids.indexOf('redo');
    const globalRedoIdx = ids.indexOf('globalRedo');

    // Scoped entries come first so that when the shortcut dispatcher iterates
    // SHORTCUTS and stops at the first match, the context-scoped entry wins
    // inside editor modes while the global fallback wins outside them.
    expect(undoIdx).toBeLessThan(globalUndoIdx);
    expect(redoIdx).toBeLessThan(globalRedoIdx);
  });

  it('accelerator strings are consistent with declared key and modifiers', () => {
    for (const s of SHORTCUTS) {
      const m = s.modifiers ?? {};
      const parts = s.accelerator.mac.split('+');
      const lastPart = parts[parts.length - 1];

      if (m.meta) expect(s.accelerator.mac).toMatch(/^Cmd\+/);
      if (m.meta) expect(s.accelerator.other).toMatch(/^Ctrl\+/);
      if (m.shift === true) expect(s.accelerator.mac).toMatch(/Shift\+/);
      if (m.alt === true) expect(s.accelerator.mac).toMatch(/Alt\+/);

      if (!m.meta) {
        expect(s.accelerator.mac).not.toMatch(/^Cmd\+/);
        expect(s.accelerator.other).not.toMatch(/^Ctrl\+/);
      }
      if (m.shift !== true) expect(s.accelerator.mac).not.toMatch(/Shift\+/);
      if (m.alt !== true) expect(s.accelerator.mac).not.toMatch(/Alt\+/);

      if (s.key.includes('-') && !s.key.includes('|')) {
        expect(lastPart).toBe(s.key);
      }
    }
  });
});
