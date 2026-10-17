// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { GlobalHotkeyManager } from '../../../../apps/stream/main/global-hotkeys';
import { DEFAULT_STREAM_GLOBAL_HOTKEYS } from '../../../../apps/stream/shared/desktop-api';

function setup() {
  const callbacks = new Map<string, () => void>();
  const register = vi.fn((accelerator: string, callback: () => void) => {
    callbacks.set(accelerator, callback);
    return true;
  });
  const unregister = vi.fn((accelerator: string) => { callbacks.delete(accelerator); });
  const send = vi.fn();
  const manager = new GlobalHotkeyManager(
    () => ({ isDestroyed: () => false, send } as never),
    { register, unregister },
  );
  return { manager, callbacks, register, unregister, send };
}

describe('Stream global scene-switch hotkeys', () => {
  it('registers scene bindings and dispatches a scene-specific action', () => {
    const { manager, callbacks, send } = setup();
    manager.set(DEFAULT_STREAM_GLOBAL_HOTKEYS, { 'scene-live': 'Control+Shift+1' });

    callbacks.get('Control+Shift+1')?.();
    expect(send).toHaveBeenCalledWith('stream:global-hotkey', 'switchScene:scene-live');
  });

  it('rejects duplicate bindings across output actions and scenes', () => {
    const { manager, register } = setup();
    expect(() => manager.set(DEFAULT_STREAM_GLOBAL_HOTKEYS, { 'scene-live': 'Control+Alt+F9' }))
      .toThrow('Each global shortcut must be unique.');
    expect(register).not.toHaveBeenCalled();
  });

  it('unregisters a removed scene binding when settings are updated', () => {
    const { manager, unregister, register } = setup();
    manager.set(DEFAULT_STREAM_GLOBAL_HOTKEYS, { 'scene-live': 'Control+Shift+1' });
    manager.set(DEFAULT_STREAM_GLOBAL_HOTKEYS, {});

    expect(unregister).toHaveBeenCalledWith('Control+Shift+1');
    expect(register).toHaveBeenCalledTimes(9);
  });
});
