import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { menuCommandClaimRegistry } from '@lumacast/commands';

const fakes = vi.hoisted(() => {
  const overlayStack = {
    rootElement: null,
    stack: [] as string[],
    baseZIndex: 1,
    register: vi.fn(),
    unregister: vi.fn(),
  };
  return {
    cast: { setStatusText: vi.fn(), undo: vi.fn(), redo: vi.fn() },
    commandPalette: { open: vi.fn() },
    slides: {
      slides: [],
      currentSlide: null,
      currentSlideIndex: 0,
      isOutputArmedOnCurrent: false,
      activateSlide: vi.fn(),
      takeSlide: vi.fn(),
      goNext: vi.fn(),
      goPrev: vi.fn(),
      deleteSlide: vi.fn(),
      setCurrentSlideIndex: vi.fn(),
    },
    elements: {
      selectedElementId: null,
      clearSelection: vi.fn(),
      deleteSelected: vi.fn(),
      nudgeSelection: vi.fn(),
      copySelection: vi.fn(),
      cutSelection: vi.fn(),
      pasteSelection: vi.fn(),
      duplicateSelection: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
    },
    deckBrowser: { setSlideBrowserMode: vi.fn() },
    workbench: {
      state: { workbenchMode: 'show' },
      overlayStack,
    },
  };
});

vi.mock('../../../../app/renderer/contexts/app-context', () => ({
  useCast: () => fakes.cast,
}));
vi.mock('../../../../app/renderer/contexts/slide-context', () => ({
  useSlides: () => fakes.slides,
}));
vi.mock('../../../../app/renderer/contexts/canvas/canvas-context', () => ({
  useElements: () => fakes.elements,
}));
vi.mock('../../../../app/renderer/features/items/deck-browser-context', () => ({
  useDeckBrowser: () => fakes.deckBrowser,
}));
vi.mock('../../../../app/renderer/features/command-palette/command-palette-context', () => ({
  useCommandPalette: () => fakes.commandPalette,
}));
vi.mock('../../../../app/renderer/contexts/workbench-context', () => ({
  useWorkbench: () => fakes.workbench,
}));

import { useKeyboardShortcuts } from '../../../../app/renderer/hooks/use-keyboard-shortcuts';

function keyDown(key: string, opts: Partial<Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>> = {}): KeyboardEvent {
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

function dispatchOn(target: EventTarget, event: KeyboardEvent): void {
  act(() => {
    target.dispatchEvent(event);
  });
}

beforeEach(() => {
  menuCommandClaimRegistry.reset();
  fakes.workbench.overlayStack.stack.length = 0;
  fakes.workbench.state.workbenchMode = 'show';
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('useKeyboardShortcuts — out-of-scope contexts', () => {
  it('does not run the app copy on a focused editable input, lets the browser own the chord, and claims the parallel menu command', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    renderHook(() => useKeyboardShortcuts());

    const event = keyDown('c', { metaKey: true });
    dispatchOn(input, event);

    expect(fakes.elements.copySelection).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(menuCommandClaimRegistry.consume('edit.copy')).toBe(true);
  });

  it('does not run takeSlide on Enter inside an editable textarea and still claims it', () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    renderHook(() => useKeyboardShortcuts());

    const event = keyDown('Enter');
    dispatchOn(textarea, event);

    expect(fakes.slides.takeSlide).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(menuCommandClaimRegistry.consume('playback.takeSlide')).toBe(true);
  });

  it('treats a target inside a data-shortcuts-scope="ignore" region as out of scope', () => {
    const scope = document.createElement('div');
    scope.setAttribute('data-shortcuts-scope', 'ignore');
    const button = document.createElement('button');
    scope.appendChild(button);
    document.body.appendChild(scope);
    renderHook(() => useKeyboardShortcuts());

    const event = keyDown('c', { metaKey: true });
    dispatchOn(button, event);

    expect(fakes.elements.copySelection).not.toHaveBeenCalled();
    expect(menuCommandClaimRegistry.consume('edit.copy')).toBe(true);
  });

  it('treats a target inside a contenteditable region as out of scope', () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    editable.appendChild(child);
    document.body.appendChild(editable);
    renderHook(() => useKeyboardShortcuts());

    const event = keyDown('v', { metaKey: true });
    dispatchOn(child, event);

    expect(fakes.elements.pasteSelection).not.toHaveBeenCalled();
    expect(menuCommandClaimRegistry.consume('edit.paste')).toBe(true);
  });
});

describe('useKeyboardShortcuts — modal overlay scope', () => {
  it('suppresses app shortcuts behind an open overlay and claims the chord', () => {
    fakes.workbench.overlayStack.stack.push('some-overlay');
    const button = document.createElement('button');
    document.body.appendChild(button);
    renderHook(() => useKeyboardShortcuts());

    const event = keyDown('Delete');
    dispatchOn(button, event);

    expect(fakes.elements.deleteSelected).not.toHaveBeenCalled();
    expect(fakes.slides.deleteSlide).not.toHaveBeenCalled();
    expect(menuCommandClaimRegistry.consume('edit.delete')).toBe(true);
  });

  it('suppresses the previous/next slide arrows behind an open overlay', () => {
    fakes.workbench.overlayStack.stack.push('some-overlay');
    const button = document.createElement('button');
    document.body.appendChild(button);
    renderHook(() => useKeyboardShortcuts());

    dispatchOn(button, keyDown('ArrowRight'));

    expect(fakes.slides.goNext).not.toHaveBeenCalled();
    expect(fakes.slides.setCurrentSlideIndex).not.toHaveBeenCalled();
    expect(menuCommandClaimRegistry.consume('playback.nextSlide')).toBe(true);
  });

  it('claims the chord even when another listener already consumed the key, so the macOS menu cannot fall through', () => {
    fakes.workbench.overlayStack.stack.push('a-dialog');
    renderHook(() => useKeyboardShortcuts());

    const event = keyDown('c', { metaKey: true });
    event.preventDefault();
    act(() => {
      window.dispatchEvent(event);
    });

    expect(fakes.elements.copySelection).not.toHaveBeenCalled();
    expect(menuCommandClaimRegistry.consume('edit.copy')).toBe(true);
  });

  it('does zero-dispatch and avoids false claims when no overlay is open and a key was already consumed', () => {
    renderHook(() => useKeyboardShortcuts());

    const event = keyDown('c', { metaKey: true });
    event.preventDefault();
    act(() => {
      window.dispatchEvent(event);
    });

    expect(fakes.elements.copySelection).not.toHaveBeenCalled();
    expect(menuCommandClaimRegistry.consume('edit.copy')).toBe(false);
  });
});

describe('useKeyboardShortcuts — normal dispatch still claims', () => {
  it('runs the canvas copy when no editable target or overlay claims the key', () => {
    fakes.workbench.state.workbenchMode = 'item-editor';
    renderHook(() => useKeyboardShortcuts());

    const event = keyDown('c', { metaKey: true });
    dispatchOn(document.body, event);

    expect(fakes.elements.copySelection).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(menuCommandClaimRegistry.consume('edit.copy')).toBe(true);
  });
});
