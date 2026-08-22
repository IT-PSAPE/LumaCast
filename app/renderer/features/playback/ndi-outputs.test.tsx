import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { NdiOutputs } from './ndi-outputs';

const mocks = vi.hoisted(() => ({
  outputState: {
    audience: false,
    stage: false,
  },
  programScene: { nodes: [], sceneId: 'program-scene' },
  stageScene: { nodes: [], sceneId: 'stage-scene' },
  programBindingValue: { currentSlideText: 'program' },
  stageBindingValue: { currentSlideText: 'stage' },
  programOutput: {
    scene: { nodes: [], sceneId: 'program-scene' },
    background: 'black' as const,
    status: 'live' as const,
  },
}));

vi.mock('../../contexts/app-context', () => ({
  useNdi: () => ({
    state: { outputState: mocks.outputState },
  }),
}));

vi.mock('../../contexts/navigation-context', () => ({
  useNavigation: () => ({
    currentOutputPlaylistEntryId: 'playlist-entry-1',
    currentOutputItemRef: { type: 'presentation', id: 'item-1' },
  }),
}));

vi.mock('@lumacast/canvas', () => ({
  BindingProvider: ({ children, value }: { children: ReactNode; value: unknown }) => (
    <div data-testid="binding-provider" data-binding={JSON.stringify(value)}>
      {children}
    </div>
  ),
}));

vi.mock('./ndi-frame-capture', () => ({
  NdiFrameCapture: ({
    senderName,
    scene,
    surface,
    outputScopeKey,
    enabled,
  }: {
    senderName: string;
    scene: { sceneId?: string };
    surface: string;
    outputScopeKey: string | null;
    enabled: boolean;
  }) => (
    <div
      data-testid={`capture-${senderName}`}
      data-scene={scene.sceneId}
      data-surface={surface}
      data-output-scope={outputScopeKey ?? ''}
      data-enabled={String(enabled)}
    />
  ),
}));

vi.mock('./use-stage-scene', () => ({
  useStageScene: () => mocks.stageScene,
  useProgramBindingValue: () => mocks.programBindingValue,
  useStageBindingValue: () => mocks.stageBindingValue,
}));

vi.mock('./use-program-output', () => ({
  useProgramOutput: () => mocks.programOutput,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.outputState.audience = false;
  mocks.outputState.stage = false;
});

afterEach(() => {
  cleanup();
});

describe('NdiOutputs', () => {
  it('mounts no capture stages when every output is disabled', () => {
    const { queryByTestId } = render(<NdiOutputs />);

    expect(queryByTestId('capture-audience')).toBeNull();
    expect(queryByTestId('capture-stage')).toBeNull();
  });

  it('routes the audience and stage captures through their current scene sources and bindings', () => {
    mocks.outputState.audience = true;
    mocks.outputState.stage = true;

    const { getAllByTestId, getByTestId } = render(<NdiOutputs />);

    expect(getByTestId('capture-audience').getAttribute('data-surface')).toBe('ndi-show');
    expect(getByTestId('capture-audience').getAttribute('data-scene')).toBe('program-scene');
    expect(getByTestId('capture-audience').getAttribute('data-output-scope')).toBe('entry:playlist-entry-1');
    expect(getByTestId('capture-audience').getAttribute('data-enabled')).toBe('true');
    expect(getByTestId('capture-stage').getAttribute('data-surface')).toBe('ndi-stage');
    expect(getByTestId('capture-stage').getAttribute('data-scene')).toBe('stage-scene');
    expect(getByTestId('capture-stage').getAttribute('data-output-scope')).toBe('');
    expect(getByTestId('capture-stage').getAttribute('data-enabled')).toBe('true');

    expect(getAllByTestId('binding-provider').map((node) => node.getAttribute('data-binding'))).toEqual([
      JSON.stringify(mocks.programBindingValue),
      JSON.stringify(mocks.stageBindingValue),
    ]);
  });

  it('unmounts both capture stages once every output is turned back off', () => {
    mocks.outputState.audience = true;
    mocks.outputState.stage = true;
    const view = render(<NdiOutputs />);

    expect(view.getByTestId('capture-audience')).not.toBeNull();
    expect(view.getByTestId('capture-stage')).not.toBeNull();

    mocks.outputState.audience = false;
    mocks.outputState.stage = false;
    view.rerender(<NdiOutputs />);

    expect(view.queryByTestId('capture-audience')).toBeNull();
    expect(view.queryByTestId('capture-stage')).toBeNull();
  });
});
