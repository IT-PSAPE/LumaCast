import { describe, expect, it, vi } from 'vitest';
import { buildCloudTrayMenu } from '../../../../apps/cloud/main/tray-menu';

describe('apps/cloud tray menu', () => {
  it('provides open, manual check, and quit actions', () => {
    const onOpen = vi.fn();
    const onCheckForUpdates = vi.fn();
    const onQuit = vi.fn();
    const menu = buildCloudTrayMenu({ onOpen, onCheckForUpdates, onQuit });

    const openAction = menu.find((item) => item.label === 'Open LumaCloud');
    const checkAction = menu.find((item) => item.label === 'Check for Updates…');
    const quitAction = menu.find((item) => item.label === 'Quit LumaCloud');
    expect(openAction).toBeDefined();
    expect(checkAction).toBeDefined();
    expect(quitAction).toBeDefined();

    (openAction?.click as unknown as () => void)();
    (checkAction?.click as unknown as () => void)();
    (quitAction?.click as unknown as () => void)();

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onCheckForUpdates).toHaveBeenCalledOnce();
    expect(onQuit).toHaveBeenCalledOnce();
  });
});
