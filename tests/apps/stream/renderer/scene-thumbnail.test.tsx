import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aggregateSceneAudioLevel, SceneThumbnail } from '../../../../apps/stream/renderer/docks/scene-thumbnail';
import type { StreamProject, StreamScene, StreamSource } from '../../../../apps/stream/shared/desktop-api';

vi.mock('../../../../apps/stream/renderer/canvas-composition', () => ({
  CanvasComposition: () => <span data-testid="composition-mounted" />,
}));

function source(id: string, overrides: Partial<StreamSource> = {}): StreamSource {
  return {
    id,
    name: id,
    kind: 'microphone',
    visible: true,
    muted: false,
    volume: 1,
    transform: { x: 0, y: 0, width: 10, height: 10 },
    ...overrides,
  };
}

function scene(id: string, sources: StreamSource[]): StreamScene {
  return { id, name: id, sources };
}

function project(scenes: StreamScene[]): StreamProject {
  return { scenes } as StreamProject;
}

afterEach(() => vi.unstubAllGlobals());

describe('aggregateSceneAudioLevel', () => {
  it('combines visible source activity across groups and referenced scenes without mute weighting', () => {
    const target = scene('target', [source('nested-mic')]);
    const owner = scene('owner', [
      source('group', { kind: 'group', children: [source('mic-a'), source('hidden-mic', { visible: false })] }),
      source('reference', { kind: 'scene', referencedSceneId: target.id }),
    ]);

    expect(aggregateSceneAudioLevel(project([owner, target]), owner, {
      'mic-a': 0.4,
      'nested-mic': 0.3,
      'hidden-mic': 1,
      unrelated: 1,
    })).toBeCloseTo(0.5);
  });

  it('caps combined activity at full scale', () => {
    const sceneWithTwoSources = scene('scene', [source('mic-a'), source('mic-b')]);
    expect(aggregateSceneAudioLevel(project([sceneWithTwoSources]), sceneWithTwoSources, { 'mic-a': 0.9, 'mic-b': 0.9 })).toBe(1);
  });
});

describe('SceneThumbnail', () => {
  it('reports visibility without recreating its observer for same-scene project or meter updates', () => {
    let observerCallback: IntersectionObserverCallback | null = null;
    let observerCount = 0;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback;
        observerCount += 1;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
    });
    const target = scene('scene', [source('mic')]);
    const onVisibilityChange = vi.fn();
    const nextVisibilityChange = vi.fn();

    const view = render(<SceneThumbnail
      project={project([target])}
      scene={target}
      videoElements={new Map()}
      imageElements={new Map()}
      meterLevels={{}}
      onVisibilityChange={onVisibilityChange}
    />);

    expect(screen.getByText('Preview')).toBeInTheDocument();
    expect(screen.queryByTestId('composition-mounted')).toBeNull();

    const updatedScene = scene('scene', [source('mic')]);
    view.rerender(<SceneThumbnail
      project={project([updatedScene])}
      scene={updatedScene}
      videoElements={new Map()}
      imageElements={new Map()}
      meterLevels={{ mic: 0.5 }}
      onVisibilityChange={nextVisibilityChange}
    />);
    expect(observerCount).toBe(1);

    act(() => observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(nextVisibilityChange).toHaveBeenCalledWith('scene', true);
    expect(onVisibilityChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('composition-mounted')).toBeInTheDocument();
    expect(screen.queryByText('Preview')).toBeNull();

    view.unmount();
    expect(nextVisibilityChange).toHaveBeenLastCalledWith('scene', false);
  });
});
