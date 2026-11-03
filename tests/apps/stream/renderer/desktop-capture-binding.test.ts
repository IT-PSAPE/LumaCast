import { describe, expect, it } from 'vitest';
import type { DesktopSourceOption, StreamSource } from '../../../../apps/stream/shared/desktop-api';
import { bindDesktopCaptureSource } from '../../../../apps/stream/renderer/desktop-capture-binding';
import { getSourceRuntimeId, preserveDesktopCaptureRuntime } from '../../../../apps/stream/renderer/source-runtime';

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

    expect(rebound).toMatchObject({ ...saved, captureId: option.id, captureTarget: { kind: 'window', name: option.name } });
    expect(rebound.captureBindingId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(rebound.id).toBe(saved.id);
    expect(rebound.name).toBe(saved.name);
    expect(rebound.transform).toBe(saved.transform);
    expect(rebound.crop).toBe(saved.crop);
  });

  it('stores a cursor change made while reconnecting', () => {
    expect(bindDesktopCaptureSource(source(), option, 'always').cursorMode).toBe('always');
  });

  it('retains the binding generation for an exact same-target reconnect', () => {
    const captureBindingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const saved = source({
      captureId: option.id,
      captureTarget: { kind: 'window', name: option.name },
      captureBindingId,
    });

    expect(bindDesktopCaptureSource(saved, option, 'never').captureBindingId).toBe(captureBindingId);
  });

  it('keeps an automatic legacy restore without inventing a generation', () => {
    const legacy = source({ captureId: 'window:legacy:0' });
    const rebound = bindDesktopCaptureSource(legacy, option, 'motion', 'automatic-restore');

    expect(rebound.captureBindingId).toBeUndefined();
    expect(rebound.captureId).toBe(option.id);
  });

  it('gives a manually selected reused native ID a new generation even when title and app match', () => {
    const clues = { kind: 'window' as const, name: 'Untitled', appIconHash: 'a'.repeat(64) };
    const saved = source({ captureId: 'window:10:0', captureTarget: clues, captureBindingId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const fresh = { ...option, id: 'window:20:0', name: clues.name, appIconHash: clues.appIconHash };
    const restored = bindDesktopCaptureSource(saved, fresh, 'motion', 'automatic-restore');
    const liveRuntimeId = preserveDesktopCaptureRuntime(saved, restored);
    const explicitlySelected = bindDesktopCaptureSource(restored, { ...fresh, id: 'window:10:0' }, 'motion');
    expect(explicitlySelected.captureBindingId).not.toBe(saved.captureBindingId);
    expect(getSourceRuntimeId(explicitlySelected)).not.toBe(liveRuntimeId);
  });

  it('preserves an existing generation during automatic restore despite refreshed target clues', () => {
    const captureBindingId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const saved = source({
      captureId: 'window:old:0',
      captureTarget: { kind: 'window', name: 'Old title', appIconHash: 'a'.repeat(64) },
      captureBindingId,
    });
    const freshOption = { ...option, id: 'window:new:0', name: 'New title', appIconHash: 'b'.repeat(64) };

    expect(bindDesktopCaptureSource(saved, freshOption, 'motion', 'automatic-restore').captureBindingId).toBe(captureBindingId);
  });

  it('rejects rebinding a window source to a display', () => {
    expect(() => bindDesktopCaptureSource(source(), { ...option, kind: 'screen' }, 'motion')).toThrow(/type does not match/);
  });

  it('supports reconnecting display sources to display options', () => {
    const display = source({ kind: 'display', cursorMode: 'motion' });
    const rebound = bindDesktopCaptureSource(display, { ...option, id: 'screen:replacement', kind: 'screen' }, 'motion');
    expect(rebound).toMatchObject({ ...display, captureId: 'screen:replacement', captureTarget: { kind: 'screen', name: option.name } });
    expect(rebound.captureBindingId).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
