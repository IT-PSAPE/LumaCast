import { describe, expect, it } from 'vitest';
import { TITLE_BAR_HEIGHT, TRAFFIC_LIGHT_HEIGHT } from '@lumacast/kernel';
import { windowChromeOptions } from '../../../../packages/desktop/src/window-chrome';

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
    expect(o.titleBarOverlay).toMatchObject({ color: '#171717', symbolColor: '#CBCBCB' });
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
