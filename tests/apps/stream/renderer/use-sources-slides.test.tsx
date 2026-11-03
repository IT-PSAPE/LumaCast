import { useRef, useState } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSources, type UseSourcesParams } from '../../../../apps/stream/renderer/features/sources/use-sources';
import { flattenSourceNodes } from '../../../../apps/stream/shared/source-tree';
import { createDefaultProject, type ImportedPresentation, type MediaAsset, type SlideshowImage, type StreamAPI, type StreamProject, type StreamSource } from '../../../../apps/stream/shared/desktop-api';

afterEach(cleanup);

function imageAsset(index: number): MediaAsset {
  return { id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, kind: 'image', extension: 'png', name: `Image ${index}` };
}

function slide(index: number): SlideshowImage {
  const asset = imageAsset(index);
  return { assetId: asset.id, assetExtension: asset.extension, name: asset.name };
}

function slideshow(overrides: Partial<StreamSource> = {}): StreamSource {
  return {
    id: 'slideshow', name: 'Welcome', kind: 'slideshow', visible: true, muted: false, volume: 1,
    transform: { x: 0, y: 0, width: 1920, height: 1080 },
    slideshowImages: [slide(1)], slideshowAutoAdvance: false, slideIndex: 0,
    ...overrides,
  };
}

function setup(sources: StreamSource[] = []) {
  const api = {
    importMedia: vi.fn<StreamAPI['importMedia']>(),
    importSlideshowImages: vi.fn<StreamAPI['importSlideshowImages']>().mockResolvedValue([]),
    importPresentation: vi.fn<StreamAPI['importPresentation']>().mockResolvedValue(null),
  };
  const setActionError = vi.fn();
  const { result } = renderHook(() => {
    const [project, setProject] = useState<StreamProject>(() => {
      const initial = createDefaultProject();
      initial.scenes[0]!.sources = sources;
      return initial;
    });
    const [working, setWorking] = useState(false);
    const projectRef = useRef<StreamProject | null>(project);
    projectRef.current = project;
    const scene = project.scenes[0]!;
    const state = useSources({
      api: api as unknown as StreamAPI,
      project,
      projectRef,
      allSources: flattenSourceNodes(scene.sources),
      activeScene: scene,
      liveScene: scene,
      setProjectValue: (update) => setProject(update),
      setActionError,
      working,
      setWorking,
      videoElements: useRef(new Map()),
      imageElements: useRef(new Map()),
      mediaElements: useRef(new Map()),
      runtimes: useRef(new Map()),
      mixer: useRef(null),
      applicationAudioInputs: useRef(new Map()),
      applicationAudioSessions: useRef(new Map()),
      attachRuntime: vi.fn(),
      stopRuntime: vi.fn(),
      startApplicationAudioRuntime: vi.fn(),
      startSystemAudioRuntime: vi.fn(),
      clearNoiseSuppressionPreference: vi.fn(),
    } satisfies UseSourcesParams);
    return { state, project, working };
  });
  return { result, api, setActionError };
}

describe('useSources slide imports', () => {
  it('creates one selected slideshow containing every chosen image in order', async () => {
    const { result, api } = setup();
    api.importSlideshowImages.mockResolvedValue([imageAsset(3), imageAsset(1), imageAsset(2)]);
    act(() => result.current.state.setSourceMenuOpen(true));

    await act(async () => { await result.current.state.addSlideshow(); });

    const source = result.current.project.scenes[0]!.sources[0]!;
    expect(result.current.project.scenes[0]!.sources).toHaveLength(1);
    expect(source).toMatchObject({ kind: 'slideshow', slideshowImages: [slide(3), slide(1), slide(2)], slideshowIntervalSeconds: 5, slideshowLoop: true });
    expect(result.current.state.selectedSourceId).toBe(source.id);
    expect(result.current.state.sourceMenuOpen).toBe(false);
    expect(result.current.working).toBe(false);
    expect(api.importSlideshowImages).toHaveBeenCalledWith(100);
    expect(api.importMedia).not.toHaveBeenCalled();
  });

  it('appends every selected image after existing slides using the remaining capacity', async () => {
    const { result, api } = setup([slideshow()]);
    api.importSlideshowImages.mockResolvedValue([imageAsset(3), imageAsset(2)]);

    await act(async () => { await result.current.state.addSlideshowImage('slideshow'); });

    expect(api.importSlideshowImages).toHaveBeenCalledWith(99);
    expect(result.current.project.scenes[0]!.sources[0]).toMatchObject({ slideshowImages: [slide(1), slide(3), slide(2)], slideIndex: 0, slideshowAutoAdvance: false });
    expect(result.current.working).toBe(false);
    expect(api.importMedia).not.toHaveBeenCalled();
  });

  it('does not open the image picker when the slideshow is already full', async () => {
    const full = slideshow({ slideshowImages: Array.from({ length: 100 }, (_, index) => slide(index + 1)) });
    const { result, api } = setup([full]);
    await act(async () => { await result.current.state.addSlideshowImage('slideshow'); });
    expect(api.importSlideshowImages).not.toHaveBeenCalled();
    expect(result.current.project.scenes[0]!.sources[0]!.slideshowImages).toHaveLength(100);
    expect(result.current.working).toBe(false);
  });

  it('leaves the project unchanged when slideshow creation or appending is canceled', async () => {
    const { result } = setup([slideshow()]);
    await act(async () => { await result.current.state.addSlideshow(); });
    await act(async () => { await result.current.state.addSlideshowImage('slideshow'); });
    expect(result.current.project.scenes[0]!.sources).toEqual([slideshow()]);
    expect(result.current.state.selectedSourceId).toBeNull();
    expect(result.current.working).toBe(false);
  });

  it.each(['create', 'append'] as const)('reports a slideshow %s error and releases the working state', async (operation) => {
    const { result, api, setActionError } = setup([slideshow()]);
    api.importSlideshowImages.mockRejectedValue(new Error('Image import failed'));
    await act(async () => {
      if (operation === 'create') await result.current.state.addSlideshow();
      else await result.current.state.addSlideshowImage('slideshow');
    });
    expect(setActionError).toHaveBeenLastCalledWith('Could not import slideshow images: Image import failed');
    expect(result.current.project.scenes[0]!.sources).toEqual([slideshow()]);
    expect(result.current.working).toBe(false);
  });

  it('holds the working state while importing and blocks a competing import', async () => {
    const { result, api } = setup();
    let finish!: (assets: MediaAsset[]) => void;
    api.importSlideshowImages.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    let pending!: Promise<void>;
    act(() => { pending = result.current.state.addSlideshow(); });
    expect(result.current.working).toBe(true);
    await act(async () => { await result.current.state.addPresentation(); });
    expect(api.importPresentation).not.toHaveBeenCalled();
    await act(async () => { finish([imageAsset(1), imageAsset(2)]); await pending; });
    expect(result.current.working).toBe(false);
    expect(result.current.project.scenes[0]!.sources[0]!.slideshowImages).toHaveLength(2);
  });

  it('creates a selected presentation with all pages in order at its first slide', async () => {
    const { result, api } = setup();
    const imported: ImportedPresentation = { name: 'Sunday presentation', slides: [slide(2), slide(1)] };
    api.importPresentation.mockResolvedValue(imported);
    await act(async () => { await result.current.state.addPresentation(); });
    const source = result.current.project.scenes[0]!.sources[0]!;
    expect(source).toMatchObject({ kind: 'presentation', name: imported.name, presentationSlides: imported.slides, slideIndex: 0 });
    expect(result.current.state.selectedSourceId).toBe(source.id);
    expect(result.current.working).toBe(false);
  });

  it('leaves the project unchanged when presentation import is canceled', async () => {
    const { result } = setup();
    await act(async () => { await result.current.state.addPresentation(); });
    expect(result.current.project.scenes[0]!.sources).toEqual([]);
    expect(result.current.working).toBe(false);
  });

  it('reports a presentation import error and releases the working state', async () => {
    const { result, api, setActionError } = setup();
    api.importPresentation.mockRejectedValue(new Error('Unsupported presentation'));
    await act(async () => { await result.current.state.addPresentation(); });
    expect(setActionError).toHaveBeenLastCalledWith('Could not import presentation: Unsupported presentation');
    expect(result.current.project.scenes[0]!.sources).toEqual([]);
    expect(result.current.working).toBe(false);
  });

  it('keeps the current manual image selected when images are reordered or earlier images removed', () => {
    const { result } = setup([slideshow({ slideshowImages: [slide(1), slide(2), slide(3)], slideIndex: 1 })]);
    act(() => result.current.state.moveSlideshowImage('slideshow', 1, 1));
    expect(result.current.project.scenes[0]!.sources[0]).toMatchObject({ slideshowImages: [slide(1), slide(3), slide(2)], slideIndex: 2 });
    act(() => result.current.state.removeSlideshowImage('slideshow', 0));
    expect(result.current.project.scenes[0]!.sources[0]).toMatchObject({ slideshowImages: [slide(3), slide(2)], slideIndex: 1 });
    act(() => result.current.state.removeSlideshowImage('slideshow', 1));
    expect(result.current.project.scenes[0]!.sources[0]).toMatchObject({ slideshowImages: [slide(3)], slideIndex: 0 });
    act(() => result.current.state.removeSlideshowImage('slideshow', 0));
    expect(result.current.project.scenes[0]!.sources[0]!.slideshowImages).toEqual([slide(3)]);
  });
});
