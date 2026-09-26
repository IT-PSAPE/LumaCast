import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../../../../../../apps/chord/shared/project-schema';
import type { ChordCue, ChordProject } from '../../../../../../apps/chord/shared/project';
import { buildFrameScene, resolveTimelineEndMs } from '../../../../../../apps/chord/renderer/features/canvas/build-frame-scene';

const NOW = '2026-01-01T00:00:00.000Z';

function cue(overrides: Partial<ChordCue> = {}): ChordCue {
  return {
    id: 'cue-1',
    startMs: 1000,
    endMs: 2000,
    text: 'Hello world',
    override: null,
    ...overrides,
  };
}

function projectWith(overrides: Partial<ChordProject> = {}): ChordProject {
  return { ...createEmptyProject(NOW, 'project-1'), ...overrides };
}

describe('buildFrameScene', () => {
  it('has no active cue outside every cue\'s range', () => {
    const project = projectWith({ cues: [cue()] });
    const scene = buildFrameScene(project, 500, { slideId: 'slide-1', backgroundUrl: null });
    expect(scene.cue).toBeNull();
  });

  it('resolves the active cue into a text RenderNode from the linked theme', () => {
    const project = projectWith({ cues: [cue()] });
    const scene = buildFrameScene(project, 1500, { slideId: 'slide-1', backgroundUrl: null });
    expect(scene.cue).not.toBeNull();
    expect(scene.cue!.cueId).toBe('cue-1');
    expect(scene.cue!.node.id).toBe('cue-1-text');
    expect(scene.cue!.node.element.type).toBe('text');
    expect((scene.cue!.node.element.payload as { text: string }).text).toBe('Hello world');
    expect(scene.cue!.transition.opacity).toBeGreaterThanOrEqual(0);
    expect(scene.cue!.transition.opacity).toBeLessThanOrEqual(1);
  });

  it('builds a color background with zero dim/blur', () => {
    const project = projectWith({ cues: [] });
    const scene = buildFrameScene(project, 0, { slideId: 'slide-1', backgroundUrl: null });
    expect(scene.background).toEqual({ type: 'color', color: '#000000' });
    expect(scene.dim).toBe(0);
    expect(scene.blur).toBe(0);
  });

  it('builds an image background from the resolved URL, fit, dim, and blur', () => {
    const project = projectWith({
      cues: [],
      background: {
        kind: 'image',
        media: { path: '/bg.jpg', name: 'bg.jpg', durationMs: null },
        fit: 'cover',
        dim: 0.3,
        blur: 10,
        loop: false,
      },
    });
    const scene = buildFrameScene(project, 0, { slideId: 'slide-1', backgroundUrl: 'lumachord://file/bg.jpg' });
    expect(scene.background).toEqual({ type: 'image', src: 'lumachord://file/bg.jpg', fit: 'cover', mediaAssetId: null });
    expect(scene.dim).toBe(0.3);
    expect(scene.blur).toBe(10);
  });

  it('builds a video background the same way, keyed off the video kind', () => {
    const project = projectWith({
      cues: [],
      background: {
        kind: 'video',
        media: { path: '/bg.mp4', name: 'bg.mp4', durationMs: 5000 },
        fit: 'contain',
        dim: 0,
        blur: 0,
        loop: true,
      },
    });
    const scene = buildFrameScene(project, 0, { slideId: 'slide-1', backgroundUrl: 'lumachord://file/bg.mp4' });
    expect(scene.background).toEqual({ type: 'video', src: 'lumachord://file/bg.mp4', fit: 'contain', mediaAssetId: null });
  });

  it('falls back to an empty src when the background URL has not resolved yet', () => {
    const project = projectWith({
      cues: [],
      background: { kind: 'image', media: { path: '/bg.jpg', name: 'bg.jpg', durationMs: null }, fit: 'cover', dim: 0, blur: 0, loop: false },
    });
    const scene = buildFrameScene(project, 0, { slideId: 'slide-1', backgroundUrl: null });
    expect(scene.background).toEqual({ type: 'image', src: '', fit: 'cover', mediaAssetId: null });
  });

  it('scales slide-up transition offsets with composition height relative to the 1080 reference', () => {
    const theme = createEmptyProject(NOW, 'p').theme;
    const themed = { ...theme, transition: { in: 'slide-up' as const, out: 'none' as const, durationMs: 400 } };
    const testCue = cue({ startMs: 0, endMs: 2000 });

    const at1080 = buildFrameScene(
      projectWith({ cues: [testCue], theme: themed, composition: { width: 1920, height: 1080, fps: 30 } }),
      100,
      { slideId: 'slide-1', backgroundUrl: null },
    );
    const at2160 = buildFrameScene(
      projectWith({ cues: [testCue], theme: themed, composition: { width: 3840, height: 2160, fps: 30 } }),
      100,
      { slideId: 'slide-1', backgroundUrl: null },
    );

    expect(at1080.cue!.transition.offsetY).not.toBe(0);
    expect(at2160.cue!.transition.offsetY).toBeCloseTo(at1080.cue!.transition.offsetY * 2, 5);
  });

  it('applies a detached cue override on top of the theme box', () => {
    const theme = createEmptyProject(NOW, 'p').theme;
    const overriddenCue = cue({ override: { box: { x: 999 } } });
    const project = projectWith({ cues: [overriddenCue], theme });
    const scene = buildFrameScene(project, 1500, { slideId: 'slide-1', backgroundUrl: null });
    expect(scene.cue!.node.element.x).toBe(999);
  });
});

describe('resolveTimelineEndMs', () => {
  it('uses the audio duration when present', () => {
    const project = projectWith({
      audio: { path: '/song.mp3', name: 'song.mp3', durationMs: 90_000 },
      cues: [cue({ startMs: 0, endMs: null })],
    });
    expect(resolveTimelineEndMs(project)).toBe(90_000);
  });

  it('falls back to the last cue\'s explicit end when there is no audio', () => {
    const project = projectWith({ audio: null, cues: [cue({ startMs: 0, endMs: 3000 })] });
    expect(resolveTimelineEndMs(project)).toBe(3000);
  });

  it('falls back to the last cue\'s own start when it has no end and there is no audio', () => {
    const project = projectWith({ audio: null, cues: [cue({ startMs: 500, endMs: null })] });
    expect(resolveTimelineEndMs(project)).toBe(500);
  });

  it('is 0 for an empty project', () => {
    const project = projectWith({ audio: null, cues: [] });
    expect(resolveTimelineEndMs(project)).toBe(0);
  });
});
