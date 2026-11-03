import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Toolbar } from '@lumacast/ui';
import { SlideControls } from '../../../../apps/stream/renderer/slide-controls';
import { resolveSlideControlSource, slideControlSources } from '../../../../apps/stream/renderer/slide-control-sources';
import { getSourceRuntimeId } from '../../../../apps/stream/renderer/source-runtime';
import { navigateSlidePlayback, resetSlidePlaybackStore, setSlidePlaybackActive } from '../../../../apps/stream/renderer/slideshow';
import { createDefaultProject, type StreamProject, type StreamSource } from '../../../../apps/stream/shared/desktop-api';

beforeEach(() => resetSlidePlaybackStore());
afterEach(() => {
  cleanup();
  resetSlidePlaybackStore();
});

describe('slide control target', () => {
  function project(scenes: Array<{ id: string; sources: StreamSource[] }>, activeSceneId = scenes[0]!.id): StreamProject {
    return { ...createDefaultProject(), activeSceneId, scenes: scenes.map((scene) => ({ ...scene, name: scene.id })) };
  }

  function deck(id: string, overrides: Partial<StreamSource> = {}) {
    return source({ id, name: id, slideshowImages: [{ assetId: id, assetExtension: 'png', name: id }], ...overrides });
  }

  it('prefers live decks and retains the chosen deck when Preview changes or has no slides', () => {
    const live = deck('live');
    const preparation = deck('preparation');
    const program = project([{ id: 'on-air', sources: [live] }]);
    const draft = project([{ id: 'on-air', sources: [live] }, { id: 'prepare', sources: [preparation] }, { id: 'empty', sources: [] }], 'prepare');
    const candidates = slideControlSources(draft, program, 'on-air');
    expect(resolveSlideControlSource(candidates, null)).toBe(live);

    const chosen = getSourceRuntimeId(preparation);
    const next = slideControlSources({ ...draft, activeSceneId: 'empty' }, program, 'on-air');
    expect(resolveSlideControlSource(next, chosen)).toBe(preparation);
    expect(resolveSlideControlSource(next, getSourceRuntimeId(live))).toBe(live);
  });

  it('omits hidden decks and decks inside hidden groups while keeping a visible Program copy', () => {
    const live = deck('live');
    const hidden = deck('hidden', { visible: false });
    const child = deck('group-child');
    const group = source({ id: 'group', kind: 'group', visible: false, children: [child] });
    const draft = project([{ id: 'on-air', sources: [{ ...live, visible: false }, hidden, group] }]);
    const program = project([{ id: 'on-air', sources: [live] }]);
    expect(slideControlSources(draft, program, 'on-air')).toEqual([live]);
    expect(slideControlSources(draft, null, null)).toEqual([]);
    expect(resolveSlideControlSource([], getSourceRuntimeId(hidden))).toBeNull();
  });

  it('deduplicates matching resources and keeps the Program label/configuration', () => {
    const live = deck('live');
    const preview = { ...live, id: 'preview-alias', name: 'Preview name' };
    const draft = project([{ id: 'prepare', sources: [preview] }]);
    const program = project([{ id: 'on-air', sources: [live] }]);
    expect(slideControlSources(draft, program, 'on-air')).toEqual([live]);
  });

  it('falls back to another visible deck when the chosen deck is hidden or removed', () => {
    const chosen = deck('chosen');
    const remaining = deck('remaining');
    const draft = project([{ id: 'prepare', sources: [{ ...chosen, visible: false }, remaining] }]);
    expect(resolveSlideControlSource(slideControlSources(draft, null, null), getSourceRuntimeId(chosen))).toBe(remaining);
  });
});

function source(overrides: Partial<StreamSource> = {}): StreamSource {
  return {
    id: 'slides', name: 'Sunday slides', kind: 'slideshow', visible: true, muted: false, volume: 1,
    transform: { x: 0, y: 0, width: 1920, height: 1080 }, slideshowAutoAdvance: false,
    slideshowImages: ['first', 'second', 'third'].map((assetId) => ({ assetId, assetExtension: 'png', name: assetId })),
    ...overrides,
  };
}

function renderControls(slides: StreamSource | null, disabled = false) {
  const onNavigate = vi.fn();
  render(<Toolbar label="Program controls"><SlideControls source={slides} onNavigate={onNavigate} disabled={disabled} /></Toolbar>);
  return onNavigate;
}

describe('SlideControls', () => {
  it('shows only for a selected slideshow or presentation', () => {
    renderControls(null);
    expect(screen.queryByRole('group', { name: 'Slides' })).toBeNull();
    cleanup();
    renderControls(source({ kind: 'image' }));
    expect(screen.queryByRole('button', { name: 'Next slide' })).toBeNull();
    cleanup();
    const slides = source();
    renderControls(source({ kind: 'presentation', presentationSlides: slides.slideshowImages }));
    expect(screen.getByLabelText('Slide 1 of 3')).toHaveTextContent('1 / 3');
    expect(screen.getByRole('group', { name: 'Slides' })).toHaveAttribute('title', 'Sunday slides');
  });

  it('offers previous, next and reset for the current page', () => {
    const slides = source({ slideIndex: 1 });
    const onNavigate = renderControls(slides);
    fireEvent.click(screen.getByRole('button', { name: 'Previous slide' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset slides' }));
    expect(onNavigate.mock.calls).toEqual([['previous'], ['next'], ['reset']]);
    expect(screen.getByLabelText('Slide 2 of 3')).toHaveTextContent('2 / 3');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('disables backward/reset actions at the first page and forward actions at the last page', () => {
    renderControls(source());
    expect(screen.getByRole('button', { name: 'Previous slide' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset slides' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next slide' })).toBeEnabled();
    cleanup();
    renderControls(source({
      id: 'slides-last-page', slideIndex: 2,
      slideshowImages: ['last-a', 'last-b', 'last-c'].map((assetId) => ({ assetId, assetExtension: 'png', name: assetId })),
    }));
    expect(screen.getByRole('button', { name: 'Previous slide' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reset slides' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next slide' })).toBeDisabled();
  });

  it('disables all controls for empty slides or while working', () => {
    renderControls(source({ slideshowImages: [] }));
    expect(screen.getByLabelText('Slide 0 of 0')).toHaveTextContent('0 / 0');
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    cleanup();
    renderControls(source({ slideIndex: 1 }), true);
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  });

  it('allows Reset to stop automatic playback while still on the first page', () => {
    const onNavigate = renderControls(source({ slideshowAutoAdvance: true }));
    const reset = screen.getByRole('button', { name: 'Reset slides' });
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'off');
    expect(reset).toBeEnabled();
    fireEvent.click(reset);
    expect(onNavigate).toHaveBeenCalledWith('reset');
  });

  it('updates the counter from runtime cursor changes without rerendering the parent', () => {
    const slides = source({ slideIndex: 0 });
    const onNavigate = vi.fn((action) => navigateSlidePlayback(slides, action));
    render(<Toolbar label="Program controls"><SlideControls source={slides} onNavigate={onNavigate} /></Toolbar>);

    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));

    expect(screen.getByLabelText('Slide 2 of 3')).toHaveTextContent('2 / 3');
    expect(onNavigate).toHaveBeenCalledWith('next');
  });

  it('updates automatic counters only at slide boundaries and manual navigation pauses them', () => {
    vi.useFakeTimers();
    const slides = source({ slideIndex: 0, slideshowAutoAdvance: true, slideshowIntervalSeconds: 1 });
    const now = performance.now();
    setSlidePlaybackActive(slides, true, false, now);
    render(<Toolbar label="Program controls"><SlideControls source={slides} onNavigate={(action) => navigateSlidePlayback(slides, action)} /></Toolbar>);

    act(() => { vi.advanceTimersByTime(1_000); });

    expect(screen.getByLabelText('Slide 2 of 3')).toHaveTextContent('2 / 3');
    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(screen.getByLabelText('Slide 3 of 3')).toHaveTextContent('3 / 3');
    vi.useRealTimers();
  });
});
