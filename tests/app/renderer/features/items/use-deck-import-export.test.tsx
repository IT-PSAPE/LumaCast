import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { BundleInspection } from '@lumacast/protocol';
import { useDeckImportExport } from '../../../../../app/renderer/features/items/use-deck-import-export';

// The click-driven bundle picker flow must keep working after the app-wide
// drag-and-drop importer is removed: choosing a bundle inspects it, and
// confirming finalizes the import once broken references are resolved.

const mocks = vi.hoisted(() => ({
  snapshot: { playlists: [] as unknown[] },
  mutate: vi.fn((action: () => Promise<unknown>) => action()),
  setStatusText: vi.fn(),
}));

vi.mock('../../../../../app/renderer/contexts/app-context', () => ({
  useCast: () => ({
    snapshot: mocks.snapshot,
    mutate: mocks.mutate,
    setStatusText: mocks.setStatusText,
  }),
}));

vi.mock('../../../../../app/renderer/contexts/use-project-content', () => ({
  useProjectContent: () => ({ presentations: [], lyrics: [] }),
}));

type Harness = ReturnType<typeof useDeckImportExport>;

let latest: Harness | null = null;

function HarnessProbe() {
  latest = useDeckImportExport();
  return null;
}

function cleanInspection(): BundleInspection {
  return {
    itemCount: 2,
    playlistCount: 0,
    themeCount: 1,
    overlayCount: 0,
    stageCount: 0,
    mediaReferenceCount: 0,
    items: [],
    playlists: [],
    brokenReferences: [],
  } as unknown as BundleInspection;
}

describe('deck bundle picker import flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    latest = null;
    (window as unknown as { castApi?: Record<string, unknown> }).castApi = {
      chooseBundleImportPath: vi.fn(async () => '/tmp/deck.cst'),
      inspectImportBundle: vi.fn(async () => cleanInspection()),
      finalizeImportBundle: vi.fn(async () => undefined),
      chooseImportReplacementMediaPath: vi.fn(async () => null),
    };
    render(<HarnessProbe />);
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { castApi?: unknown }).castApi;
  });

  function api() {
    return (window as unknown as { castApi: Record<string, ReturnType<typeof vi.fn>> }).castApi;
  }

  it('inspects the bundle chosen through the picker', async () => {
    await act(async () => {
      await latest?.actions.chooseImportBundle();
    });

    expect(api().chooseBundleImportPath).toHaveBeenCalledTimes(1);
    expect(api().inspectImportBundle).toHaveBeenCalledWith('/tmp/deck.cst');
    expect(latest?.state.importPath).toBe('/tmp/deck.cst');
    expect(latest?.state.inspection?.itemCount).toBe(2);
  });

  it('loads nothing when the picker is cancelled', async () => {
    api().chooseBundleImportPath.mockResolvedValueOnce(null);

    await act(async () => {
      await latest?.actions.chooseImportBundle();
    });

    expect(api().inspectImportBundle).not.toHaveBeenCalled();
    expect(latest?.state.inspection).toBeNull();
  });

  it('finalizes a clean inspection and clears the review', async () => {
    await act(async () => {
      await latest?.actions.chooseImportBundle();
    });
    await act(async () => {
      await latest?.actions.finalizeImport();
    });

    expect(api().finalizeImportBundle).toHaveBeenCalledWith('/tmp/deck.cst', []);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(latest?.state.inspection).toBeNull();
    expect(latest?.state.importPath).toBeNull();
  });

  it('blocks finalize until broken references are resolved', async () => {
    api().inspectImportBundle.mockResolvedValueOnce({
      ...cleanInspection(),
      brokenReferences: [{ source: 'cast-media://missing.png' }],
    } as unknown as BundleInspection);

    await act(async () => {
      await latest?.actions.chooseImportBundle();
    });
    expect(latest?.state.blockedImportReasons.length).toBeGreaterThan(0);

    await act(async () => {
      await latest?.actions.finalizeImport();
    });

    expect(api().finalizeImportBundle).not.toHaveBeenCalled();
    expect(latest?.state.inspection).not.toBeNull();
  });
});
