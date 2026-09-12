import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { FileDropNavigationGuard } from '../../../app/renderer/App';

// The app-wide .cst drag-and-drop importer was removed because its window
// listeners intercepted image/audio drops meant for the media bins. Bundle
// import stays on the click-driven "Choose bundle…" picker. These tests pin
// that contract: no global overlay/import, navigation safety kept.

const APP_PATH = path.join(process.cwd(), 'app/renderer/App.tsx');
const DROP_IMPORT_PATH = path.join(
  process.cwd(),
  'app/renderer/features/items/bundle-drop-import.tsx',
);

function dispatchWindowFileDrop(type: 'dragover' | 'drop', files: File[]): boolean {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    dataTransfer?: unknown;
  };
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: ['Files'], files },
  });
  return window.dispatchEvent(event);
}

describe('app-level file drop behavior', () => {
  beforeEach(() => {
    (window as unknown as { castApi?: unknown }).castApi = {
      platform: 'darwin',
      inspectImportBundle: vi.fn(),
      finalizeImportBundle: vi.fn(),
      getPathForFile: vi.fn(() => '/tmp/deck.cst'),
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete (window as unknown as { castApi?: unknown }).castApi;
  });

  it('removes the global bundle drop importer module', () => {
    expect(existsSync(DROP_IMPORT_PATH)).toBe(false);
  });

  it('wires no global bundle drop UI or inspection from App', () => {
    const source = readFileSync(APP_PATH, 'utf8');
    expect(source).not.toContain('BundleDropImport');
    expect(source).not.toContain('bundle-drop-import');
    expect(source).not.toContain('Drop to import deck bundle');
    expect(source).not.toContain('inspectImportBundle');
  });

  it('keeps the playback schedules provider in the App tree', () => {
    const source = readFileSync(APP_PATH, 'utf8');
    expect(source).toContain('PlaybackSchedulesProvider');
  });

  it('renders no overlay while a file is dragged over the window', () => {
    const { queryByText } = render(<FileDropNavigationGuard />);
    dispatchWindowFileDrop('dragover', [new File(['x'], 'photo.png', { type: 'image/png' })]);

    expect(queryByText(/drop to import/i)).toBeNull();
    expect(queryByText(/accepts \.cst/i)).toBeNull();
  });

  it('leaves native text drag-and-drop defaults alone', () => {
    render(<FileDropNavigationGuard />);
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['text/plain'], files: [] } });
    expect(window.dispatchEvent(event)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  it('prevents window navigation on file drops without starting a bundle import', () => {
    const api = (window as unknown as { castApi: { inspectImportBundle: ReturnType<typeof vi.fn> } })
      .castApi;
    render(<FileDropNavigationGuard />);

    const dragoverDefaultKept = !dispatchWindowFileDrop('dragover', [
      new File(['bundle'], 'deck.cst', { type: '' }),
    ]);
    const dropDefaultKept = !dispatchWindowFileDrop('drop', [
      new File(['bundle'], 'deck.cst', { type: '' }),
    ]);

    expect(dragoverDefaultKept).toBe(true);
    expect(dropDefaultKept).toBe(true);
    expect(api.inspectImportBundle).not.toHaveBeenCalled();
  });
});
