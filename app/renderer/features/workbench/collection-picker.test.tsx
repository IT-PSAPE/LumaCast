import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WorkbenchProvider } from '../../contexts/workbench-context';
import { CollectionPicker } from './collection-picker';
import { useBinCollections } from './use-bin-collections';

// Covers #221: the collection-picker create surface runs through
// use-bin-collections.createCollection, which reports the specific failure
// via setStatusText and then rethrows. The bare `void handleCreate()` at the
// call site let that rethrow escape as an unhandled rejection; the fix absorbs
// it because the wrapper has already reported.

const mocks = vi.hoisted(() => ({
  cast: {
    mutatePatch: null as unknown,
    setStatusText: null as unknown,
  },
  project: { value: null as unknown },
  confirm: { fn: null as unknown },
}));

vi.mock('../../contexts/app-context', () => ({
  useCast: () => ({
    mutatePatch: mocks.cast.mutatePatch,
    setStatusText: mocks.cast.setStatusText,
  }),
}));

vi.mock('../../contexts/use-project-content', () => ({
  useProjectContent: () => mocks.project.value,
}));

vi.mock('../../components/overlays/confirm-dialog', () => ({
  useConfirm: () => mocks.confirm.fn,
}));

function PickerHarness() {
  const collections = useBinCollections('deck');
  return <CollectionPicker api={collections} />;
}

function setCastApi(overrides: Record<string, unknown>): void {
  (window as unknown as { castApi: Record<string, unknown> }).castApi = {
    createCollection: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  mocks.confirm.fn = vi.fn().mockResolvedValue(true);
  mocks.project.value = { collectionsByBinKind: new Map() };
  mocks.cast.mutatePatch = async (action: () => Promise<unknown>) => {
    try {
      return await action();
    } catch (error) {
      (mocks.cast.setStatusText as (message: string) => void)('Operation failed');
      throw error;
    }
  };
  mocks.cast.setStatusText = vi.fn();
  setCastApi({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('collection-picker create surface (#221)', () => {
  it('reports a rejecting createCollection with the specific message and leaves no unhandled rejection', async () => {
    const setStatusText = mocks.cast.setStatusText as ReturnType<typeof vi.fn>;
    const createCollection = (window as unknown as { castApi: { createCollection: ReturnType<typeof vi.fn> } }).castApi.createCollection;
    createCollection.mockRejectedValue(new Error('create boom'));

    render(
      <WorkbenchProvider>
        <PickerHarness />
      </WorkbenchProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByTitle('Collections'));
    });

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Search or create…'), { target: { value: 'New Coll' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create/ }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createCollection).toHaveBeenCalledWith({ binKind: 'deck', name: 'New Coll' });
    // The use-bin-collections wrapper reported the underlying error, not the
    // generic 'Operation failed' set by the mutatePatch guard.
    expect(setStatusText).toHaveBeenCalledWith('create boom');
  });
});