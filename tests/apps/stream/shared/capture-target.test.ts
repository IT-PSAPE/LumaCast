import { describe, expect, it } from 'vitest';
import type { DesktopCaptureTarget, DesktopSourceOption } from '../../../../apps/stream/shared/desktop-api';
import {
  captureTargetForOption,
  isValidDesktopCaptureTarget,
  resolveDesktopCaptureOption,
} from '../../../../apps/stream/shared/capture-target';

const windowIcon = 'a'.repeat(64);

function option(id: string, name: string, overrides: Partial<DesktopSourceOption> = {}): DesktopSourceOption {
  return { id, name, kind: 'window', thumbnail: '', ...overrides };
}

describe('desktop capture target identity', () => {
  it('stores bounded durable clues from the selected option', () => {
    expect(captureTargetForOption(option('window:123:0', 'Editor', {
      appIconHash: windowIcon,
    }))).toEqual({ kind: 'window', name: 'Editor', appIconHash: windowIcon });
    expect(captureTargetForOption({
      id: 'screen:1:0', name: 'Display', kind: 'screen', thumbnail: '', displayId: 'display-id',
    })).toEqual({ kind: 'screen', name: 'Display', displayId: 'display-id' });
    expect(captureTargetForOption(option('window:123:0', 'x'.repeat(600))).name).toHaveLength(512);
  });

  it('resolves a screen by unique stable display ID', () => {
    const sources = [
      { id: 'screen:1:0', name: 'Screen 1', kind: 'screen' as const, thumbnail: '', displayId: 'display-a' },
      { id: 'screen:2:0', name: 'Screen 2', kind: 'screen' as const, thumbnail: '', displayId: 'display-b' },
    ];
    const target: DesktopCaptureTarget = { kind: 'screen', name: 'Old Screen Name', displayId: 'display-b' };

    expect(resolveDesktopCaptureOption(sources, 'screen', 'screen:1:0', target)).toEqual(sources[1]);
  });

  it('rejects missing or ambiguous display IDs instead of guessing by label', () => {
    const sources = [
      { id: 'screen:1:0', name: 'Screen 1', kind: 'screen' as const, thumbnail: '', displayId: 'duplicate' },
      { id: 'screen:2:0', name: 'Screen 1', kind: 'screen' as const, thumbnail: '', displayId: 'duplicate' },
    ];
    const target: DesktopCaptureTarget = { kind: 'screen', name: 'Screen 1', displayId: 'duplicate' };

    expect(resolveDesktopCaptureOption(sources, 'screen', 'screen:1:0', target)).toBeNull();
    expect(resolveDesktopCaptureOption(sources, 'screen', undefined, { ...target, displayId: 'missing' })).toBeNull();
  });

  it('matches a still-open window by native handle and app icon despite a changed Electron marker or title', () => {
    const current = option('window:4425:1', 'Edited document - Editor', { appIconHash: windowIcon });
    const target: DesktopCaptureTarget = { kind: 'window', name: 'Untitled - Editor', appIconHash: windowIcon };

    expect(resolveDesktopCaptureOption([current], 'window', 'window:4425:0', target)).toBe(current);
  });

  it('does not fall back to another window when a reused native handle has a different app icon', () => {
    const current = option('window:4425:1', 'Project - Editor', { appIconHash: 'b'.repeat(64) });
    const otherMatchingByTitle = option('window:919:0', 'Untitled - Editor', { appIconHash: windowIcon });
    const target: DesktopCaptureTarget = { kind: 'window', name: 'Untitled - Editor', appIconHash: windowIcon };

    expect(resolveDesktopCaptureOption([current, otherMatchingByTitle], 'window', 'window:4425:0', target)).toBeNull();
  });

  it('falls back only to a unique exact title and app-icon match', () => {
    const unique = option('window:919:0', 'Untitled - Editor', { appIconHash: windowIcon });
    const target: DesktopCaptureTarget = { kind: 'window', name: unique.name, appIconHash: windowIcon };
    expect(resolveDesktopCaptureOption([unique], 'window', 'window:1:0', target)).toBe(unique);

    const duplicate = option('window:920:0', unique.name, { appIconHash: windowIcon });
    expect(resolveDesktopCaptureOption([unique, duplicate], 'window', 'window:1:0', target)).toBeNull();
  });

  it('does not use title alone when window IDs change', () => {
    const current = option('window:919:0', 'Untitled - Editor');
    const target: DesktopCaptureTarget = { kind: 'window', name: current.name };
    expect(resolveDesktopCaptureOption([current], 'window', 'window:1:0', target)).toBeNull();
  });

  it('supports legacy sources only when both the current native ID and saved name match', () => {
    const current = option('window:919:0', 'Editor - Document');
    expect(resolveDesktopCaptureOption([current], 'window', current.id, undefined, current.name)).toBe(current);
    expect(resolveDesktopCaptureOption([current], 'window', current.id, undefined, 'Renamed source')).toBeNull();
    expect(resolveDesktopCaptureOption([current], 'window', 'window:1:0', undefined, current.name)).toBeNull();
  });

  it('validates target kind and bounded metadata', () => {
    expect(isValidDesktopCaptureTarget({ kind: 'window', name: 'Editor', appIconHash: windowIcon })).toBe(true);
    expect(isValidDesktopCaptureTarget({ kind: 'window', name: 'Editor', displayId: 'display' })).toBe(false);
    expect(isValidDesktopCaptureTarget({ kind: 'screen', name: 'Screen', appIconHash: windowIcon })).toBe(false);
    expect(isValidDesktopCaptureTarget({ kind: 'window', name: 'Editor', appIconHash: 'not-a-hash' })).toBe(false);
    expect(isValidDesktopCaptureTarget({ kind: 'window', name: 'x'.repeat(513) })).toBe(false);
  });
});
