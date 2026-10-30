import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SlideElement } from '@lumacast/composition';

const mocks = vi.hoisted(() => ({
  selectedElementIds: ['el-a', 'el-b', 'el-locked'],
  effectiveElements: [] as SlideElement[],
  nudgeSelection: vi.fn(async () => undefined),
  commitElementUpdates: vi.fn(async () => undefined),
  alignSelection: vi.fn(async () => undefined),
  distributeSelection: vi.fn(async () => undefined),
  groupSelection: vi.fn(async () => undefined),
  ungroupSelection: vi.fn(async () => undefined),
  duplicateSelection: vi.fn(async () => undefined),
  deleteSelected: vi.fn(async () => undefined),
}));

vi.mock('@renderer/contexts/canvas/canvas-context', () => ({
  useElements: () => mocks,
}));

import { MultiSelectionInspector } from '@renderer/features/inspector/multi-selection-inspector';

function element(id: string, x: number, y: number, opacity: number, locked = false): SlideElement {
  return {
    id, slideId: 'slide-1', type: 'shape',
    x, y, width: 100, height: 50, rotation: 0, opacity, zIndex: 0, layer: 'content',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    payload: { locked },
  } as SlideElement;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MultiSelectionInspector', () => {
  it('moves editable selected objects by one shared delta while showing the selection count', () => {
    mocks.selectedElementIds = ['el-a', 'el-b', 'el-locked'];
    mocks.effectiveElements = [
      element('el-a', 10, 20, 0.5),
      element('el-b', 70, 80, 0.5),
      element('el-locked', 5, 9, 0.5, true),
    ];
    render(<MultiSelectionInspector />);

    expect(screen.getByText('3 selected')).toBeInTheDocument();
    expect(screen.getByText('1 locked')).toBeInTheDocument();
    const xInput = screen.getByRole('spinbutton', { name: 'Selection X' });
    expect(xInput).toHaveValue('10');
    fireEvent.change(xInput, { target: { value: '30' } });
    fireEvent.blur(xInput);

    expect(mocks.nudgeSelection).toHaveBeenCalledWith(20, 0);
  });

  it('batches a common opacity change to unlocked elements only', () => {
    mocks.selectedElementIds = ['el-a', 'el-b', 'el-locked'];
    mocks.effectiveElements = [
      element('el-a', 10, 20, 0.5),
      element('el-b', 70, 80, 0.5),
      element('el-locked', 5, 9, 0.5, true),
    ];
    render(<MultiSelectionInspector />);
    const opacityInput = screen.getByRole('spinbutton', { name: 'Opacity (%)' });
    fireEvent.change(opacityInput, { target: { value: '75' } });
    fireEvent.blur(opacityInput);

    expect(mocks.commitElementUpdates).toHaveBeenCalledWith([
      { id: 'el-a', opacity: 0.75 },
      { id: 'el-b', opacity: 0.75 },
    ], true);
  });
});
