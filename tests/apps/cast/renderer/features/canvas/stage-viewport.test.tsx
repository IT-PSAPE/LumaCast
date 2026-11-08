import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  editable: true,
  editScene: { id: 'edit', width: 1280, height: 720, nodes: [] },
  showScene: { id: 'show', width: 1920, height: 1080, nodes: [] },
  actions: {
    handleDragOver: vi.fn(),
    handleDrop: vi.fn(),
    handleViewportChange: vi.fn(),
  },
  editableStageProps: [] as Array<Record<string, unknown>>,
  readOnlyStageProps: [] as Array<Record<string, unknown>>,
}));

const h = React.createElement;

vi.mock('@lumacast/canvas', () => ({
  useStageViewportController: () => ({
    actions: mocks.actions,
    state: {
      editable: mocks.editable,
      scene: mocks.editable ? mocks.editScene : mocks.showScene,
    },
  }),
}));

vi.mock('../../../../../../apps/cast/renderer/components/display/scene-frame', () => ({
  SceneFrame: ({ children }: { children: React.ReactNode }) => h('div', null, children),
}));

vi.mock('../../../../../../apps/cast/renderer/contexts/canvas/canvas-context', () => ({
  useElements: () => ({ createFromMedia: vi.fn() }),
  useRenderScenes: () => ({ editScene: mocks.editScene, showScene: mocks.showScene }),
}));

vi.mock('../../../../../../apps/cast/renderer/contexts/canvas/use-active-editor-source', () => ({
  useActiveEditorSource: () => ({ editable: mocks.editable }),
}));

vi.mock('../../../../../../apps/cast/renderer/contexts/workbench-context', () => ({
  useWorkbench: () => ({ actions: { setInspectorTab: vi.fn() } }),
}));

vi.mock('../../../../../../apps/cast/renderer/features/canvas/scene-stage', () => ({
  SceneStage: (props: Record<string, unknown>) => {
    mocks.editableStageProps.push(props);
    return h('div', { 'data-testid': 'editable-stage' });
  },
}));

vi.mock('../../../../../../apps/cast/renderer/rendering/scene-render-stage', () => ({
  SceneRenderStage: (props: Record<string, unknown>) => {
    mocks.readOnlyStageProps.push(props);
    return h('div', { 'data-testid': 'read-only-stage' });
  },
}));

import { StageViewport } from '../../../../../../apps/cast/renderer/features/canvas/stage-viewport';

beforeEach(() => {
  mocks.editable = true;
  mocks.editableStageProps.length = 0;
  mocks.readOnlyStageProps.length = 0;
});

afterEach(() => {
  cleanup();
});

describe('StageViewport composition', () => {
  it('composes the editable scene stage for an editable source', () => {
    const { getByTestId } = render(h(StageViewport));

    expect(getByTestId('editable-stage')).not.toBeNull();
    expect(mocks.editableStageProps[0]).toMatchObject({ scene: mocks.editScene, surface: 'deck-editor' });
    expect(mocks.readOnlyStageProps).toHaveLength(0);
  });

  it('composes the read-only scene renderer for a non-editable source', () => {
    mocks.editable = false;

    const { getByTestId } = render(h(StageViewport));

    expect(getByTestId('read-only-stage')).not.toBeNull();
    expect(mocks.readOnlyStageProps[0]).toMatchObject({ scene: mocks.showScene, surface: 'deck-editor' });
    expect(mocks.editableStageProps).toHaveLength(0);
  });
});
