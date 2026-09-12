import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ResourceDrawer } from '../../../../../app/renderer/features/workbench/resource-drawer';

// Scoped media-bin drop contract: the resource drawer imports files dropped
// on it only when they match the active media tab. Anything else — a .cst
// bundle, a file for another tab, or an internal sortable drag — must not
// trigger a media import.

const mocks = vi.hoisted(() => ({
  drawerTab: 'image' as string,
  importMedia: vi.fn(),
}));

vi.mock('../../../../../app/renderer/features/workbench/resource-drawer-context', () => ({
  useResourceDrawer: () => ({
    drawerTab: mocks.drawerTab,
    setDrawerTab: vi.fn(),
    drawerViewMode: 'grid' as const,
    setDrawerViewMode: vi.fn(),
  }),
}));

vi.mock('../../../../../app/renderer/contexts/canvas/canvas-context', () => ({
  useElements: () => ({ importMedia: mocks.importMedia }),
}));

function imageFile(): File {
  return new File(['pixels'], 'photo.png', { type: 'image/png' });
}

function audioFile(): File {
  return new File(['sound'], 'track.mp3', { type: 'audio/mpeg' });
}

function bundleFile(): File {
  return new File(['bundle'], 'deck.cst', { type: '' });
}

function fileTransfer(files: File[]): unknown {
  return {
    items: files.map((file) => ({ kind: 'file', type: file.type })),
    files,
  };
}

function renderDrawer() {
  return render(
    <ResourceDrawer.Root>
      <div data-testid="drawer-child" />
    </ResourceDrawer.Root>,
  );
}

function drawerFooter(container: HTMLElement): HTMLElement {
  const footer = container.querySelector('[data-ui-region="resource-drawer"]');
  if (!(footer instanceof HTMLElement)) throw new Error('resource drawer footer not found');
  return footer;
}

describe('resource drawer scoped media drops', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.drawerTab = 'image';
  });

  afterEach(() => {
    cleanup();
  });

  it('imports an image dropped on the image tab', () => {
    const { container } = renderDrawer();
    const footer = drawerFooter(container);

    fireEvent.drop(footer, { dataTransfer: fileTransfer([imageFile()]) });

    expect(mocks.importMedia).toHaveBeenCalledTimes(1);
  });

  it('ignores a .cst bundle dropped on the image tab', () => {
    const { container } = renderDrawer();
    const footer = drawerFooter(container);

    fireEvent.drop(footer, { dataTransfer: fileTransfer([bundleFile()]) });

    expect(mocks.importMedia).not.toHaveBeenCalled();
  });

  it('imports only the matching files from a mixed image + .cst drop', () => {
    const { container } = renderDrawer();
    const footer = drawerFooter(container);

    fireEvent.drop(footer, { dataTransfer: fileTransfer([imageFile(), bundleFile()]) });

    expect(mocks.importMedia).toHaveBeenCalledTimes(1);
    const passed = mocks.importMedia.mock.calls[0]?.[0] as unknown as ArrayLike<File>;
    expect(Array.from(passed).map((file) => file.name)).toEqual(['photo.png']);
  });

  it('imports audio on the audio tab but ignores image files there', () => {
    mocks.drawerTab = 'audio';
    const { container } = renderDrawer();
    const footer = drawerFooter(container);

    fireEvent.drop(footer, { dataTransfer: fileTransfer([audioFile()]) });
    expect(mocks.importMedia).toHaveBeenCalledTimes(1);

    mocks.importMedia.mockClear();
    fireEvent.drop(footer, { dataTransfer: fileTransfer([imageFile()]) });
    expect(mocks.importMedia).not.toHaveBeenCalled();
  });

  it.each([['image', 'photo.PNG'], ['audio', 'track.MP3']])('recognizes %s files without MIME metadata', (tab, name) => {
    mocks.drawerTab = tab;
    const { container } = renderDrawer();
    fireEvent.drop(drawerFooter(container), { dataTransfer: fileTransfer([new File(['data'], name)]) });
    expect(mocks.importMedia).toHaveBeenCalledTimes(1);
    expect(mocks.importMedia.mock.calls[0]?.[0][0].name).toBe(name);
  });

  it('imports nothing on the non-import deck tab', () => {
    mocks.drawerTab = 'deck';
    const { container } = renderDrawer();
    const footer = drawerFooter(container);

    fireEvent.drop(footer, { dataTransfer: fileTransfer([imageFile()]) });

    expect(mocks.importMedia).not.toHaveBeenCalled();
  });

  it('leaves internal sortable drags alone: no highlight and no import', () => {
    const { container } = renderDrawer();
    const footer = drawerFooter(container);
    const internalDrag = {
      types: ['text/plain'],
      items: [{ kind: 'string', type: 'text/plain' }],
      files: [],
    };

    fireEvent.dragOver(footer, { dataTransfer: internalDrag });

    expect(footer.className).toContain('border-t-primary');
    expect(footer.className).not.toContain('border-t-focus');
    expect(mocks.importMedia).not.toHaveBeenCalled();
  });

  it('still highlights the drawer while a matching file is dragged over', () => {
    const { container } = renderDrawer();
    const footer = drawerFooter(container);

    fireEvent.dragOver(footer, { dataTransfer: fileTransfer([imageFile()]) });

    expect(footer.className).toContain('border-t-focus');
  });
});
