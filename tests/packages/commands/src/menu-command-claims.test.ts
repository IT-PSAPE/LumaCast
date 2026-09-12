import { describe, expect, it } from 'vitest';
import {
  createMenuCommandClaimRegistry,
  menuCommandClaimRegistry,
  menuCommandForEvent,
  type MenuCommandClaimRegistry,
} from '../../../../packages/commands/src/menu-command-claims';

function makeFakeNow() {
  let t = 0;
  const now = () => t;
  const advance = (ms: number) => {
    t += ms;
  };
  return { now, advance };
}

function makeRegistry(ttlMs: number): { registry: MenuCommandClaimRegistry; advance: (ms: number) => void; now: () => number } {
  const { now, advance } = makeFakeNow();
  const registry = createMenuCommandClaimRegistry({ now, ttlMs });
  return { registry, advance, now };
}

describe('createMenuCommandClaimRegistry', () => {
  it('a claim from claimForShortcut is consumed once by the matching menu command and then not again', () => {
    const { registry } = makeRegistry(300);

    registry.claimForShortcut('copySelection');
    expect(registry.consume('edit.copy')).toBe(true);
    expect(registry.consume('edit.copy')).toBe(false);
  });

  it('a claim older than the ttl is not honoured and is cleared after consume', () => {
    const { registry, advance } = makeRegistry(300);

    registry.claimForShortcut('pasteSelection');
    advance(301);

    expect(registry.consume('edit.paste')).toBe(false);
    // The expired claim must be cleared, not left behind.
    expect(registry.consume('edit.paste')).toBe(false);
  });

  it('a claim exactly at the ttl boundary is still honoured', () => {
    const { registry, advance } = makeRegistry(300);

    registry.claim('edit.cut');
    advance(300);

    expect(registry.consume('edit.cut')).toBe(true);
  });

  it('consume returns false for a command that was never claimed', () => {
    const { registry } = makeRegistry(300);

    expect(registry.consume('edit.undo')).toBe(false);
    expect(registry.consume('view.openCommandPalette')).toBe(false);
  });

  it('claimForShortcut for a shortcut with no menu equivalent claims nothing', () => {
    const { registry } = makeRegistry(300);

    registry.claimForShortcut('setSlideBrowserMode');
    registry.claimForShortcut('nudgeUp');
    registry.claimForShortcut('nudgeDown');
    registry.claimForShortcut('activateSlide');

    expect(registry.consume('view.slideBrowser.grid')).toBe(false);
    expect(registry.consume('view.slideBrowser.list')).toBe(false);
    expect(registry.consume('playback.takeSlide')).toBe(false);
  });

  it('undo and globalUndo both claim edit.undo', () => {
    const { registry } = makeRegistry(300);

    registry.claimForShortcut('undo');
    expect(registry.consume('edit.undo')).toBe(true);

    registry.claimForShortcut('globalUndo');
    expect(registry.consume('edit.undo')).toBe(true);
  });

  it('redo and globalRedo both claim edit.redo', () => {
    const { registry } = makeRegistry(300);

    registry.claimForShortcut('redo');
    expect(registry.consume('edit.redo')).toBe(true);

    registry.claimForShortcut('globalRedo');
    expect(registry.consume('edit.redo')).toBe(true);
  });

  it('reset drops outstanding claims', () => {
    const { registry } = makeRegistry(300);

    registry.claimForShortcut('deleteSelected');
    registry.reset();

    expect(registry.consume('edit.delete')).toBe(false);
  });

  it('the exported singleton exists and is independent of registries created for tests', () => {
    const { registry } = makeRegistry(300);

    registry.claim('edit.copy');

    // The singleton is a separate instance and is unaffected by our test registry.
    expect(menuCommandClaimRegistry).not.toBe(registry);
    expect(menuCommandClaimRegistry.consume('edit.copy')).toBe(false);
  });
});

describe('menuCommandForEvent — which native-menu command a keydown parallels', () => {
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

  it.each([
    ['c', { metaKey: true }, 'edit.copy'],
    ['x', { metaKey: true }, 'edit.cut'],
    ['v', { metaKey: true }, 'edit.paste'],
    ['d', { metaKey: true }, 'edit.duplicate'],
    ['k', { metaKey: true }, 'view.openCommandPalette'],
    ['z', { metaKey: true }, 'edit.undo'],
    ['z', { metaKey: true, shiftKey: true }, 'edit.redo'],
  ])('Cmd+%s maps to %s', (key, opts, expected) => {
    expect(menuCommandForEvent(press(String(key), opts as { shiftKey?: boolean }))).toBe(expected);
  });

  it.each([
    ['Delete', 'edit.delete'],
    ['Backspace', 'edit.delete'],
    ['Escape', 'edit.clearSelection'],
    ['Enter', 'playback.takeSlide'],
    ['ArrowLeft', 'playback.previousSlide'],
    ['ArrowRight', 'playback.nextSlide'],
  ])('%s with no modifiers maps to %s', (key, expected) => {
    expect(menuCommandForEvent(press(key))).toBe(expected);
  });

  it('Ctrl satisfies the meta union, same as the shortcut matcher', () => {
    expect(menuCommandForEvent(press('c', { ctrlKey: true }))).toBe('edit.copy');
    expect(menuCommandForEvent(press('z', { ctrlKey: true }))).toBe('edit.undo');
    expect(menuCommandForEvent(press('z', { ctrlKey: true, shiftKey: true }))).toBe('edit.redo');
  });

  it('letter-matching is case-insensitive', () => {
    expect(menuCommandForEvent(press('C', { metaKey: true }))).toBe('edit.copy');
  });

  it('a chord that is a strict superset of a menu accelerator does not parallel it', () => {
    // The menu registers plain Cmd+C / Enter, never Cmd+Shift+C etc.
    expect(menuCommandForEvent(press('c', { metaKey: true, shiftKey: true }))).toBeNull();
    expect(menuCommandForEvent(press('c', { metaKey: true, altKey: true }))).toBeNull();
    expect(menuCommandForEvent(press('Enter', { shiftKey: true }))).toBeNull();
    expect(menuCommandForEvent(press('Enter', { altKey: true }))).toBeNull();
    expect(menuCommandForEvent(press('ArrowLeft', { shiftKey: true }))).toBeNull();
    // Cmd/Z is the only chord where Shift is meaningful (undo vs redo).
    expect(menuCommandForEvent(press('z', { metaKey: true, altKey: true }))).toBeNull();
  });

  it('chords the app menu does not register return null', () => {
    expect(menuCommandForEvent(press(' '))).toBeNull();
    expect(menuCommandForEvent(press('1'))).toBeNull();
    expect(menuCommandForEvent(press('ArrowUp'))).toBeNull();
    expect(menuCommandForEvent(press('a'))).toBeNull();
    expect(menuCommandForEvent(press('e', { metaKey: true }))).toBeNull();
    // File/settings accelerators are deliberately outside the scope bridge.
    expect(menuCommandForEvent(press('n', { metaKey: true }))).toBeNull();
    expect(menuCommandForEvent(press(',', { metaKey: true }))).toBeNull();
  });
});
