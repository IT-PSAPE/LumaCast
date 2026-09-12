import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { menuCommandClaimRegistry } from '@lumacast/commands';
import {
  applyMenuContentEditableInsertion,
  applyMenuTextInsertion,
  consumeLiveMenuClaim,
  getMenuEditableTarget,
  isMenuScopeIgnored,
  isReadOnlyEditableTarget,
  noteMenuCommandKeydown,
  pasteClipboardTextIntoEditable,
  resetMenuCommandKeydownHistory,
  snapshotMenuTextInsertion,
  tryNativeEditCommand,
} from '../../../../app/renderer/utils/menu-editable';

const execCommandMock = vi.fn();

function stubExecCommand(): void {
  Object.defineProperty(document, 'execCommand', {
    value: execCommandMock,
    configurable: true,
    writable: true,
  });
}

function setCastApi(partial: Record<string, unknown> = {}): void {
  (window as unknown as { castApi: Record<string, unknown> }).castApi = {
    readClipboardText: vi.fn().mockResolvedValue(''),
    ...partial,
  } as unknown as Record<string, unknown>;
}

beforeEach(() => {
  execCommandMock.mockReset();
  stubExecCommand();
  setCastApi();
  menuCommandClaimRegistry.reset();
  resetMenuCommandKeydownHistory();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'execCommand');
});

describe('getMenuEditableTarget', () => {
  it('returns inputs, textareas, and contenteditable hosts', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    expect(getMenuEditableTarget(input)).toBe(input);
    expect(getMenuEditableTarget(textarea)).toBe(textarea);
    expect(getMenuEditableTarget(editable)).toBe(editable);
  });

  it('resolves nodes nested inside a contenteditable region', () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    editable.appendChild(child);
    expect(getMenuEditableTarget(child)).toBe(editable);
  });

  it('returns null for plain elements and null', () => {
    expect(getMenuEditableTarget(document.createElement('button'))).toBeNull();
    expect(getMenuEditableTarget(null)).toBeNull();
  });
});

describe('isReadOnlyEditableTarget / isMenuScopeIgnored', () => {
  it('flags readonly and disabled fields', () => {
    const readonlyInput = document.createElement('input');
    readonlyInput.readOnly = true;
    const disabledInput = document.createElement('input');
    disabledInput.disabled = true;
    expect(isReadOnlyEditableTarget(readonlyInput)).toBe(true);
    expect(isReadOnlyEditableTarget(disabledInput)).toBe(true);
    expect(isReadOnlyEditableTarget(document.createElement('input'))).toBe(false);
    expect(isReadOnlyEditableTarget(document.createElement('div'))).toBe(false);
  });

  it('detects scope-ignored regions', () => {
    const scope = document.createElement('div');
    scope.setAttribute('data-shortcuts-scope', 'ignore');
    const button = document.createElement('button');
    scope.appendChild(button);
    document.body.appendChild(scope);
    expect(isMenuScopeIgnored(button)).toBe(true);
    expect(isMenuScopeIgnored(document.body)).toBe(false);
    expect(isMenuScopeIgnored(null)).toBe(false);
  });
});

describe('tryNativeEditCommand', () => {
  it('returns the native result', () => {
    execCommandMock.mockReturnValue(true);
    expect(tryNativeEditCommand('copy')).toBe(true);
    expect(execCommandMock).toHaveBeenCalledWith('copy', false, undefined);
  });

  it('returns false when execCommand is unavailable or throws', () => {
    Reflect.deleteProperty(document, 'execCommand');
    expect(tryNativeEditCommand('copy')).toBe(false);
    stubExecCommand();
    execCommandMock.mockImplementation(() => { throw new Error('denied'); });
    expect(tryNativeEditCommand('paste')).toBe(false);
  });
});

describe('snapshotMenuTextInsertion', () => {
  it('captures caret offsets for inputs', () => {
    const input = document.createElement('input');
    input.value = 'hello';
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(1, 3);
    expect(snapshotMenuTextInsertion(input)).toEqual({ target: input, start: 1, end: 3, value: 'hello' });
  });

  it('returns null for contenteditable and readonly targets', () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const readonlyInput = document.createElement('input');
    readonlyInput.readOnly = true;
    expect(snapshotMenuTextInsertion(editable)).toBeNull();
    expect(snapshotMenuTextInsertion(readonlyInput)).toBeNull();
  });
});

describe('applyMenuTextInsertion', () => {
  it('prefers native insertText and leaves the value to the browser', () => {
    const input = document.createElement('input');
    input.value = 'ab';
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(1, 1);
    execCommandMock.mockReturnValue(true);
    expect(applyMenuTextInsertion({ target: input, start: 1, end: 1, value: 'ab' }, 'X')).toBe(true);
    expect(execCommandMock).toHaveBeenCalledWith('insertText', false, 'X');
    expect(input.value).toBe('ab');
  });

  it('splices at the snapshot and notifies listeners when native insert is unavailable', () => {
    const input = document.createElement('input');
    input.value = 'a-c';
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(1, 2);
    const onInput = vi.fn();
    input.addEventListener('input', onInput);
    execCommandMock.mockReturnValue(false);
    expect(applyMenuTextInsertion({ target: input, start: 1, end: 2, value: 'a-c' }, 'b')).toBe(true);
    expect(input.value).toBe('abc');
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(input.selectionStart).toBe(2);
  });

  it('inserts nothing when focus moved to another field', () => {
    const first = document.createElement('input');
    first.value = 'ab';
    const second = document.createElement('input');
    second.value = 'cd';
    document.body.append(first, second);
    first.focus();
    first.setSelectionRange(1, 1);
    const insertion = snapshotMenuTextInsertion(first);
    expect(insertion).not.toBeNull();
    second.focus();
    second.setSelectionRange(1, 1);
    execCommandMock.mockReturnValue(true);
    expect(applyMenuTextInsertion(insertion!, 'X')).toBe(false);
    expect(execCommandMock).not.toHaveBeenCalledWith('insertText', false, 'X');
    expect(first.value).toBe('ab');
    expect(second.value).toBe('cd');
  });

  it('inserts nothing when the target detached', () => {
    const input = document.createElement('input');
    input.value = 'ab';
    document.body.appendChild(input);
    input.focus();
    const insertion = snapshotMenuTextInsertion(input);
    input.remove();
    expect(applyMenuTextInsertion(insertion!, 'X')).toBe(false);
    expect(input.value).toBe('ab');
  });
});

describe('applyMenuContentEditableInsertion', () => {
  it('delegates to native insertText and fails closed without it', () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.appendChild(editable);
    editable.focus();
    execCommandMock.mockReturnValue(true);
    expect(applyMenuContentEditableInsertion(editable, 'hi')).toBe(true);
    execCommandMock.mockReturnValue(false);
    expect(applyMenuContentEditableInsertion(editable, 'hi')).toBe(false);
    expect(editable.textContent).toBe('');
  });
});

describe('pasteClipboardTextIntoEditable', () => {
  it('skips the clipboard read when native paste succeeds', () => {
    const readClipboardText = vi.fn();
    setCastApi({ readClipboardText });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    execCommandMock.mockReturnValue(true);
    return expect(pasteClipboardTextIntoEditable(input)).resolves.toBeUndefined().then(() => {
      expect(execCommandMock).toHaveBeenCalledWith('paste', false, undefined);
      expect(readClipboardText).not.toHaveBeenCalled();
    });
  });

  it('falls back to clipboard read plus insert when native paste fails', async () => {
    setCastApi({ readClipboardText: vi.fn().mockResolvedValue('XY') });
    const input = document.createElement('input');
    input.value = 'a-c';
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(1, 2);
    execCommandMock.mockReturnValue(false);
    await pasteClipboardTextIntoEditable(input);
    expect(input.value).toBe('a-XY');
  });

  it('does nothing on readonly targets, empty text, or clipboard errors', async () => {
    const readClipboardText = vi.fn().mockResolvedValue('XY');
    setCastApi({ readClipboardText });
    const readonlyInput = document.createElement('input');
    readonlyInput.readOnly = true;
    readonlyInput.value = 'ab';
    document.body.appendChild(readonlyInput);
    readonlyInput.focus();
    execCommandMock.mockReturnValue(false);
    await pasteClipboardTextIntoEditable(readonlyInput);
    expect(readClipboardText).not.toHaveBeenCalled();
    expect(readonlyInput.value).toBe('ab');

    const input = document.createElement('input');
    input.value = 'ab';
    document.body.appendChild(input);
    input.focus();
    setCastApi({ readClipboardText: vi.fn().mockRejectedValue(new Error('denied')) });
    await expect(pasteClipboardTextIntoEditable(input)).resolves.toBeUndefined();
    expect(input.value).toBe('ab');

    setCastApi({ readClipboardText: vi.fn().mockResolvedValue('') });
    await pasteClipboardTextIntoEditable(input);
    expect(input.value).toBe('ab');
  });

  it('inserts nothing anywhere when focus changes during the async read', async () => {
    let resolveClipboard!: (text: string) => void;
    setCastApi({
      readClipboardText: vi.fn().mockImplementation(() => new Promise<string>((resolve) => {
        resolveClipboard = resolve;
      })),
    });
    const first = document.createElement('input');
    first.value = 'ab';
    const second = document.createElement('input');
    second.value = 'cd';
    document.body.append(first, second);
    first.focus();
    first.setSelectionRange(1, 1);
    execCommandMock.mockReturnValue(false);
    const pending = pasteClipboardTextIntoEditable(first);
    second.focus();
    second.setSelectionRange(1, 1);
    resolveClipboard('X');
    await pending;
    expect(first.value).toBe('ab');
    expect(second.value).toBe('cd');
  });
});

describe('consumeLiveMenuClaim', () => {
  it('honors a claim with a matching recent keydown', () => {
    noteMenuCommandKeydown(new KeyboardEvent('keydown', { key: 'c', metaKey: true }));
    menuCommandClaimRegistry.claim('edit.copy');
    expect(consumeLiveMenuClaim('edit.copy')).toBe(true);
  });

  it('ignores a stale claim with no matching keydown', () => {
    menuCommandClaimRegistry.claim('edit.copy');
    expect(consumeLiveMenuClaim('edit.copy')).toBe(false);
    // Consumed on read: a later explicit click is not swallowed either.
    expect(menuCommandClaimRegistry.consume('edit.copy')).toBe(false);
  });

  it('returns false with no claim at all', () => {
    noteMenuCommandKeydown(new KeyboardEvent('keydown', { key: 'c', metaKey: true }));
    expect(consumeLiveMenuClaim('edit.copy')).toBe(false);
  });
});


describe('async paste ownership', () => {
  it.each(['selection', 'value', 'readonly'] as const)('discards a paste after %s changes', async (change) => {
    const input = document.createElement('input');
    input.value = 'abc';
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(1, 1);
    let finish!: (text: string) => void;
    setCastApi({ readClipboardText: () => new Promise<string>((resolve) => { finish = resolve; }) });
    const paste = pasteClipboardTextIntoEditable(input);
    if (change === 'selection') input.setSelectionRange(2, 2);
    if (change === 'value') input.value = 'changed';
    if (change === 'readonly') input.readOnly = true;
    finish('X');
    await paste;
    expect(input.value).toBe(change === 'value' ? 'changed' : 'abc');
  });
});
