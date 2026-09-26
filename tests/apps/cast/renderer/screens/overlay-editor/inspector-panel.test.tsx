import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { SlideElement } from '@lumacast/composition';

const mocks = vi.hoisted(() => ({
  workbenchState: { inspectorTab: 'binding' as string },
  setInspectorTab: vi.fn(),
  selectedElement: { id: 'el-1', slideId: 'slide-1', type: 'text' } as SlideElement | null,
}));

vi.mock('@renderer/contexts/canvas/canvas-context', () => ({
  useElements: () => ({ selectedElement: mocks.selectedElement }),
}));

vi.mock('@renderer/contexts/workbench-context', () => ({
  useWorkbench: () => ({
    state: mocks.workbenchState,
    actions: { setInspectorTab: (tab: string) => { mocks.setInspectorTab(tab); mocks.workbenchState.inspectorTab = tab; } },
    overlayStack: { register: vi.fn(), unregister: vi.fn(), stack: [] as string[], baseZIndex: 100, rootElement: undefined },
  }),
}));

vi.mock('@renderer/contexts/asset-editor/asset-editor-context', () => ({
  useOverlayEditor: () => ({ currentOverlay: null }),
}));

vi.mock('@renderer/contexts/use-project-content', () => ({
  useProjectContent: () => ({ overlaysById: new Map() }),
}));

vi.mock('@renderer/screens/overlay-editor/screen-context', () => ({
  useOverlayEditorScreen: () => ({ state: { hasPendingChanges: false }, actions: { saveChanges: vi.fn() } }),
}));

vi.mock('@renderer/features/inspector/binding-inspector', () => ({ BindingInspector: () => <div data-testid="binding-inspector" /> }));
vi.mock('@renderer/features/inspector/shape-element-inspector', () => ({ ShapeElementInspector: () => <div data-testid="shape-inspector" /> }));
vi.mock('@renderer/features/inspector/slide-inspector', () => ({ SlideInspector: () => <div data-testid="slide-inspector" /> }));
vi.mock('@renderer/features/inspector/entity-background-inspector', () => ({ EntityBackgroundInspector: () => <div data-testid="background-inspector" /> }));
vi.mock('@renderer/features/inspector/text-element-inspector', () => ({ TextElementInspector: () => <div data-testid="text-inspector" /> }));
vi.mock('@renderer/features/inspector/video-element-inspector', () => ({ VideoElementInspector: () => <div data-testid="video-inspector" /> }));

import { OverlayEditorInspectorPanel } from '@renderer/screens/overlay-editor/inspector-panel';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workbenchState.inspectorTab = 'binding';
  mocks.selectedElement = { id: 'el-1', slideId: 'slide-1', type: 'text' } as SlideElement;
});

afterEach(() => {
  cleanup();
});

describe('OverlayEditorInspectorPanel tabs', () => {
  it('labels the binding tab "Text link"', () => {
    render(<OverlayEditorInspectorPanel />);
    expect(screen.getByRole('tab', { name: 'Text link' })).not.toBeNull();
    expect(screen.queryByRole('tab', { name: 'Binding' })).toBeNull();
  });
});
