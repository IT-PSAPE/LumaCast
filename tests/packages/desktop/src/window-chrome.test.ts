import { describe, expect, it, vi } from 'vitest';
import { TITLE_BAR_HEIGHT, TRAFFIC_LIGHT_HEIGHT } from '@lumacast/kernel';
import { OVERLAY_COLORS, applyTitleBarOverlay, windowChromeOptions } from '../../../../packages/desktop/src/window-chrome';

describe('windowChromeOptions', () => {
  it('darwin: hidden title bar with centred traffic lights and no overlay', () => {
    const o = windowChromeOptions('darwin');
    expect(o.titleBarStyle).toBe('hidden');
    expect(o.titleBarOverlay).toBeUndefined();
    expect(o.trafficLightPosition).toEqual({ x: 14, y: (TITLE_BAR_HEIGHT - TRAFFIC_LIGHT_HEIGHT) / 2 });
  });

  it.each(['win32', 'linux'])('%s: hidden title bar with overlay matching the shared height', (platform) => {
    const o = windowChromeOptions(platform);
    expect(o.titleBarStyle).toBe('hidden');
    expect(o.trafficLightPosition).toBeUndefined();
    expect(o.titleBarOverlay?.height).toBe(TITLE_BAR_HEIGHT);
    expect(o.titleBarOverlay).toMatchObject(OVERLAY_COLORS.dark);
  });

  it('follows a custom height on every platform', () => {
    expect(windowChromeOptions('win32', 44).titleBarOverlay?.height).toBe(44);
    expect(windowChromeOptions('darwin', 44).trafficLightPosition?.y).toBe(15);
    expect(windowChromeOptions('darwin', 4).trafficLightPosition?.y).toBe(0);
  });

  it('accepts custom overlay colors', () => {
    const o = windowChromeOptions('linux', 36, { color: '#00000000', symbolColor: '#d4d4d4' });
    expect(o.titleBarOverlay).toEqual({ color: '#00000000', symbolColor: '#d4d4d4', height: 36 });
  });

  it('treats an unknown platform like win32/linux', () => {
    expect(windowChromeOptions('freebsd').titleBarOverlay?.height).toBe(TITLE_BAR_HEIGHT);
  });
});

describe('applyTitleBarOverlay', () => {
  const hex = /^#[0-9A-F]{6}$/i;
  const win = (destroyed = false) => ({ isDestroyed: () => destroyed, setTitleBarOverlay: vi.fn() });

  it('light and dark sets are distinct, well-formed hex', () => {
    for (const set of [OVERLAY_COLORS.light, OVERLAY_COLORS.dark]) {
      expect(set.color).toMatch(hex);
      expect(set.symbolColor).toMatch(hex);
    }
    expect(OVERLAY_COLORS.light.color).not.toBe(OVERLAY_COLORS.dark.color);
    expect(OVERLAY_COLORS.light.symbolColor).not.toBe(OVERLAY_COLORS.dark.symbolColor);
  });

  it('applies the theme colours with the shared height on win32/linux', () => {
    const w = win();
    applyTitleBarOverlay(w, 'light', 'win32');
    expect(w.setTitleBarOverlay).toHaveBeenCalledWith({ ...OVERLAY_COLORS.light, height: TITLE_BAR_HEIGHT });
  });

  it('no-ops on darwin', () => {
    const w = win();
    applyTitleBarOverlay(w, 'dark', 'darwin');
    expect(w.setTitleBarOverlay).not.toHaveBeenCalled();
  });

  it('no-ops when destroyed, unavailable, or throwing', () => {
    const d = win(true);
    applyTitleBarOverlay(d, 'dark', 'linux');
    expect(d.setTitleBarOverlay).not.toHaveBeenCalled();
    expect(() => applyTitleBarOverlay({ isDestroyed: () => false }, 'dark', 'linux')).not.toThrow();
    const t = { isDestroyed: () => false, setTitleBarOverlay: () => { throw new Error('x'); } };
    expect(() => applyTitleBarOverlay(t, 'dark', 'linux')).not.toThrow();
  });
});
