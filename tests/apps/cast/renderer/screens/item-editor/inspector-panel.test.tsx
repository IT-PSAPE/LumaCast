import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { SlideElement } from '@lumacast/composition';

const mocks = vi.hoisted(() => ({
  inspectorTab: 'shape' as string,
  setInspectorTab: vi.fn(),
  selectedElement: { id: 'el-1', slideId: 'slide-1', type: 'text' } as SlideElement | null,
  selectedElementIds: ['el-1', 'el-2'],
}));

vi.mock('@renderer/contexts/canvas/canvas-context', () => ({
  useElements: () => ({ selectedElement: mocks.selectedElement, selectedElementIds: mocks.selectedElementIds }),
}));

vi.mock('@renderer/contexts/workbench-context', () => ({
  useWorkbench: () => ({
    state: { inspectorTab: mocks.inspectorTab },
    actions: { setInspectorTab: (tab: string) => { mocks.setInspectorTab(tab); mocks.inspectorTab = tab; } },
    overlayStack: { register: vi.fn(), unregister: vi.fn(), stack: [] as string[], baseZIndex: 100, rootElement: undefined },
  }),
}));

vi.mock('@renderer/screens/item-editor/screen-context', () => ({
  useItemEditorScreen: () => ({ state: { hasPendingChanges: false }, actions: { saveChanges: vi.fn() } }),
}));

vi.mock('@renderer/features/inspector/item-inspector', () => ({ ItemInspector: () => <div data-testid="item-inspector" /> }));
vi.mock('@renderer/features/inspector/slide-background-inspector', () => ({ SlideBackgroundInspector: () => <div data-testid="background-inspector" /> }));
vi.mock('@renderer/features/inspector/shape-element-inspector', () => ({ ShapeElementInspector: () => <div data-testid="shape-inspector" /> }));
vi.mock('@renderer/features/inspector/multi-selection-inspector', () => ({ MultiSelectionInspector: () => <div data-testid="multi-selection-inspector" /> }));
vi.mock('@renderer/features/inspector/text-element-inspector', () => ({ TextElementInspector: () => <div data-testid="text-inspector" /> }));
vi.mock('@renderer/features/inspector/video-element-inspector', () => ({ VideoElementInspector: () => <div data-testid="video-inspector" /> }));

import { ItemEditorInspectorPanel } from '@renderer/screens/item-editor/inspector-panel';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inspectorTab = 'shape';
  mocks.selectedElement = { id: 'el-1', slideId: 'slide-1', type: 'text' } as SlideElement;
  mocks.selectedElementIds = ['el-1', 'el-2'];
});

afterEach(cleanup);

describe('ItemEditorInspectorPanel multi-selection', () => {
  it('routes to the shared inspector without primary-only text tabs', () => {
    mocks.inspectorTab = 'text';
    render(<ItemEditorInspectorPanel />);

    expect(screen.getByRole('tab', { name: 'Selection' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Text' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Video' })).not.toBeInTheDocument();
    expect(screen.getByTestId('multi-selection-inspector')).toBeInTheDocument();
    expect(screen.queryByTestId('shape-inspector')).not.toBeInTheDocument();
  });
});
