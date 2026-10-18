// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { hardenPopupWebContents } from '../../../../apps/stream/main/popup-policy';

function createWebContents() {
  return {
    on: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  };
}

describe('hardenPopupWebContents', () => {
  it('denies in-place navigation within the popup', () => {
    const webContents = createWebContents();

    hardenPopupWebContents(webContents);

    expect(webContents.on).toHaveBeenCalledWith('will-navigate', expect.any(Function));
    const [, onWillNavigate] = webContents.on.mock.calls[0];
    const preventDefault = vi.fn();
    onWillNavigate({ preventDefault }, 'https://example.com');

    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('denies any further popup the popup itself tries to open', () => {
    const webContents = createWebContents();

    hardenPopupWebContents(webContents);

    expect(webContents.setWindowOpenHandler).toHaveBeenCalledOnce();
    const handler = webContents.setWindowOpenHandler.mock.calls[0][0];
    expect(handler()).toEqual({ action: 'deny' });
  });
});
