import { describe, expect, it } from 'vitest';
import type { DesktopSourceOption, StreamSource } from '../../../../apps/stream/shared/desktop-api';
import { bindDesktopCaptureSource } from '../../../../apps/stream/renderer/desktop-capture-binding';

const option: DesktopSourceOption = { id: 'window:replacement', name: 'Replacement window', kind: 'window', thumbnail: '' };

function source(overrides: Partial<StreamSource> = {}): StreamSource {
  return {
    id: 'source-1', name: 'My saved window', kind: 'window', visible: true, muted: true, volume: 0.6,
    transform: { x: 12, y: 34, width: 800, height: 450 }, cursorMode: 'never', crop: { top: 1, right: 2, bottom: 3, left: 4 },
    ...overrides,
  };
}

describe('desktop capture source binding', () => {
  it('replaces the capture id while preserving source identity and saved properties', () => {
    const saved = source();
    const rebound = bindDesktopCaptureSource(saved, option, 'never');

    expect(rebound).toEqual({ ...saved, captureId: option.id });
    expect(rebound.id).toBe(saved.id);
    expect(rebound.name).toBe(saved.name);
    expect(rebound.transform).toBe(saved.transform);
    expect(rebound.crop).toBe(saved.crop);
  });

  it('stores a cursor change made while reconnecting', () => {
    expect(bindDesktopCaptureSource(source(), option, 'always').cursorMode).toBe('always');
  });

  it('rejects rebinding a window source to a display', () => {
    expect(() => bindDesktopCaptureSource(source(), { ...option, kind: 'screen' }, 'motion')).toThrow(/type does not match/);
  });

  it('supports reconnecting display sources to display options', () => {
    const display = source({ kind: 'display', cursorMode: 'motion' });
    expect(bindDesktopCaptureSource(display, { ...option, id: 'screen:replacement', kind: 'screen' }, 'motion'))
      .toEqual({ ...display, captureId: 'screen:replacement' });
  });
});
