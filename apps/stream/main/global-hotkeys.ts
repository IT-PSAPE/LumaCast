import { globalShortcut, type WebContents } from 'electron';
import type { StreamGlobalHotkeys, StreamHotkeyAction } from '../shared/desktop-api';
import { IPC_CHANNELS } from './ipc-channels';

interface ShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

const ACTIONS: Array<keyof StreamGlobalHotkeys> = ['toggleStreaming', 'toggleRecording', 'toggleReplayBuffer', 'saveReplay'];
const MODIFIERS: Record<string, string> = {
  control: 'Control', ctrl: 'Control', alt: 'Alt', shift: 'Shift', super: 'Super', meta: 'Super', altgr: 'AltGr',
};
const KEY_ALIASES: Record<string, string> = {
  esc: 'Escape', enter: 'Enter', return: 'Enter', space: 'Space', pageup: 'PageUp', pagedown: 'PageDown',
  capslock: 'Capslock', numlock: 'Numlock', scrolllock: 'Scrolllock', backspace: 'Backspace', delete: 'Delete',
  insert: 'Insert', up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End',
  volumeup: 'VolumeUp', volumedown: 'VolumeDown', volumemute: 'VolumeMute', medianexttrack: 'MediaNextTrack',
  mediaprevioustrack: 'MediaPreviousTrack', mediastop: 'MediaStop', mediaplaypause: 'MediaPlayPause',
  printscreen: 'PrintScreen', plus: 'Plus',
};
const NAMED_KEYS = new Set([
  'Escape', 'Enter', 'Space', 'Tab', 'Capslock', 'Numlock', 'Scrolllock', 'Backspace', 'Delete', 'Insert',
  'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown', 'VolumeUp', 'VolumeDown', 'VolumeMute',
  'MediaNextTrack', 'MediaPreviousTrack', 'MediaStop', 'MediaPlayPause', 'PrintScreen', 'Plus',
]);
const PUNCTUATION_KEYS = new Set([')', '!', '@', '#', '$', '%', '^', '&', '*', '(', ':', ';', '=', '<', ',', '_', '-', '>', '.', '?', '/', '~', '`', '{', ']', '[', '|', '\\', '}', '"']);
const MODIFIER_ORDER = ['Control', 'Alt', 'Shift', 'Super', 'AltGr'];

function normalizeAccelerator(value: string): string {
  if (value === '') return '';
  if (value.length > 64 || /\s/.test(value)) throw new Error('Enter a valid shortcut.');
  const pieces = value.split('+');
  if (pieces.some((piece) => !piece)) throw new Error('Enter a valid shortcut.');
  const modifiers = new Set<string>();
  let key = '';
  for (const piece of pieces) {
    const modifier = MODIFIERS[piece.toLowerCase()];
    if (modifier) {
      if (modifiers.has(modifier)) throw new Error('A shortcut cannot repeat a modifier.');
      modifiers.add(modifier);
      continue;
    }
    if (key) throw new Error('A shortcut must end with one key.');
    const upper = piece.toUpperCase();
    if (/^[A-Z0-9]$/.test(upper)) key = upper;
    else if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(piece)) key = upper;
    else {
      const alias = KEY_ALIASES[piece.toLowerCase()];
      if (alias && NAMED_KEYS.has(alias)) key = alias;
      else if (PUNCTUATION_KEYS.has(piece)) key = piece;
      else throw new Error('Enter a supported shortcut key.');
    }
  }
  if (!key || modifiers.size === 0) throw new Error('A global shortcut needs a modifier and one key.');
  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].join('+');
}

export class GlobalHotkeyManager {
  private registered: Record<string, string> = {};

  constructor(
    private readonly getContents: () => WebContents | null,
    private readonly shortcuts: ShortcutRegistry = globalShortcut,
  ) {}

  set(
    settings: StreamGlobalHotkeys,
    sceneSwitchHotkeys: Record<string, string> = {},
    sourceVisibilityHotkeys: Record<string, string> = {},
  ): void {
    if (!settings || typeof settings !== 'object') throw new Error('Invalid global shortcut settings.');
    if (!sceneSwitchHotkeys || typeof sceneSwitchHotkeys !== 'object' || Array.isArray(sceneSwitchHotkeys)) throw new Error('Invalid scene shortcut settings.');
    if (!sourceVisibilityHotkeys || typeof sourceVisibilityHotkeys !== 'object' || Array.isArray(sourceVisibilityHotkeys)) throw new Error('Invalid source shortcut settings.');
    const next: Record<string, string> = {};
    const owners = new Map<string, string>();
    for (const action of ACTIONS) {
      const value = settings[action];
      if (typeof value !== 'string') throw new Error('Invalid global shortcut settings.');
      const accelerator = normalizeAccelerator(value);
      next[action] = accelerator;
    }
    for (const [sceneId, value] of Object.entries(sceneSwitchHotkeys)) {
      if (!sceneId || sceneId.length > 128 || /[\u0000-\u001f\u007f]/.test(sceneId) || typeof value !== 'string') {
        throw new Error('Invalid scene shortcut settings.');
      }
      next[`switchScene:${sceneId}`] = normalizeAccelerator(value);
    }
    for (const [sourceId, value] of Object.entries(sourceVisibilityHotkeys)) {
      if (!sourceId || sourceId.length > 128 || /[\u0000-\u001f\u007f]/.test(sourceId) || typeof value !== 'string') {
        throw new Error('Invalid source shortcut settings.');
      }
      next[`toggleSourceVisibility:${sourceId}`] = normalizeAccelerator(value);
    }
    for (const [action, accelerator] of Object.entries(next)) {
      if (!accelerator) continue;
      const identity = accelerator.toLowerCase();
      if (owners.has(identity)) throw new Error('Each global shortcut must be unique.');
      owners.set(identity, action);
    }
    const activeNext = Object.fromEntries(Object.entries(next).filter(([, accelerator]) => accelerator !== ''));
    if (Object.keys(activeNext).length === Object.keys(this.registered).length
      && Object.entries(activeNext).every(([action, accelerator]) => accelerator === this.registered[action])) return;

    const previous = this.registered;
    this.unregister();
    const installed: Record<string, string> = {};
    for (const [action, accelerator] of Object.entries(activeNext)) {
      let didRegister = false;
      try {
        didRegister = this.shortcuts.register(accelerator, () => {
          const contents = this.getContents();
          if (contents && !contents.isDestroyed()) contents.send(IPC_CHANNELS.globalHotkey, action as StreamHotkeyAction);
        });
      } catch { didRegister = false; }
      if (!didRegister) {
        for (const active of Object.values(installed)) if (active) this.shortcuts.unregister(active);
        this.registered = {};
        if (!this.restore(previous)) throw new Error(`Could not register ${accelerator}; the previous shortcuts could not all be restored.`);
        throw new Error(`${accelerator} is already in use by another application.`);
      }
      installed[action] = accelerator;
    }
    this.registered = installed;
  }

  unregisterAll(): void {
    this.unregister();
  }

  private unregister(): void {
    for (const accelerator of Object.values(this.registered)) if (accelerator) this.shortcuts.unregister(accelerator);
    this.registered = {};
  }

  private restore(previous: Record<string, string>): boolean {
    const restored: Record<string, string> = {};
    for (const action of Object.keys(previous)) {
      const accelerator = previous[action];
      if (!accelerator) continue;
      let didRegister = false;
      try {
        didRegister = this.shortcuts.register(accelerator, () => {
          const contents = this.getContents();
          if (contents && !contents.isDestroyed()) contents.send(IPC_CHANNELS.globalHotkey, action as StreamHotkeyAction);
        });
      } catch { didRegister = false; }
      if (!didRegister) {
        for (const active of Object.values(restored)) if (active) this.shortcuts.unregister(active);
        return false;
      }
      restored[action] = accelerator;
    }
    this.registered = restored;
    return true;
  }
}
