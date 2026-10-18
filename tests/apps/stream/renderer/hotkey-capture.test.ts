// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { acceleratorFromKeyEvent, classifyHotkeyCapture, type HotkeyCaptureKeyEvent } from '../../../../apps/stream/renderer/hotkey-capture';

function keyEvent(key: string, modifiers: Partial<Omit<HotkeyCaptureKeyEvent, 'key' | 'repeat'>> = {}): HotkeyCaptureKeyEvent {
  return { key, repeat: false, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers };
}

describe('acceleratorFromKeyEvent', () => {
  it('combines modifiers with a letter key', () => {
    expect(acceleratorFromKeyEvent(keyEvent('f', { ctrlKey: true, altKey: true }))).toBe('Control+Alt+F');
  });

  it('returns null for a key with no modifier held', () => {
    expect(acceleratorFromKeyEvent(keyEvent('f'))).toBeNull();
  });

  it('returns null for a bare modifier key', () => {
    expect(acceleratorFromKeyEvent(keyEvent('Control', { ctrlKey: true }))).toBeNull();
  });

  it('supports function keys', () => {
    expect(acceleratorFromKeyEvent(keyEvent('F9', { ctrlKey: true }))).toBe('Control+F9');
  });

  it('supports arrow keys, Space and Plus', () => {
    expect(acceleratorFromKeyEvent(keyEvent('ArrowUp', { shiftKey: true }))).toBe('Shift+Up');
    expect(acceleratorFromKeyEvent(keyEvent(' ', { metaKey: true }))).toBe('Super+Space');
    expect(acceleratorFromKeyEvent(keyEvent('+', { ctrlKey: true }))).toBe('Control+Plus');
  });

  it('allows Escape to form an accelerator when a modifier is held', () => {
    expect(acceleratorFromKeyEvent(keyEvent('Escape', { ctrlKey: true }))).toBe('Control+Escape');
  });
});

describe('classifyHotkeyCapture', () => {
  it('cancels on Escape even without a modifier', () => {
    expect(classifyHotkeyCapture(keyEvent('Escape'))).toEqual({ kind: 'cancel' });
  });

  it('cancels on Escape even with a modifier held, unlike a plain accelerator capture', () => {
    expect(classifyHotkeyCapture(keyEvent('Escape', { ctrlKey: true }))).toEqual({ kind: 'cancel' });
  });

  it('clears the binding on Backspace or Delete', () => {
    expect(classifyHotkeyCapture(keyEvent('Backspace'))).toEqual({ kind: 'clear' });
    expect(classifyHotkeyCapture(keyEvent('Delete'))).toEqual({ kind: 'clear' });
  });

  it('ignores a bare modifier key press (no error, waiting for the real key)', () => {
    expect(classifyHotkeyCapture(keyEvent('Control', { ctrlKey: true }))).toEqual({ kind: 'ignore' });
    expect(classifyHotkeyCapture(keyEvent('Shift', { shiftKey: true }))).toEqual({ kind: 'ignore' });
  });

  it('flags a key with no modifier as invalid', () => {
    expect(classifyHotkeyCapture(keyEvent('f'))).toEqual({ kind: 'invalid' });
  });

  it('captures a valid modifier+key combination as an accelerator', () => {
    expect(classifyHotkeyCapture(keyEvent('9', { ctrlKey: true, altKey: true }))).toEqual({ kind: 'accelerator', value: 'Control+Alt+9' });
  });
});
