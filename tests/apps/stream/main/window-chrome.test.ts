import { describe, expect, it } from 'vitest';
import { TITLE_BAR_HEIGHT, mainWindowChromeOptions } from '../../../../apps/stream/main/window-chrome';

describe('mainWindowChromeOptions', () => {
  it('keeps native traffic lights inset on darwin, with no titleBarOverlay', () => {
    const options = mainWindowChromeOptions('darwin');
    expect(options).toEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 11 },
    });
  });

  it('hides the native title bar and asks for an overlay on win32', () => {
    const options = mainWindowChromeOptions('win32');
    expect(options).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#171717', symbolColor: '#CBCBCB', height: TITLE_BAR_HEIGHT },
    });
    expect(options.trafficLightPosition).toBeUndefined();
  });

  it('hides the native title bar and asks for an overlay on linux, same as win32', () => {
    expect(mainWindowChromeOptions('linux')).toEqual(mainWindowChromeOptions('win32'));
  });

  it('overlay height matches the exported title bar height', () => {
    expect(TITLE_BAR_HEIGHT).toBe(36);
    const options = mainWindowChromeOptions('win32');
    expect(options.titleBarOverlay).toMatchObject({ height: TITLE_BAR_HEIGHT });
  });
});
