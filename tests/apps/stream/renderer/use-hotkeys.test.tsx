import { cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHotkeys, type UseHotkeysParams } from '../../../../apps/stream/renderer/features/hotkeys/use-hotkeys';
import { defaultTransform } from '../../../../apps/stream/renderer/features/sources/helpers';
import { createDefaultProject, type StreamAPI, type StreamProject, type StreamSource } from '../../../../apps/stream/shared/desktop-api';

afterEach(() => cleanup());

function makeSource(overrides: Partial<StreamSource> = {}): StreamSource {
  return {
    id: 'source-1',
    name: 'Source 1',
    kind: 'image',
    visible: true,
    locked: false,
    muted: false,
    volume: 1,
    transform: { x: 30, y: 40, width: 320, height: 240 },
    assetId: 'image-1',
    assetExtension: 'png',
    ...overrides,
  };
}

function makeProject(sources: StreamSource[] = []): StreamProject {
  const project = createDefaultProject('win32');
  const activeScene = project.scenes.find((scene) => scene.id === project.activeSceneId)!;
  activeScene.sources = sources;
  return project;
}

function setup(options: {
  source?: StreamSource;
  sources?: StreamSource[];
  isActivelyRecording?: boolean;
} = {}) {
  const source = options.source ?? makeSource();
  const sources = options.sources ?? [source];
  const project = makeProject(sources);
  const api = {
    setGlobalHotkeys: vi.fn().mockResolvedValue(undefined),
    onGlobalHotkey: vi.fn(() => () => undefined),
  } as unknown as StreamAPI;
  const actions = {
    fitSource: vi.fn(),
    stretchSource: vi.fn(),
    centerSource: vi.fn(),
    updateSource: vi.fn((_sourceId: string, _update: (source: StreamSource) => StreamSource) => undefined),
    startRecording: vi.fn().mockResolvedValue(undefined),
    stopRecording: vi.fn(),
  };
  const params: UseHotkeysParams = {
    api,
    project,
    setProjectValue: vi.fn(),
    setActionError: vi.fn(),
    selectedSource: source,
    nudgeSelectedSources: vi.fn(),
    updateSource: actions.updateSource,
    fitSource: actions.fitSource,
    stretchSource: actions.stretchSource,
    centerSource: actions.centerSource,
    undoSceneEdit: vi.fn(),
    redoSceneEdit: vi.fn(),
    pasteSource: vi.fn().mockResolvedValue(undefined),
    removeSelectedSource: vi.fn(),
    copySelectedSource: vi.fn(),
    sourceClipboardAvailable: false,
    chooseScene: vi.fn(),
    startRecording: actions.startRecording,
    stopRecording: actions.stopRecording,
    isRecording: vi.fn(() => false),
    isActivelyRecording: vi.fn(() => options.isActivelyRecording ?? false),
    stopStreaming: vi.fn(),
    isStreaming: vi.fn(() => false),
    openStreamDialog: vi.fn(),
    startReplayBuffer: vi.fn().mockResolvedValue(undefined),
    stopReplayBuffer: vi.fn(),
    saveReplay: vi.fn().mockResolvedValue(undefined),
    isReplayBufferActive: vi.fn(() => false),
    openSettings: vi.fn(),
  };
  renderHook(() => useHotkeys(params));
  return { actions, project, source };
}

function pressShortcut(target: Element | Window, code: string, modifiers: Pick<KeyboardEventInit, 'ctrlKey' | 'metaKey' | 'shiftKey'>) {
  fireEvent.keyDown(target, { code, key: code.slice(3).toLowerCase(), bubbles: true, ...modifiers });
}

describe('useHotkeys source transforms', () => {
  it.each([
    ['Ctrl+F', 'KeyF', { ctrlKey: true }, 'fit'],
    ['Cmd+F', 'KeyF', { metaKey: true }, 'fit'],
    ['Ctrl+S', 'KeyS', { ctrlKey: true }, 'stretch'],
    ['Cmd+S', 'KeyS', { metaKey: true }, 'stretch'],
    ['Ctrl+D', 'KeyD', { ctrlKey: true }, 'center'],
    ['Cmd+D', 'KeyD', { metaKey: true }, 'center'],
  ] as const)('dispatches %s to the matching transform action', (_label, code, modifiers, action) => {
    const { actions } = setup();

    pressShortcut(window, code, modifiers);

    expect(actions[`${action}Source` as 'fitSource' | 'stretchSource' | 'centerSource']).toHaveBeenCalledOnce();
    expect(actions.fitSource).toHaveBeenCalledTimes(action === 'fit' ? 1 : 0);
    expect(actions.stretchSource).toHaveBeenCalledTimes(action === 'stretch' ? 1 : 0);
    expect(actions.centerSource).toHaveBeenCalledTimes(action === 'center' ? 1 : 0);
  });

  it.each([
    ['Ctrl+R', { ctrlKey: true }],
    ['Cmd+R', { metaKey: true }],
  ] as const)('resets the selected source transform with %s', (_label, modifiers) => {
    const { actions, project, source } = setup();

    pressShortcut(window, 'KeyR', modifiers);

    expect(actions.updateSource).toHaveBeenCalledOnce();
    const [sourceId, update] = actions.updateSource.mock.calls[0]!;
    expect(sourceId).toBe(source.id);
    expect(update(source).transform).toEqual(defaultTransform(source.kind, project.output, source.mediaKind));
  });

  it('does not reset a source after Ctrl+Shift+R starts recording', () => {
    const { actions } = setup();

    pressShortcut(window, 'KeyR', { ctrlKey: true, shiftKey: true });

    expect(actions.startRecording).toHaveBeenCalledOnce();
    expect(actions.stopRecording).not.toHaveBeenCalled();
    expect(actions.updateSource).not.toHaveBeenCalled();
  });

  it('toggles recording without resetting when Ctrl+Shift+R is pressed during an active recording', () => {
    const { actions } = setup({ isActivelyRecording: true });

    pressShortcut(window, 'KeyR', { ctrlKey: true, shiftKey: true });

    expect(actions.stopRecording).toHaveBeenCalledOnce();
    expect(actions.startRecording).not.toHaveBeenCalled();
    expect(actions.updateSource).not.toHaveBeenCalled();
  });

  it.each([
    ['locked source', makeSource({ locked: true }), [makeSource({ locked: true })]],
    ['unsupported audio source', makeSource({ kind: 'microphone' }), [makeSource({ kind: 'microphone' })]],
  ])('ignores transform shortcuts for an %s', (_label, selectedSource, sources) => {
    const { actions } = setup({ source: selectedSource, sources });

    pressShortcut(window, 'KeyF', { ctrlKey: true });
    pressShortcut(window, 'KeyD', { ctrlKey: true });
    pressShortcut(window, 'KeyR', { ctrlKey: true });
    pressShortcut(window, 'KeyS', { ctrlKey: true });

    expect(actions.fitSource).not.toHaveBeenCalled();
    expect(actions.centerSource).not.toHaveBeenCalled();
    expect(actions.updateSource).not.toHaveBeenCalled();
    expect(actions.stretchSource).not.toHaveBeenCalled();
  });

  it('ignores transform shortcuts for a source inside a locked group', () => {
    const selectedSource = makeSource({ id: 'child' });
    const lockedGroup: StreamSource = {
      ...makeSource({ id: 'group', kind: 'group', locked: true }),
      children: [selectedSource],
    };
    const { actions } = setup({ source: selectedSource, sources: [lockedGroup] });

    pressShortcut(window, 'KeyF', { ctrlKey: true });
    pressShortcut(window, 'KeyD', { ctrlKey: true });
    pressShortcut(window, 'KeyR', { ctrlKey: true });
    pressShortcut(window, 'KeyS', { ctrlKey: true });

    expect(actions.fitSource).not.toHaveBeenCalled();
    expect(actions.centerSource).not.toHaveBeenCalled();
    expect(actions.updateSource).not.toHaveBeenCalled();
    expect(actions.stretchSource).not.toHaveBeenCalled();
  });
});

describe('useHotkeys focus guards', () => {
  it.each(['input', 'textarea'] as const)('does not intercept shortcuts while a %s is focused', (tagName) => {
    const { actions } = setup();
    const target = document.createElement(tagName);
    document.body.appendChild(target);
    target.focus();

    pressShortcut(target, 'KeyF', { ctrlKey: true });

    expect(actions.fitSource).not.toHaveBeenCalled();
  });

  it('does not intercept shortcuts while contentEditable is focused', () => {
    const { actions } = setup();
    const target = document.createElement('div');
    target.setAttribute('contenteditable', 'true');
    Object.defineProperty(target, 'isContentEditable', { value: true });
    document.body.appendChild(target);
    target.focus();

    pressShortcut(target, 'KeyF', { ctrlKey: true });

    expect(actions.fitSource).not.toHaveBeenCalled();
  });

  it('does not intercept shortcuts while a dialog has focus', () => {
    const { actions } = setup();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const button = document.createElement('button');
    dialog.appendChild(button);
    document.body.appendChild(dialog);
    button.focus();

    pressShortcut(button, 'KeyF', { ctrlKey: true });

    expect(actions.fitSource).not.toHaveBeenCalled();
  });

  it('does not intercept shortcuts while a menu is open', () => {
    const { actions } = setup();
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    document.body.appendChild(menu);

    pressShortcut(window, 'KeyF', { ctrlKey: true });

    expect(actions.fitSource).not.toHaveBeenCalled();
  });
});
