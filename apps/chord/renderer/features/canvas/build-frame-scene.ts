// Pure builder: turns a ChordProject + a point in time into a fully resolved
// FrameScene — the single data shape both the live preview (ChordStage via
// preview-canvas.tsx) and the export encoder (../export/export-engine.ts)
// render from, so scrubbing and exporting never disagree about what a frame
// looks like. No Konva, no DOM, no store.
import type { RenderNode, SlideBackground } from '@lumacast/composition';
import { readVisualPayload } from '@lumacast/composition';
import { activeCueIndexAt, cueEndMs, cueSlideElement, resolveCueStyle, transitionStateAt } from '../../../shared/cue-model';
import type { ChordBackground, ChordProject } from '../../../shared/project';

export interface FrameCueTransition {
  opacity: number;
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface FrameCue {
  /** The originating `ChordCue.id` — distinct from `node.id`, which is `${cueId}-text` (see shared/cue-model.ts's `cueSlideElement`). */
  cueId: string;
  node: RenderNode;
  transition: FrameCueTransition;
}

export interface FrameScene {
  width: number;
  height: number;
  background: SlideBackground;
  /** 0–1 black overlay; always 0 for a color background (ChordBackground carries no dim there). */
  dim: number;
  /** 0–40 px blur radius; always 0 for a color background. */
  blur: number;
  cue: FrameCue | null;
}

export interface BuildFrameSceneOptions {
  /** `SlideElement.slideId` for the synthesized cue text element. Any stable string. */
  slideId: string;
  /** The background's resolved `lumachord://` (or proxy) URL; null when unresolved or the background is a color. */
  backgroundUrl: string | null;
}

// The cue text element is rebuilt fresh every frame and never persisted, so
// a fixed timestamp keeps `buildFrameScene` a pure function of its
// arguments — createdAt/updatedAt on this synthetic element aren't read by
// anything downstream.
const SYNTHETIC_ELEMENT_TIMESTAMP = '1970-01-01T00:00:00.000Z';

// shared/cue-model.ts's `transitionStateAt` authors slide offsets for a
// 1080px-tall frame (`SLIDE_OFFSET_PX = 40`); rescale them for the
// composition's actual height so a 4K or portrait export slides the same
// visual distance rather than the same pixel count.
const TRANSITION_REFERENCE_HEIGHT = 1080;

/** The whole timeline's end: the audio's length, else the last cue's own end (or its start, if held open). */
export function resolveTimelineEndMs(project: ChordProject): number {
  if (project.audio?.durationMs != null) return project.audio.durationMs;
  const { cues } = project;
  if (cues.length === 0) return 0;
  const last = cues[cues.length - 1];
  return last.endMs ?? last.startMs;
}

function resolveFrameBackground(background: ChordBackground, backgroundUrl: string | null): SlideBackground {
  if (background.kind === 'color') return { type: 'color', color: background.color };
  if (background.kind === 'image') {
    return { type: 'image', src: backgroundUrl ?? '', fit: background.fit, mediaAssetId: null };
  }
  return { type: 'video', src: backgroundUrl ?? '', fit: background.fit, mediaAssetId: null };
}

function buildFrameCue(project: ChordProject, timeMs: number, timelineEndMs: number, height: number, slideId: string): FrameCue | null {
  const { cues, theme } = project;
  const index = activeCueIndexAt(cues, timeMs, timelineEndMs);
  if (index === null) return null;
  const cue = cues[index];
  const resolved = resolveCueStyle(theme, cue);
  const endMs = cueEndMs(cues, index, timelineEndMs);
  const rawTransition = transitionStateAt(cue.startMs, endMs, timeMs, resolved.transition);
  if (!rawTransition) return null;

  const heightScale = height / TRANSITION_REFERENCE_HEIGHT;
  const element = cueSlideElement(cue, resolved.text, resolved.box, slideId, SYNTHETIC_ELEMENT_TIMESTAMP);
  const node: RenderNode = {
    id: element.id,
    element,
    visual: readVisualPayload('text', element.payload),
    isVideo: false,
    proxyMediaKey: null,
    bindingOverride: undefined,
  };

  return {
    cueId: cue.id,
    node,
    transition: {
      opacity: rawTransition.opacity,
      offsetX: rawTransition.offsetX * heightScale,
      offsetY: rawTransition.offsetY * heightScale,
      scale: rawTransition.scale,
    },
  };
}

export function buildFrameScene(project: ChordProject, timeMs: number, options: BuildFrameSceneOptions): FrameScene {
  const { width, height } = project.composition;
  const background = resolveFrameBackground(project.background, options.backgroundUrl);
  const dim = project.background.kind === 'color' ? 0 : project.background.dim;
  const blur = project.background.kind === 'color' ? 0 : project.background.blur;
  const timelineEndMs = resolveTimelineEndMs(project);
  const cue = buildFrameCue(project, timeMs, timelineEndMs, height, options.slideId);
  return { width, height, background, dim, blur, cue };
}
