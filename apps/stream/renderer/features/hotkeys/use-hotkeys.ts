import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { classifyHotkeyCapture } from '../../hotkey-capture';
import type {
  StreamAPI, StreamGlobalHotkeys, StreamHotkeyAction, StreamProject, StreamSource,
} from '../../../shared/desktop-api';
import { friendlyError } from '../shared/friendly-error';
import { defaultTransform } from '../sources/helpers';

export interface UseHotkeysParams {
  api: StreamAPI;
  project: StreamProject | null;
  setProjectValue: (update: (current: StreamProject) => StreamProject) => void;
  setActionError: (message: string) => void;
  selectedSource: StreamSource | null;
  nudgeSelectedSources: (dx: number, dy: number) => void;
  updateSource: (sourceId: string, update: (source: StreamSource) => StreamSource) => void;
  fitSource: (source: StreamSource) => void;
  stretchSource: (source: StreamSource) => void;
  centerSource: (source: StreamSource) => void;
  undoSceneEdit: () => void;
  redoSceneEdit: () => void;
  pasteSource: () => Promise<void>;
  removeSelectedSource: () => void;
  copySelectedSource: () => void;
  sourceClipboardAvailable: boolean;
  chooseScene: (sceneId: string) => void;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  isRecording: () => boolean;
  /** Whether a recording is actively writing right now (false while paused, unlike `isRecording`) — used only by the Ctrl+Shift+R shortcut. */
  isActivelyRecording: () => boolean;
  stopStreaming: () => void;
  isStreaming: () => boolean;
  openStreamDialog: () => void;
  startReplayBuffer: () => Promise<void>;
  stopReplayBuffer: () => void;
  saveReplay: () => Promise<void>;
  isReplayBufferActive: () => boolean;
  openSettings: () => void;
}

export interface UseHotkeysResult {
  hotkeyDraft: StreamGlobalHotkeys | null;
  sceneSwitchHotkeyDraft: Record<string, string>;
  sourceVisibilityHotkeyDraft: Record<string, string>;
  hotkeyError: string;
  hotkeysWorking: boolean;
  applyHotkeys: () => Promise<void>;
  captureHotkey: (action: StreamHotkeyAction, event: ReactKeyboardEvent<HTMLInputElement>) => void;
  captureSceneSwitchHotkey: (sceneId: string, event: ReactKeyboardEvent<HTMLInputElement>) => void;
  captureSourceVisibilityHotkey: (sourceId: string, event: ReactKeyboardEvent<HTMLInputElement>) => void;
}

/**
 * Global hotkey registration/dispatch (recording, streaming, replay buffer,
 * scene switches, source visibility), the hotkey-capture inputs in Settings,
 * and the in-window keyboard shortcuts (undo/redo, copy/paste/delete source,
 * transform shortcuts, arrow-key nudge). Mirrors the former inline App.tsx
 * implementation exactly, including the same bail rules (inputs, menus,
 * dialogs) and the same stable-via-refs effect dependency arrays.
 */
export function useHotkeys(params: UseHotkeysParams): UseHotkeysResult {
  const {
    api, project, setProjectValue, setActionError, selectedSource, nudgeSelectedSources, updateSource, fitSource, stretchSource, centerSource,
    undoSceneEdit, redoSceneEdit, pasteSource, removeSelectedSource, copySelectedSource,
    sourceClipboardAvailable, chooseScene, startRecording, stopRecording, isRecording, isActivelyRecording, stopStreaming,
    isStreaming, openStreamDialog, startReplayBuffer, stopReplayBuffer, saveReplay, isReplayBufferActive, openSettings,
  } = params;

  const [hotkeyDraft, setHotkeyDraft] = useState<StreamGlobalHotkeys | null>(null);
  const [sceneSwitchHotkeyDraft, setSceneSwitchHotkeyDraft] = useState<Record<string, string>>({});
  const [sourceVisibilityHotkeyDraft, setSourceVisibilityHotkeyDraft] = useState<Record<string, string>>({});
  const [hotkeyError, setHotkeyError] = useState('');
  const [hotkeysWorking, setHotkeysWorking] = useState(false);

  const hotkeyDispatch = useRef<((action: StreamHotkeyAction) => void) | null>(null);
  const sourceClipboardAvailableRef = useRef(sourceClipboardAvailable);
  sourceClipboardAvailableRef.current = sourceClipboardAvailable;

  useEffect(() => {
    if (!project) return;
    setHotkeyDraft({ ...project.hotkeys });
    setSceneSwitchHotkeyDraft({ ...project.sceneSwitchHotkeys });
    setSourceVisibilityHotkeyDraft({ ...project.sourceVisibilityHotkeys });
    void api.setGlobalHotkeys(project.hotkeys, project.sceneSwitchHotkeys, project.sourceVisibilityHotkeys).catch((error) => setActionError(`Global shortcuts could not be registered: ${friendlyError(error)}`));
  }, [api, project?.hotkeys, project?.sceneSwitchHotkeys, project?.sourceVisibilityHotkeys, setActionError]);

  useEffect(() => api.onGlobalHotkey((action) => hotkeyDispatch.current?.(action)), [api]);

  hotkeyDispatch.current = (action) => {
    if (action.startsWith('toggleSourceVisibility:')) {
      const sourceId = action.slice('toggleSourceVisibility:'.length);
      updateSource(sourceId, (source) => ({ ...source, visible: !source.visible }));
    } else if (action.startsWith('switchScene:')) {
      chooseScene(action.slice('switchScene:'.length));
    } else if (action === 'toggleStreaming') {
      if (isStreaming()) stopStreaming();
      else openStreamDialog();
    } else if (action === 'toggleRecording') {
      if (isRecording()) stopRecording(); else void startRecording();
    } else if (action === 'toggleReplayBuffer') {
      if (isReplayBufferActive()) stopReplayBuffer(); else void startReplayBuffer();
    } else if (isReplayBufferActive()) {
      void saveReplay();
    } else {
      setActionError('Start the replay buffer before saving a replay.');
    }
  };

  const applyHotkeys = async () => {
    if (!project || !hotkeyDraft || hotkeysWorking) return;
    setHotkeysWorking(true);
    setHotkeyError('');
    try {
      await api.setGlobalHotkeys(hotkeyDraft, sceneSwitchHotkeyDraft, sourceVisibilityHotkeyDraft);
      setProjectValue((current) => ({ ...current, hotkeys: hotkeyDraft, sceneSwitchHotkeys: sceneSwitchHotkeyDraft, sourceVisibilityHotkeys: sourceVisibilityHotkeyDraft }));
    } catch (error) {
      setHotkeyError(friendlyError(error));
    } finally { setHotkeysWorking(false); }
  };

  const captureHotkey = (action: StreamHotkeyAction, event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Tab') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || !hotkeyDraft) return;
    const result = classifyHotkeyCapture(event);
    if (result.kind === 'ignore') return;
    if (result.kind === 'cancel') {
      setHotkeyError('');
      event.currentTarget.blur();
      return;
    }
    if (result.kind === 'clear') {
      setHotkeyError('');
      setHotkeyDraft((current) => current ? { ...current, [action]: '' } : current);
      return;
    }
    if (result.kind === 'invalid') {
      setHotkeyError('Use a modifier key and one shortcut key.');
      return;
    }
    setHotkeyError('');
    setHotkeyDraft((current) => current ? { ...current, [action]: result.value } : current);
  };

  const captureSceneSwitchHotkey = (sceneId: string, event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Tab') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    const result = classifyHotkeyCapture(event);
    if (result.kind === 'ignore') return;
    if (result.kind === 'cancel') {
      setHotkeyError('');
      event.currentTarget.blur();
      return;
    }
    if (result.kind === 'clear') {
      setHotkeyError('');
      setSceneSwitchHotkeyDraft((current) => ({ ...current, [sceneId]: '' }));
      return;
    }
    if (result.kind === 'invalid') {
      setHotkeyError('Use a modifier key and one shortcut key.');
      return;
    }
    setHotkeyError('');
    setSceneSwitchHotkeyDraft((current) => ({ ...current, [sceneId]: result.value }));
  };

  const captureSourceVisibilityHotkey = (sourceId: string, event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Tab') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    const result = classifyHotkeyCapture(event);
    if (result.kind === 'ignore') return;
    if (result.kind === 'cancel') {
      setHotkeyError('');
      event.currentTarget.blur();
      return;
    }
    if (result.kind === 'clear') {
      setHotkeyError('');
      setSourceVisibilityHotkeyDraft((current) => ({ ...current, [sourceId]: '' }));
      return;
    }
    if (result.kind === 'invalid') {
      setHotkeyError('Use a modifier key and one shortcut key.');
      return;
    }
    setHotkeyError('');
    setSourceVisibilityHotkeyDraft((current) => ({ ...current, [sourceId]: result.value }));
  };

  // `onKeyDown` below reads all of these every keypress; bundling the ones
  // that change across renders into one ref (reassigned every render) lets
  // the effect register its window listener once with a stable `[]`
  // dependency array instead of tearing it down and re-attaching it on every render.
  const globalKeydownRef = useRef({
    selectedSource, project, redoSceneEdit, undoSceneEdit, pasteSource, nudgeSelectedSources,
    removeSelectedSource, stopRecording, startRecording, fitSource, stretchSource,
    centerSource, updateSource, copySelectedSource, isActivelyRecording, openSettings,
  });
  globalKeydownRef.current = {
    selectedSource, project, redoSceneEdit, undoSceneEdit, pasteSource, nudgeSelectedSources,
    removeSelectedSource, stopRecording, startRecording, fitSource, stretchSource,
    centerSource, updateSource, copySelectedSource, isActivelyRecording, openSettings,
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return;
      // A menu, menubar, or another dialog is open and should own keyboard
      // input (e.g. arrow-key navigation, Delete inside a text field) instead
      // of this global shortcut handler racing it.
      const active = document.activeElement;
      if (active instanceof Element && active.closest('[role="menu"], [role="menubar"], [role="menuitem"], [role="menuitemcheckbox"], [role="dialog"]')) return;
      if (document.querySelector('[data-popup-open], [role="menu"]:not([hidden])')) return;
      const context = globalKeydownRef.current;
      if ((event.ctrlKey || event.metaKey) && event.code === 'Comma') {
        event.preventDefault();
        context.openSettings();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') {
        event.preventDefault();
        if (event.shiftKey) context.redoSceneEdit(); else context.undoSceneEdit();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') {
        event.preventDefault();
        context.redoSceneEdit();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyC' && context.selectedSource) {
        event.preventDefault();
        context.copySelectedSource();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyV' && sourceClipboardAvailableRef.current) {
        event.preventDefault();
        void context.pasteSource();
        return;
      }
      if (event.code === 'Delete' && context.selectedSource) {
        event.preventDefault();
        context.removeSelectedSource();
        return;
      }
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyR') {
        event.preventDefault();
        if (context.isActivelyRecording()) context.stopRecording(); else void context.startRecording();
      }
      if (!context.selectedSource || !context.project) return;
      const selected = context.selectedSource;
      const activeProject = context.project;
      const delta = event.shiftKey ? 10 : 1;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier) {
        if (event.code === 'KeyF') { event.preventDefault(); context.fitSource(selected); return; }
        if (event.code === 'KeyS') { event.preventDefault(); context.stretchSource(selected); return; }
        if (event.code === 'KeyD') { event.preventDefault(); context.centerSource(selected); return; }
        if (event.code === 'KeyR') { event.preventDefault(); context.updateSource(selected.id, (source) => ({ ...source, transform: defaultTransform(source.kind, activeProject.output, source.mediaKind) })); return; }
      }
      const shifts: Record<string, [number, number]> = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] };
      const shift = shifts[event.code];
      if (shift) {
        event.preventDefault();
        context.nudgeSelectedSources(shift[0], shift[1]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return {
    hotkeyDraft, sceneSwitchHotkeyDraft, sourceVisibilityHotkeyDraft, hotkeyError, hotkeysWorking,
    applyHotkeys, captureHotkey, captureSceneSwitchHotkey, captureSourceVisibilityHotkey,
  };
}
