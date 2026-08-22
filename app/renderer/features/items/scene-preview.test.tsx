import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScenePreview } from './scene-preview';

const lazySceneStageMock = vi.hoisted(() => vi.fn());

vi.mock('../../components/display/lazy-scene-stage', () => ({
  LazySceneStage: (props: { surface: string; className?: string }) => {
    lazySceneStageMock(props);
    return <div data-testid="lazy-scene-stage" data-surface={props.surface} className={props.className} />;
  },
}));

afterEach(() => {
  lazySceneStageMock.mockReset();
});

describe('ScenePreview', () => {
  it('renders the empty placeholder when no scene is available', () => {
    render(<ScenePreview scene={null} />);

    expect(screen.getByText('Empty')).not.toBeNull();
    expect(screen.queryByTestId('lazy-scene-stage')).toBeNull();
  });

  it('routes non-empty previews through LazySceneStage', () => {
    const scene = { width: 1280, height: 720 } as never;

    render(<ScenePreview scene={scene} />);

    expect(screen.getByTestId('lazy-scene-stage').getAttribute('data-surface')).toBe('list');
    expect(lazySceneStageMock).toHaveBeenCalledTimes(1);
  });
});
