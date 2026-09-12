import { describe, expect, it } from 'vitest';
import { matchesShortcut } from '../../../../packages/commands/src/shortcut-matching';
import { SHORTCUTS } from '../../../../packages/commands/src/shortcuts';
import type { ShortcutDefinition } from '../../../../packages/commands/src/shortcuts';

function def(id: string): ShortcutDefinition {
  const d = SHORTCUTS.find((s) => s.id === id);
  if (!d) throw new Error(`Unknown shortcut id: ${id}`);
  return d;
}

function press(key: string, opts: Partial<Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>> = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    metaKey: opts.metaKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    altKey: opts.altKey ?? false,
  });
}

describe('matchesShortcut', () => {
  describe('exact matching — strict superset of declared modifiers must NOT match', () => {
    it('Cmd+1 does not match activateSlide (no modifiers allowed)', () => {
      expect(matchesShortcut(press('1', { metaKey: true }), def('activateSlide'))).toBe(false);
    });

    it('Shift+1 does not match activateSlide', () => {
      expect(matchesShortcut(press('1', { shiftKey: true }), def('activateSlide'))).toBe(false);
    });

    it('Cmd+Enter does not match takeSlide (no modifiers allowed)', () => {
      expect(matchesShortcut(press('Enter', { metaKey: true }), def('takeSlide'))).toBe(false);
    });

    it('Shift+Enter does not match takeSlide', () => {
      expect(matchesShortcut(press('Enter', { shiftKey: true }), def('takeSlide'))).toBe(false);
    });

    it('Cmd+Backspace does not match deleteSelected (no modifiers allowed)', () => {
      expect(matchesShortcut(press('Backspace', { metaKey: true }), def('deleteSelected'))).toBe(false);
    });

    it('Cmd+Alt+1 does not match setSlideBrowserMode (requires Alt only, not Cmd)', () => {
      expect(matchesShortcut(press('1', { metaKey: true, altKey: true }), def('setSlideBrowserMode'))).toBe(false);
    });

    it('Cmd+Shift+C does not match copySelection (no Shift allowed)', () => {
      expect(matchesShortcut(press('c', { metaKey: true, shiftKey: true }), def('copySelection'))).toBe(false);
    });

    it('Cmd+Alt+C does not match copySelection (no Alt allowed)', () => {
      expect(matchesShortcut(press('c', { metaKey: true, altKey: true }), def('copySelection'))).toBe(false);
    });
  });

  describe("'any' modifier is truly don't-care", () => {
    it('nudgeOrGoNext matches ArrowRight without Shift', () => {
      expect(matchesShortcut(press('ArrowRight'), def('nudgeOrGoNext'))).not.toBe(false);
    });

    it('nudgeOrGoNext matches ArrowRight with Shift', () => {
      expect(matchesShortcut(press('ArrowRight', { shiftKey: true }), def('nudgeOrGoNext'))).not.toBe(false);
    });

    it('nudgeUp matches ArrowUp without Shift', () => {
      expect(matchesShortcut(press('ArrowUp'), def('nudgeUp'))).not.toBe(false);
    });

    it('nudgeUp matches ArrowUp with Shift', () => {
      expect(matchesShortcut(press('ArrowUp', { shiftKey: true }), def('nudgeUp'))).not.toBe(false);
    });

    it('nudgeDown matches ArrowDown without Shift', () => {
      expect(matchesShortcut(press('ArrowDown'), def('nudgeDown'))).not.toBe(false);
    });

    it('nudgeDown matches ArrowDown with Shift', () => {
      expect(matchesShortcut(press('ArrowDown', { shiftKey: true }), def('nudgeDown'))).not.toBe(false);
    });
  });

  describe('meta is the Cmd/Ctrl union', () => {
    it('metaKey alone satisfies meta:true', () => {
      expect(matchesShortcut(press('z', { metaKey: true }), def('undo'))).not.toBe(false);
    });

    it('ctrlKey alone satisfies meta:true', () => {
      expect(matchesShortcut(press('z', { ctrlKey: true }), def('undo'))).not.toBe(false);
    });

    it('neither metaKey nor ctrlKey fails meta:true', () => {
      expect(matchesShortcut(press('z'), def('undo'))).toBe(false);
    });
  });

  describe('digit-range patterns', () => {
    it('in-range digit matches and returns the digit string', () => {
      expect(matchesShortcut(press('3'), def('activateSlide'))).toBe('3');
    });

    it('lower bound matches', () => {
      expect(matchesShortcut(press('1'), def('activateSlide'))).toBe('1');
    });

    it('upper bound matches', () => {
      expect(matchesShortcut(press('9'), def('activateSlide'))).toBe('9');
    });

    it('out-of-range digit does not match', () => {
      expect(matchesShortcut(press('0'), def('activateSlide'))).toBe(false);
    });

    it('non-digit key does not match', () => {
      expect(matchesShortcut(press('a'), def('activateSlide'))).toBe(false);
    });

    it('setSlideBrowserMode matches digit 1-2', () => {
      expect(matchesShortcut(press('2', { altKey: true }), def('setSlideBrowserMode'))).toBe('2');
    });

    it('setSlideBrowserMode rejects digit 3', () => {
      expect(matchesShortcut(press('3'), def('setSlideBrowserMode'))).toBe(false);
    });

  });

  describe('alternation patterns', () => {
    it('Enter matches takeSlide', () => {
      expect(matchesShortcut(press('Enter'), def('takeSlide'))).toBe(true);
    });

    it('Space matches takeSlide', () => {
      expect(matchesShortcut(press(' '), def('takeSlide'))).toBe(true);
    });

    it('Delete matches deleteSelected', () => {
      expect(matchesShortcut(press('Delete'), def('deleteSelected'))).toBe(true);
    });

    it('Backspace matches deleteSelected', () => {
      expect(matchesShortcut(press('Backspace'), def('deleteSelected'))).toBe(true);
    });

    it('Space literal means the spacebar key', () => {
      expect(matchesShortcut(press('Space'), def('takeSlide'))).toBe(false);
      expect(matchesShortcut(press(' '), def('takeSlide'))).toBe(true);
    });

    it('letter key matching is case-insensitive', () => {
      expect(matchesShortcut(press('C', { metaKey: true }), def('copySelection'))).not.toBe(false);
      expect(matchesShortcut(press('c', { metaKey: true }), def('copySelection'))).not.toBe(false);
    });
  });
});
