import { describe, expect, it, vi } from 'vitest';
import { handleEditableTextShortcut } from './editable-text-shortcuts';

function flushPromises(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('handleEditableTextShortcut', () => {
  it('copies the selected textarea text to the clipboard bridge', async () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'Alpha Beta';
    textarea.setSelectionRange(0, 5);

    const writeText = vi.fn().mockResolvedValue(undefined);
    const event = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true });

    const handled = handleEditableTextShortcut(event, textarea, {
      readText: vi.fn(),
      writeText,
    });

    await flushPromises();

    expect(handled).toBe(true);
    expect(writeText).toHaveBeenCalledWith('Alpha');
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not intercept paste shortcuts', async () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'Hello world';
    textarea.setSelectionRange(6, 11);

    const event = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true });
    const handled = handleEditableTextShortcut(event, textarea, {
      readText: vi.fn().mockResolvedValue('Recast'),
      writeText: vi.fn(),
    });

    await flushPromises();

    expect(handled).toBe(false);
    expect(textarea.value).toBe('Hello world');
    expect(event.defaultPrevented).toBe(false);
  });

  it('cuts the selected input text and updates the value', async () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = 'Recast app';
    input.setSelectionRange(0, 6);

    const writeText = vi.fn().mockResolvedValue(undefined);
    const event = new KeyboardEvent('keydown', { key: 'x', metaKey: true, bubbles: true, cancelable: true });
    const handled = handleEditableTextShortcut(event, input, {
      readText: vi.fn(),
      writeText,
    });

    await flushPromises();

    expect(handled).toBe(true);
    expect(writeText).toHaveBeenCalledWith('Recast');
    expect(input.value).toBe(' app');
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores non-editable targets', () => {
    const target = document.createElement('div');
    const event = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true });

    const handled = handleEditableTextShortcut(event, target, {
      readText: vi.fn(),
      writeText: vi.fn(),
    });

    expect(handled).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });
});
