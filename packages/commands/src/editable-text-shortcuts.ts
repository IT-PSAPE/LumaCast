const SUPPORTED_INPUT_TYPES = new Set([
  '',
  'text',
  'search',
  'url',
  'tel',
  'password',
  'email',
  'number',
]);

export interface EditableTextClipboardApi {
  readText: () => Promise<string>;
  writeText: (text: string) => Promise<void>;
}

type EditableTextTarget = HTMLInputElement | HTMLTextAreaElement;

function isEditableTextTarget(target: HTMLElement | null): target is EditableTextTarget {
  if (!target) return false;
  if (target instanceof HTMLTextAreaElement) return !target.disabled;
  if (!(target instanceof HTMLInputElement)) return false;
  return !target.disabled && SUPPORTED_INPUT_TYPES.has(target.type);
}

function getSelectionBounds(target: EditableTextTarget): { start: number; end: number } | null {
  if (typeof target.selectionStart !== 'number' || typeof target.selectionEnd !== 'number') {
    return null;
  }

  return { start: target.selectionStart, end: target.selectionEnd };
}

function getSelectedText(target: EditableTextTarget): string {
  const bounds = getSelectionBounds(target);
  if (!bounds) return '';
  return target.value.slice(bounds.start, bounds.end);
}

function dispatchInput(target: EditableTextTarget): void {
  target.dispatchEvent(new Event('input', { bubbles: true }));
}

function replaceSelection(target: EditableTextTarget, text: string): void {
  const bounds = getSelectionBounds(target);
  if (!bounds) return;

  if (typeof target.setRangeText === 'function') {
    target.setRangeText(text, bounds.start, bounds.end, 'end');
  } else {
    const nextValue = `${target.value.slice(0, bounds.start)}${text}${target.value.slice(bounds.end)}`;
    target.value = nextValue;
    const caret = bounds.start + text.length;
    target.setSelectionRange(caret, caret);
  }

  dispatchInput(target);
}

export function handleEditableTextShortcut(
  event: KeyboardEvent,
  target: HTMLElement | null,
  clipboardApi: EditableTextClipboardApi,
): boolean {
  if (!isEditableTextTarget(target)) return false;
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return false;

  switch (event.key.toLowerCase()) {
    case 'a':
      event.preventDefault();
      target.select();
      return true;
    case 'c':
      event.preventDefault();
      void clipboardApi.writeText(getSelectedText(target));
      return true;
    case 'x':
      if (target.readOnly) return false;
      event.preventDefault();
      void clipboardApi.writeText(getSelectedText(target)).then(() => {
        replaceSelection(target, '');
      });
      return true;
    default:
      return false;
  }
}
