import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StageBinPanel } from '../../../../../../app/renderer/features/assets/stages/stage-bin-panel';

const mocks = vi.hoisted(() => ({
  currentStageId: null as string | null,
  setCurrentStageId: vi.fn(),
}));

vi.mock('../../../../../../app/renderer/contexts/playback/playback-context', () => ({
  useStagePlayback: () => ({
    currentStageId: mocks.currentStageId,
    setCurrentStageId: mocks.setCurrentStageId,
  }),
}));

vi.mock('../../../../../../app/renderer/contexts/asset-editor/asset-editor-context', () => ({
  useStageEditor: () => ({ setCurrentStageId: vi.fn() }),
}));

vi.mock('../../../../../../app/renderer/contexts/workbench-context', () => ({
  useWorkbench: () => ({ actions: { setWorkbenchMode: vi.fn() } }),
}));

vi.mock('../../../../../../app/renderer/contexts/use-project-content', () => ({
  useProjectContent: () => ({ stages: [] }),
}));

vi.mock('@renderer/components/controls/bin-controls', () => ({
  useBinControls: () => ({ state: { searchValue: '', viewMode: 'grid', grid: null } }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.currentStageId = null;
});

describe('StageBinPanel — clear armed stage', () => {
  it('offers a "Clear stage" affordance that clears the armed stage', () => {
    mocks.currentStageId = 'stage-1';
    render(<StageBinPanel />);

    const clearButton = screen.getByRole('button', { name: 'Clear stage' });
    fireEvent.click(clearButton);

    expect(mocks.setCurrentStageId).toHaveBeenCalledWith(null);
  });

  it('reflects whether a stage is currently armed', () => {
    mocks.currentStageId = null;
    const { rerender } = render(<StageBinPanel />);
    let clearButton = screen.getByRole('button', { name: 'Clear stage' });
    expect(clearButton.className).not.toContain('text-brand');

    mocks.currentStageId = 'stage-1';
    rerender(<StageBinPanel />);
    clearButton = screen.getByRole('button', { name: 'Clear stage' });
    expect(clearButton.className).toContain('text-brand');
  });
});
