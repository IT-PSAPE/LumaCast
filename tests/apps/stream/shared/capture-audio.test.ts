import { describe, expect, it } from 'vitest';
import { captureAudioApplicationName, captureAudioModeForSource, hasWindowCaptureAudioIntent, uniqueAudioApplicationForPath } from '../../../../apps/stream/shared/capture-audio';
import type { StreamSource } from '../../../../apps/stream/shared/desktop-api';

type SourceWithCaptureAudio = StreamSource & {
  captureAudioMode?: 'system' | 'application';
  captureAudioApplicationPath?: string;
};

function source(overrides: Partial<SourceWithCaptureAudio> = {}): SourceWithCaptureAudio {
  return {
    id: 'capture-1', name: 'Display', kind: 'display', visible: true, muted: false, volume: 1,
    transform: { x: 0, y: 0, width: 100, height: 100 },
    ...overrides,
  };
}

describe('capture audio settings', () => {
  it('defaults new captures to no audio', () => {
    expect(captureAudioModeForSource(source(), 'win32')).toBe('off');
    expect(captureAudioModeForSource(source(), 'darwin')).toBe('off');
  });

  it('keeps legacy enabled capture audio as Windows system loopback only', () => {
    expect(captureAudioModeForSource(source({ captureAudioEnabled: true }), 'win32')).toBe('system');
    expect(captureAudioModeForSource(source({ captureAudioEnabled: true }), 'darwin')).toBe('off');
  });

  it('disables all saved window audio modes without erasing whether audio was requested', () => {
    const legacyWindow = source({ kind: 'window', captureAudioEnabled: true });
    const applicationWindow = source({ kind: 'window', captureAudioMode: 'application', captureAudioApplicationPath: '/Applications/Editor' });
    const disabledWindow = source({ kind: 'window', captureAudioEnabled: false, captureAudioMode: 'system' });

    expect(captureAudioModeForSource(legacyWindow, 'win32')).toBe('off');
    expect(captureAudioModeForSource(applicationWindow, 'darwin')).toBe('off');
    expect(captureAudioModeForSource(disabledWindow, 'win32')).toBe('off');
    expect(hasWindowCaptureAudioIntent(legacyWindow)).toBe(true);
    expect(hasWindowCaptureAudioIntent(applicationWindow)).toBe(true);
    expect(hasWindowCaptureAudioIntent(disabledWindow)).toBe(false);
  });

  it('uses an explicit saved audio mode and lets disabled override stale mode data', () => {
    expect(captureAudioModeForSource(source({ captureAudioMode: 'application' }), 'darwin')).toBe('application');
    expect(captureAudioModeForSource(source({ captureAudioEnabled: false, captureAudioMode: 'system' }), 'win32')).toBe('off');
  });

  it('extracts the application name from a persisted path from either OS', () => {
    expect(captureAudioApplicationName('/Applications/Editor.app/Contents/MacOS/Editor')).toBe('Editor');
    expect(captureAudioApplicationName('C:\\Program Files\\Editor\\Editor.exe')).toBe('Editor.exe');
    expect(captureAudioApplicationName(undefined)).toBeUndefined();
  });

  it('restores an application only for a unique saved executable path', () => {
    const applications = [
      { pid: 10, name: 'Editor', path: 'C:\\Program Files\\Editor\\Editor.exe' },
      { pid: 11, name: 'Editor', path: 'C:\\Program Files\\Editor\\Editor.exe' },
      { pid: 12, name: 'Other', path: 'C:\\Program Files\\Other\\Other.exe' },
    ];
    expect(uniqueAudioApplicationForPath(applications, 'c:/program files/editor/editor.exe', 'win32')).toBeNull();
    expect(uniqueAudioApplicationForPath(applications, applications[2]!.path, 'win32')).toEqual(applications[2]);
    expect(uniqueAudioApplicationForPath(applications, undefined, 'win32')).toBeNull();
  });
});
