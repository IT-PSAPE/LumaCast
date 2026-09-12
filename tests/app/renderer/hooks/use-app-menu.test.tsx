import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { menuCommandClaimRegistry, type AppMenuCommandId } from '@lumacast/commands';
import { resetMenuCommandKeydownHistory } from '../../../../app/renderer/utils/menu-editable';

const fakes = vi.hoisted(() => ({
  cast: { canUndo: false, canRedo: false, undo: vi.fn(), redo: vi.fn(), setStatusText: vi.fn() },
  ndi: {
    state: { outputState: { audience: false, stage: false } },
    actions: { toggleAudienceOutput: vi.fn(), toggleStageOutput: vi.fn() },
  },
  navigation: {
    currentPlaylistId: null,
    currentItem: null,
    currentItemRef: null,
    createPresentation: vi.fn(),
    createEmptyLyric: vi.fn(),
    createPlaylist: vi.fn(),
    createSeparator: vi.fn(),
  },
  slides: {
    currentSlide: null,
    slides: [] as unknown[],
    currentSlideIndex: 0,
    createSlide: vi.fn(),
    deleteSlide: vi.fn(),
    takeSlide: vi.fn(),
    goPrev: vi.fn(),
    goNext: vi.fn(),
  },
  elements: {
    selectedElementIds: [] as string[],
    selectedElementId: null as string | null,
    undo: vi.fn(),
    redo: vi.fn(),
    cutSelection: vi.fn(),
    copySelection: vi.fn(),
    pasteSelection: vi.fn(),
    duplicateSelection: vi.fn(),
    deleteSelected: vi.fn(),
    clearSelection: vi.fn(),
  },
  workbench: {
    state: { workbenchMode: 'item-editor' },
    actions: { setWorkbenchMode: vi.fn() },
    overlayStack: {
      rootElement: null,
      stack: [] as string[],
      baseZIndex: 1,
      register: vi.fn(),
      unregister: vi.fn(),
    },
  },
  deckBrowser: {
    slideBrowserMode: 'grid',
    setSlideBrowserMode: vi.fn(),
  },
  projectContent: { presentations: [], lyrics: [] } as {
    presentations: unknown[];
    lyrics: unknown[];
  },
  commandPalette: { open: vi.fn() },
  hasClipboard: false,
}));

vi.mock('../../../../app/renderer/contexts/app-context', () => ({
  useCast: () => fakes.cast,
  useNdi: () => fakes.ndi,
}));
vi.mock('../../../../app/renderer/contexts/canvas/canvas-context', () => ({
  useElements: () => fakes.elements,
}));
vi.mock('../../../../app/renderer/contexts/navigation-context', () => ({
  useNavigation: () => fakes.navigation,
}));
vi.mock('../../../../app/renderer/contexts/use-project-content', () => ({
  useProjectContent: () => fakes.projectContent,
}));
vi.mock('../../../../app/renderer/contexts/slide-context', () => ({
  useSlides: () => fakes.slides,
}));
vi.mock('../../../../app/renderer/contexts/workbench-context', () => ({
  useWorkbench: () => fakes.workbench,
}));
vi.mock('../../../../app/renderer/contexts/element/use-element-history', () => ({
  hasClipboardContent: () => fakes.hasClipboard,
}));
vi.mock('../../../../app/renderer/features/command-palette/command-palette-context', () => ({
  useCommandPalette: () => fakes.commandPalette,
}));
vi.mock('../../../../app/renderer/features/items/deck-browser-context', () => ({
  useDeckBrowser: () => fakes.deckBrowser,
}));

import { useAppMenu } from '../../../../app/renderer/hooks/use-app-menu';

const execCommandMock = vi.fn();
let menuHandler: ((commandId: AppMenuCommandId) => Promise<void>) | null = null;
let readClipboardText: ReturnType<typeof vi.fn>;

function setCastApi(): void {
  (window as unknown as { castApi: Record<string, unknown> }).castApi = {
    updateAppMenuState: vi.fn(),
    onAppMenuCommand: vi.fn((callback: (commandId: AppMenuCommandId) => Promise<void>) => {
      menuHandler = callback;
      return () => undefined;
    }),
    readClipboardText,
    chooseBundleExportPath: vi.fn(),
    exportBundle: vi.fn(),
    checkForAppUpdates: vi.fn(),
  } as unknown as Record<string, unknown>;
}

async function fireMenu(commandId: AppMenuCommandId): Promise<void> {
  const handler = menuHandler;
  if (!handler) throw new Error('menu handler not registered');
  await act(async () => {
    await handler(commandId);
  });
}

function focusInput(value = '', selection?: [number, number]): HTMLInputElement {
  const input = document.createElement('input');
  input.value = value;
  document.body.appendChild(input);
  input.focus();
  if (selection) input.setSelectionRange(selection[0], selection[1]);
  return input;
}

beforeEach(() => {
  execCommandMock.mockReset();
  execCommandMock.mockReturnValue(false);
  Object.defineProperty(document, 'execCommand', {
    value: execCommandMock,
    configurable: true,
    writable: true,
  });
  readClipboardText = vi.fn().mockResolvedValue('');
  menuHandler = null;
  setCastApi();
  renderHook(() => useAppMenu());
  fakes.workbench.state.workbenchMode = 'item-editor';
  fakes.workbench.overlayStack.stack.length = 0;
  fakes.elements.selectedElementIds = [];
  fakes.elements.selectedElementId = null;
  menuCommandClaimRegistry.reset();
  resetMenuCommandKeydownHistory();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.clearAllMocks();
  Reflect.deleteProperty(document, 'execCommand');
  menuCommandClaimRegistry.reset();
  resetMenuCommandKeydownHistory();
});

describe('useAppMenu — editable focus owns edit commands', () => {
  it('owns delete when native execCommand fails: no canvas or slide delete', async () => {
    fakes.elements.selectedElementId = 'e1';
    (fakes.slides as { currentSlide: unknown }).currentSlide = { id: 's1' };
    focusInput('hello');
    await fireMenu('edit.delete');
    expect(execCommandMock).toHaveBeenCalledWith('delete', false, undefined);
    expect(fakes.elements.deleteSelected).not.toHaveBeenCalled();
    expect(fakes.slides.deleteSlide).not.toHaveBeenCalled();
    (fakes.slides as { currentSlide: unknown }).currentSlide = null;
  });

  it('owns undo when native execCommand fails: no canvas or global undo', async () => {
    focusInput('hello');
    await fireMenu('edit.undo');
    expect(fakes.elements.undo).not.toHaveBeenCalled();
    expect(fakes.cast.undo).not.toHaveBeenCalled();
  });

  it('owns canvas undo in edit workbench when native execCommand fails', async () => {
    focusInput('hello');
    await fireMenu('edit.undo');
    expect(fakes.elements.undo).not.toHaveBeenCalled();
  });

  it('owns cut when native execCommand fails: no canvas cut', async () => {
    focusInput('hello', [0, 5]);
    await fireMenu('edit.cut');
    expect(execCommandMock).toHaveBeenCalledWith('cut', false, undefined);
    expect(fakes.elements.cutSelection).not.toHaveBeenCalled();
  });

  it('still deletes canvas elements when no editable target is focused', async () => {
    fakes.elements.selectedElementId = 'e1';
    document.body.focus();
    await fireMenu('edit.delete');
    expect(fakes.elements.deleteSelected).toHaveBeenCalledTimes(1);
  });

  it('still pastes canvas elements when no editable target is focused', async () => {
    document.body.focus();
    await fireMenu('edit.paste');
    expect(readClipboardText).not.toHaveBeenCalled();
    expect(fakes.elements.pasteSelection).toHaveBeenCalledTimes(1);
  });
});

describe('useAppMenu — editable paste fallback', () => {
  it('reads the clipboard and inserts at the caret when native paste fails', async () => {
    readClipboardText.mockResolvedValue('XY');
    const input = focusInput('a-c', [1, 2]);
    await fireMenu('edit.paste');
    expect(execCommandMock).toHaveBeenCalledWith('paste', false, undefined);
    expect(readClipboardText).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('a-XY');
    expect(fakes.elements.pasteSelection).not.toHaveBeenCalled();
  });

  it('inserts nothing anywhere when focus changes during the async clipboard read', async () => {
    let resolveClipboard!: (text: string) => void;
    readClipboardText.mockImplementation(() => new Promise<string>((resolve) => {
      resolveClipboard = resolve;
    }));
    const first = focusInput('ab', [1, 1]);
    const second = document.createElement('input');
    second.value = 'cd';
    document.body.appendChild(second);
    let pending: Promise<void> | undefined;
    act(() => {
      pending = menuHandler!('edit.paste');
    });
    second.focus();
    second.setSelectionRange(1, 1);
    resolveClipboard('X');
    await act(async () => {
      await pending;
    });
    expect(first.value).toBe('ab');
    expect(second.value).toBe('cd');
    expect(fakes.elements.pasteSelection).not.toHaveBeenCalled();
  });

  it('does nothing on clipboard errors', async () => {
    readClipboardText.mockRejectedValue(new Error('denied'));
    const input = focusInput('ab');
    await fireMenu('edit.paste');
    expect(input.value).toBe('ab');
    expect(fakes.elements.pasteSelection).not.toHaveBeenCalled();
  });
});

describe('useAppMenu — readonly fields', () => {
  it('swallows paste on a readonly input without reading the clipboard or touching canvas', async () => {
    const input = document.createElement('input');
    input.readOnly = true;
    input.value = 'ab';
    document.body.appendChild(input);
    input.focus();
    await fireMenu('edit.paste');
    expect(readClipboardText).not.toHaveBeenCalled();
    expect(input.value).toBe('ab');
    expect(fakes.elements.pasteSelection).not.toHaveBeenCalled();
  });

  it('swallows delete on a readonly input without touching canvas', async () => {
    fakes.elements.selectedElementId = 'e1';
    const input = document.createElement('input');
    input.readOnly = true;
    document.body.appendChild(input);
    input.focus();
    await fireMenu('edit.delete');
    expect(execCommandMock).not.toHaveBeenCalledWith('delete', false, undefined);
    expect(fakes.elements.deleteSelected).not.toHaveBeenCalled();
  });
});

describe('useAppMenu — modal overlay scope', () => {
  beforeEach(() => {
    fakes.workbench.overlayStack.stack.push('some-dialog');
    // Re-mount so the hook observes the open overlay.
    renderHook(() => useAppMenu());
  });

  it('blocks canvas duplicate and global undo with no editable target', async () => {
    document.body.focus();
    await fireMenu('edit.duplicate');
    await fireMenu('edit.undo');
    expect(fakes.elements.duplicateSelection).not.toHaveBeenCalled();
    expect(fakes.elements.undo).not.toHaveBeenCalled();
    expect(fakes.cast.undo).not.toHaveBeenCalled();
  });

  it('blocks element copy when nothing is selected behind the modal', async () => {
    const selection = document.getSelection();
    selection?.removeAllRanges();
    document.body.focus();
    await fireMenu('edit.copy');
    expect(fakes.elements.copySelection).not.toHaveBeenCalled();
  });

  it('blocks playback commands behind the modal', async () => {
    document.body.focus();
    await fireMenu('playback.takeSlide');
    await fireMenu('playback.nextSlide');
    expect(fakes.slides.takeSlide).not.toHaveBeenCalled();
    expect(fakes.slides.goNext).not.toHaveBeenCalled();
  });

  it('still runs text edits on a focused text field inside the modal', async () => {
    readClipboardText.mockResolvedValue('XY');
    const input = focusInput('a-c', [1, 2]);
    await fireMenu('edit.paste');
    expect(input.value).toBe('a-XY');
    expect(fakes.elements.pasteSelection).not.toHaveBeenCalled();
  });

  it('does not block file or settings commands', async () => {
    document.body.focus();
    await fireMenu('file.newSlide');
    await fireMenu('app.openSettings');
    expect(fakes.slides.createSlide).toHaveBeenCalledTimes(1);
    expect(fakes.workbench.actions.setWorkbenchMode).toHaveBeenCalledWith('settings');
  });
});

describe('useAppMenu — scope-ignored regions', () => {
  it('blocks canvas delete and playback behind data-shortcuts-scope="ignore"', async () => {
    fakes.elements.selectedElementId = 'e1';
    const scope = document.createElement('div');
    scope.setAttribute('data-shortcuts-scope', 'ignore');
    const button = document.createElement('button');
    scope.appendChild(button);
    document.body.appendChild(scope);
    button.focus();
    await fireMenu('edit.delete');
    await fireMenu('playback.nextSlide');
    expect(fakes.elements.deleteSelected).not.toHaveBeenCalled();
    expect(fakes.slides.goNext).not.toHaveBeenCalled();
  });
});

describe('useAppMenu — stale menu claims', () => {
  it('honors an explicit click when the claim has no matching recent keydown', async () => {
    menuCommandClaimRegistry.claim('edit.copy');
    document.body.focus();
    await fireMenu('edit.copy');
    expect(fakes.elements.copySelection).toHaveBeenCalledTimes(1);
  });

  it('still drops the duplicate menu echo right after its keyboard chord', async () => {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'c',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }));
    });
    menuCommandClaimRegistry.claim('edit.copy');
    document.body.focus();
    await fireMenu('edit.copy');
    expect(fakes.elements.copySelection).not.toHaveBeenCalled();
  });
});
