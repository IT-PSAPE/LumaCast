// Execution for every `site: 'renderer'` action — the live-show and workbench
// verbs that exist only here and have no RPC method behind them.
//
// This is the agent's counterpart to `use-app-menu.ts`: one exhaustive switch
// over a canonical id, dispatching into the contexts the provider tree already
// exposes. It holds no state and mounts nothing; the hook owns the queue, the
// permissions, and the response, and hands this function a snapshot of the
// contexts it needs.
//
// Parameters arrive as `unknown` from a model, so every executor validates
// before touching a context. A validation failure throws
// `InvalidActionParamsError`, which the dispatcher answers as
// `denied: 'invalid-params'` — distinct from an action that ran and failed.
import type { Id } from '@lumacast/kernel';
import type { AlignEdge, AlignTarget, DistributeAxis, ItemRef, RichRunSpec, SlideElement } from '@lumacast/composition';
import { buildRichBodyFromRuns, readVisualPayload, richBodyFromPlainText } from '@lumacast/composition';
import type { PresentationLayerKey } from '@lumacast/playback';
import type { RendererActionId } from '@lumacast/protocol';
import { SlideRenderError, renderContactSheet, renderSlideToImage } from '../render/render-slide';
import type { useCast } from '../../contexts/app-context';
import type { useElements } from '../../contexts/canvas/canvas-context';
import type { useNavigation } from '../../contexts/navigation-context';
import type { usePlayback } from '../../contexts/playback/playback-context';
import type { usePlaybackSchedules } from '../../contexts/playback-schedules-context';
import type { useSlides } from '../../contexts/slide-context';
import type { useWorkbench } from '../../contexts/workbench-context';
import type { usePanelRoute } from '../../components/layout/panel-split/split-panel';
import type { useAutomation } from '../automation/automation-context';
import type { useCommandPalette } from '../command-palette/command-palette-context';
import type { useLyricEditor } from '../items/lyric-editor';
import type { useTimers } from '../../contexts/timers/timers-context';

/** Thrown by a parameter guard. The dispatcher maps it to `denied: 'invalid-params'`. */
export class InvalidActionParamsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidActionParamsError';
  }
}

/**
 * Every renderer context an executor may reach, captured once per render by
 * the dispatcher hook. Passing them in rather than calling hooks here keeps
 * this file a plain function — testable without a provider tree, and immune to
 * the hook-order rules an exhaustive switch would otherwise violate.
 */
export interface RendererActionContexts {
  cast: ReturnType<typeof useCast>;
  slides: ReturnType<typeof useSlides>;
  navigation: ReturnType<typeof useNavigation>;
  playback: ReturnType<typeof usePlayback>;
  schedules: ReturnType<typeof usePlaybackSchedules>;
  automation: ReturnType<typeof useAutomation>;
  workbench: ReturnType<typeof useWorkbench>;
  elements: ReturnType<typeof useElements>;
  panelRoute: ReturnType<typeof usePanelRoute>;
  commandPalette: ReturnType<typeof useCommandPalette>;
  lyricEditor: ReturnType<typeof useLyricEditor>;
  timers: ReturnType<typeof useTimers>;
  /** Commits the active editor's staged edits. Shared with the main-site path. */
  flushStagedEdits: () => Promise<void>;
}

// ─── Parameter guards ───────────────────────────────────────────────

function record(params: unknown): Record<string, unknown> {
  if (params === undefined || params === null) return {};
  if (typeof params !== 'object' || Array.isArray(params)) {
    throw new InvalidActionParamsError('params must be an object');
  }
  return params as Record<string, unknown>;
}

function requireId(params: Record<string, unknown>, field: string): Id {
  const value = params[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidActionParamsError(`${field} must be a non-empty id`);
  }
  return value as Id;
}

function optionalId(params: Record<string, unknown>, field: string): Id | null {
  const value = params[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidActionParamsError(`${field} must be a non-empty id`);
  }
  return value as Id;
}

function requireString(params: Record<string, unknown>, field: string): string {
  const value = params[field];
  if (typeof value !== 'string') throw new InvalidActionParamsError(`${field} must be a string`);
  return value;
}

function requireNumber(params: Record<string, unknown>, field: string): number {
  const value = params[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new InvalidActionParamsError(`${field} must be a finite number`);
  }
  return value;
}

function requireIndex(params: Record<string, unknown>, field: string): number {
  const value = requireNumber(params, field);
  if (!Number.isInteger(value) || value < 0) {
    throw new InvalidActionParamsError(`${field} must be a zero-based integer index`);
  }
  return value;
}

function optionalIndex(params: Record<string, unknown>, field: string): number | null {
  if (params[field] === undefined || params[field] === null) return null;
  return requireIndex(params, field);
}

function requireUnitInterval(params: Record<string, unknown>, field: string): number {
  const value = requireNumber(params, field);
  if (value < 0 || value > 1) throw new InvalidActionParamsError(`${field} must be between 0 and 1`);
  return value;
}

function requireSeconds(params: Record<string, unknown>, field: string): number {
  const value = requireNumber(params, field);
  if (value < 0) throw new InvalidActionParamsError(`${field} must not be negative`);
  return value;
}

function requireEnum<T extends string>(params: Record<string, unknown>, field: string, allowed: readonly T[]): T {
  const value = params[field];
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new InvalidActionParamsError(`${field} must be one of [${allowed.join(', ')}]`);
  }
  return value as T;
}

function requireIdArray(params: Record<string, unknown>, field: string): Id[] {
  const value = params[field];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    throw new InvalidActionParamsError(`${field} must be an array of ids`);
  }
  return value as Id[];
}

function requireItemRef(params: Record<string, unknown>, field: string): ItemRef {
  const value = params[field];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidActionParamsError(`${field} must be an item reference`);
  }
  const { type, id } = value as { type?: unknown; id?: unknown };
  if ((type !== 'presentation' && type !== 'lyric') || typeof id !== 'string' || id.length === 0) {
    throw new InvalidActionParamsError(`${field} must be an item reference`);
  }
  return { type, id: id as Id };
}

function optionalString(params: Record<string, unknown>, field: string): string | undefined {
  const value = params[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new InvalidActionParamsError(`${field} must be a string`);
  return value;
}

function optionalNumber(params: Record<string, unknown>, field: string): number | undefined {
  if (params[field] === undefined || params[field] === null) return undefined;
  return requireNumber(params, field);
}

function optionalEnum<T extends string>(params: Record<string, unknown>, field: string, allowed: readonly T[]): T | undefined {
  if (params[field] === undefined || params[field] === null) return undefined;
  return requireEnum(params, field, allowed);
}

/** Validates each entry against `richRunSchema` (`action-schemas.ts`): a `text` string plus whichever optional style fields are present. */
function requireRichRuns(params: Record<string, unknown>, field: string): RichRunSpec[] {
  const value = params[field];
  if (!Array.isArray(value)) throw new InvalidActionParamsError(`${field} must be an array of runs`);
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new InvalidActionParamsError(`${field}[${index}] must be an object`);
    }
    const run = entry as Record<string, unknown>;
    if (typeof run.text !== 'string') throw new InvalidActionParamsError(`${field}[${index}].text must be a string`);
    const spec: RichRunSpec = { text: run.text };
    if (typeof run.color === 'string') spec.color = run.color;
    if (typeof run.weight === 'number') spec.weight = run.weight;
    if (typeof run.italic === 'boolean') spec.italic = run.italic;
    if (typeof run.underline === 'boolean') spec.underline = run.underline;
    if (typeof run.strikethrough === 'boolean') spec.strikethrough = run.strikethrough;
    if (typeof run.fontSize === 'number') spec.fontSize = run.fontSize;
    return spec;
  });
}

/** Turns a `SlideRenderError` into a message clear enough to hand back as the action's `failed` error. */
function describeSlideRenderError(error: unknown): string {
  if (!(error instanceof SlideRenderError)) return error instanceof Error ? error.message : String(error);
  if (error.code === 'not-mounted') return 'Slide rendering is unavailable: no render surface is mounted.';
  return error.message;
}

// ─── Shared resolution ──────────────────────────────────────────────

const WORKBENCH_MODES = ['show', 'item-editor', 'overlay-editor', 'theme-editor', 'stage-editor', 'macro-editor', 'settings'] as const;

/** Resolves a `{ slideId?, index? }` addressing pair against the loaded item. */
function resolveSlideIndex(contexts: RendererActionContexts, params: Record<string, unknown>): number {
  const { slides } = contexts;
  const slideId = optionalId(params, 'slideId');
  if (slideId) {
    const index = slides.slides.findIndex((slide) => slide.id === slideId);
    if (index === -1) throw new InvalidActionParamsError(`slideId ${slideId} is not in the loaded item`);
    return index;
  }
  const index = optionalIndex(params, 'index');
  if (index === null) throw new InvalidActionParamsError('one of slideId or index is required');
  if (index >= slides.slides.length) {
    throw new InvalidActionParamsError(`index ${index} is out of range (${slides.slides.length} slides)`);
  }
  return index;
}

function describeSlideAt(contexts: RendererActionContexts, index: number): { slideId: Id | null; index: number } {
  return { slideId: contexts.slides.slides[index]?.id ?? null, index };
}

function findElement(contexts: RendererActionContexts, elementId: Id): SlideElement {
  const target = contexts.elements.effectiveElements.find((element) => element.id === elementId);
  if (!target) throw new InvalidActionParamsError(`elementId ${elementId} is not on the current surface`);
  return target;
}

/**
 * Recomputes the whole back-to-front paint order for a z-order move. Mirrors
 * the canvas context menu's ordering (`features/canvas/scene-stage.tsx`):
 * `reorderElements` takes the complete list, so a move is expressed as a
 * rearrangement of every id rather than one element's new index.
 */
async function applyElementOrder(
  contexts: RendererActionContexts,
  kind: 'front' | 'forward' | 'backward' | 'back',
  params: Record<string, unknown>,
): Promise<{ moved: Id[] }> {
  const { elements } = contexts;
  const ids = elements.effectiveElements.map((element) => element.id);
  const explicitId = optionalId(params, 'elementId');
  if (explicitId) findElement(contexts, explicitId);
  const targetIds = explicitId ? [explicitId] : elements.selectedElementIds.filter((id) => ids.includes(id));
  const selected = new Set(targetIds);
  if (selected.size === 0) throw new InvalidActionParamsError('no elements selected to reorder');

  let next = ids.slice();
  if (kind === 'front') {
    next = [...ids.filter((id) => !selected.has(id)), ...ids.filter((id) => selected.has(id))];
  } else if (kind === 'back') {
    next = [...ids.filter((id) => selected.has(id)), ...ids.filter((id) => !selected.has(id))];
  } else if (kind === 'forward') {
    for (let index = next.length - 2; index >= 0; index -= 1) {
      if (selected.has(next[index]) && !selected.has(next[index + 1])) {
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
      }
    }
  } else {
    for (let index = 1; index < next.length; index += 1) {
      if (selected.has(next[index]) && !selected.has(next[index - 1])) {
        [next[index], next[index - 1]] = [next[index - 1], next[index]];
      }
    }
  }

  await elements.reorderElements(next);
  return { moved: [...selected] };
}

function clearLayer(contexts: RendererActionContexts, layer: PresentationLayerKey): { cleared: PresentationLayerKey } {
  contexts.playback.layers.clearLayer(layer);
  return { cleared: layer };
}

// ─── Executor ───────────────────────────────────────────────────────

/**
 * Runs one renderer-site action and returns a small, model-readable result.
 * Results are deliberately terse — an id and an index, not a serialized slide —
 * because the whole point of the read RPCs is that an agent asks for state
 * explicitly rather than having every mutation echo it back.
 */
export async function executeRendererAction(
  actionId: RendererActionId,
  rawParams: unknown,
  contexts: RendererActionContexts,
): Promise<unknown> {
  const params = record(rawParams);
  const { cast, slides, navigation, playback, schedules, automation, workbench, elements, panelRoute } = contexts;
  const { layers, audio, video, stage } = playback;

  switch (actionId) {
    // --- Take / navigation ---
    case 'slide.take': {
      if (!slides.currentSlide) throw new InvalidActionParamsError('no slide is selected to take');
      slides.takeSlide();
      return { slideId: slides.currentSlide.id, index: slides.currentSlideIndex };
    }
    case 'slide.activate':
    case 'slide.jumpTo': {
      const index = actionId === 'slide.jumpTo' ? requireIndex(params, 'index') : resolveSlideIndex(contexts, params);
      if (index >= slides.slides.length) {
        throw new InvalidActionParamsError(`index ${index} is out of range (${slides.slides.length} slides)`);
      }
      slides.activateSlide(index);
      return describeSlideAt(contexts, index);
    }
    case 'slide.next': {
      slides.goNext();
      return { index: Math.min(slides.currentSlideIndex + 1, slides.slides.length - 1) };
    }
    case 'slide.previous': {
      slides.goPrev();
      return { index: Math.max(slides.currentSlideIndex - 1, 0) };
    }
    case 'slide.select': {
      const index = resolveSlideIndex(contexts, params);
      slides.setCurrentSlideIndex(index);
      return describeSlideAt(contexts, index);
    }
    case 'slide.selectRange': {
      // Validated so a malformed call still reports the right failure, then
      // refused: range selection is component-local state inside each slide
      // browser (`hooks/use-slide-range-selection.ts`), not shared context, so
      // there is nothing here to drive. Faking it by moving the current slide
      // would silently do the wrong thing.
      requireIndex(params, 'fromIndex');
      requireIndex(params, 'toIndex');
      throw new Error('Slide range selection is local to each slide browser and is not agent-addressable.');
    }
    case 'slide.render': {
      const slideId = requireId(params, 'slideId');
      const width = optionalNumber(params, 'width');
      const height = optionalNumber(params, 'height');
      const format = optionalEnum(params, 'format', ['png', 'jpeg'] as const);
      try {
        return await renderSlideToImage(slideId, { width, height, format });
      } catch (error) {
        throw new Error(describeSlideRenderError(error));
      }
    }
    case 'slide.renderContactSheet': {
      const slideIds = requireIdArray(params, 'slideIds');
      const columns = optionalNumber(params, 'columns');
      const thumbnailWidth = optionalNumber(params, 'thumbnailWidth');
      try {
        return await renderContactSheet(slideIds, { columns, thumbnailWidth });
      } catch (error) {
        throw new Error(describeSlideRenderError(error));
      }
    }

    // --- Layers ---
    case 'overlay.activate': {
      const overlayId = requireId(params, 'overlayId');
      layers.activateOverlay(overlayId);
      return { overlayId };
    }
    case 'overlay.clear': {
      const overlayId = requireId(params, 'overlayId');
      layers.clearOverlay(overlayId);
      return { overlayId };
    }
    case 'overlay.clearAll': {
      layers.clearAllOverlays();
      return { cleared: 'overlays' };
    }
    case 'overlay.setMode': {
      const mode = requireEnum(params, 'mode', ['single', 'multiple'] as const);
      layers.setOverlayMode(mode);
      return { mode };
    }
    case 'mediaLayer.set': {
      const assetId = requireId(params, 'assetId');
      layers.setMediaLayerAsset(assetId);
      return { assetId };
    }
    case 'mediaLayer.clear':
      return clearLayer(contexts, 'media');
    case 'layer.clearContent':
      return clearLayer(contexts, 'content');
    case 'layer.clearAll': {
      layers.clearAllLayers();
      return { cleared: 'all' };
    }

    // --- Video transport ---
    case 'video.arm': {
      const assetId = requireId(params, 'assetId');
      video.armVideo(assetId);
      return { assetId };
    }
    case 'video.clear': {
      video.clearVideo();
      return { assetId: null };
    }
    case 'video.play': {
      video.play();
      return { playing: true };
    }
    case 'video.pause': {
      video.pause();
      return { playing: false };
    }
    case 'video.seek': {
      const seconds = requireSeconds(params, 'seconds');
      video.seekTo(seconds);
      return { seconds };
    }
    case 'video.setVolume': {
      const volume = requireUnitInterval(params, 'volume');
      video.setVolume(volume);
      return { volume };
    }
    case 'video.toggleMute': {
      video.toggleMuted();
      return { muted: !video.muted };
    }
    case 'video.toggleLoop': {
      video.toggleLoop();
      return { loopEnabled: !video.loopEnabled };
    }
    case 'video.next': {
      video.playNext();
      return { moved: 'next' };
    }
    case 'video.previous': {
      video.playPrevious();
      return { moved: 'previous' };
    }

    // --- Audio transport ---
    case 'audio.arm': {
      const assetId = requireId(params, 'assetId');
      audio.armAudio(assetId);
      return { assetId };
    }
    case 'audio.clear': {
      audio.clearAudio();
      return { assetId: null };
    }
    case 'audio.play': {
      audio.play();
      return { playing: true };
    }
    case 'audio.pause': {
      audio.pause();
      return { playing: false };
    }
    case 'audio.seek': {
      const seconds = requireSeconds(params, 'seconds');
      audio.seekTo(seconds);
      return { seconds };
    }
    case 'audio.setVolume': {
      const volume = requireUnitInterval(params, 'volume');
      audio.setVolume(volume);
      return { volume };
    }
    case 'audio.toggleMute': {
      audio.toggleMuted();
      return { muted: !audio.muted };
    }
    case 'audio.toggleLoop': {
      audio.toggleLoop();
      return { loopEnabled: !audio.loopEnabled };
    }
    case 'audio.next': {
      audio.playNext();
      return { moved: 'next' };
    }
    case 'audio.previous': {
      audio.playPrevious();
      return { moved: 'previous' };
    }
    case 'audioSync.resume': {
      schedules.resumeSync();
      return { suspended: false };
    }

    // --- Stage ---
    case 'stage.arm': {
      const stageId = requireId(params, 'stageId');
      stage.setCurrentStageId(stageId);
      return { stageId };
    }
    case 'stage.clear': {
      stage.setCurrentStageId(null);
      return { stageId: null };
    }

    // --- Timers (ADR-0042) ---
    case 'timer.start': {
      const timerId = requireId(params, 'timerId');
      contexts.timers.start(timerId);
      return { timerId };
    }
    case 'timer.stop': {
      const timerId = requireId(params, 'timerId');
      contexts.timers.pause(timerId);
      return { timerId };
    }
    case 'timer.reset': {
      const timerId = requireId(params, 'timerId');
      contexts.timers.reset(timerId);
      return { timerId };
    }
    case 'timer.resetAll': {
      contexts.timers.resetAll();
      return { reset: 'all' };
    }

    // --- Automation execution ---
    case 'macro.run': {
      const macroId = requireId(params, 'macroId');
      await automation.actions.runMacro(macroId);
      return { macroId };
    }
    case 'macro.cancelAll': {
      automation.actions.cancelActiveMacros();
      return { cancelled: true };
    }
    case 'cue.run': {
      const cueId = requireId(params, 'cueId');
      await automation.actions.runCue(cueId);
      return { cueId };
    }

    // --- Workbench ---
    case 'workbench.setMode': {
      const mode = requireEnum(params, 'mode', WORKBENCH_MODES);
      workbench.actions.setWorkbenchMode(mode);
      return { mode };
    }
    case 'workbench.openSettings': {
      workbench.actions.setWorkbenchMode('settings');
      return { mode: 'settings' };
    }
    case 'workbench.togglePanel': {
      const splitId = requireString(params, 'splitId');
      const paneId = requireString(params, 'paneId');
      panelRoute.actions.togglePanel(splitId, paneId);
      return { splitId, paneId, visible: panelRoute.meta.isPanelVisible(splitId, paneId) };
    }
    case 'workbench.setSlideBrowserMode': {
      const mode = requireEnum(params, 'mode', ['grid', 'list'] as const);
      workbench.actions.setSlideBrowserMode(mode);
      return { mode };
    }
    case 'workbench.setProgramMode': {
      const mode = requireEnum(params, 'mode', ['single', 'all'] as const);
      workbench.actions.setProgramMode(mode);
      return { mode };
    }
    case 'commandPalette.open': {
      contexts.commandPalette.open();
      return { open: true };
    }
    case 'lyricEditor.open': {
      if (!navigation.currentItemRef) throw new InvalidActionParamsError('no item is open to edit');
      contexts.lyricEditor.open();
      return { itemRef: navigation.currentItemRef };
    }
    case 'editor.saveChanges': {
      await contexts.flushStagedEdits();
      return { saved: true };
    }

    // --- Navigation / selection ---
    case 'navigation.selectPlaylist': {
      const playlistId = requireId(params, 'playlistId');
      navigation.setCurrentPlaylistId(playlistId);
      return { playlistId };
    }
    case 'navigation.selectPlaylistEntry': {
      const entryId = requireId(params, 'entryId');
      slides.selectPlaylistEntry(entryId);
      return { entryId };
    }
    case 'navigation.browseItem': {
      const ref = requireItemRef(params, 'ref');
      navigation.browseItem(ref);
      return { ref };
    }

    // --- Element editing ---
    case 'element.select': {
      const elementId = requireId(params, 'elementId');
      findElement(contexts, elementId);
      elements.selectElement(elementId);
      return { elementId };
    }
    case 'element.selectMany': {
      const elementIds = requireIdArray(params, 'elementIds');
      elements.selectElements(elementIds);
      return { elementIds };
    }
    case 'element.clearSelection': {
      elements.clearSelection();
      return { elementIds: [] };
    }
    case 'element.copy': {
      elements.copySelection();
      return { elementIds: elements.selectedElementIds };
    }
    case 'element.cut': {
      await elements.cutSelection();
      return { elementIds: elements.selectedElementIds };
    }
    case 'element.paste': {
      await elements.pasteSelection();
      return { pasted: true };
    }
    case 'element.duplicateSelection': {
      await elements.duplicateSelection();
      return { duplicated: elements.selectedElementIds.length };
    }
    case 'element.nudge': {
      const dx = requireNumber(params, 'dx');
      const dy = requireNumber(params, 'dy');
      if (elements.selectedElementIds.length === 0) {
        throw new InvalidActionParamsError('no elements selected to nudge');
      }
      await elements.nudgeSelection(dx, dy);
      return { dx, dy, elementIds: elements.selectedElementIds };
    }
    case 'element.bringToFront':
      return applyElementOrder(contexts, 'front', params);
    case 'element.sendToBack':
      return applyElementOrder(contexts, 'back', params);
    case 'element.bringForward':
      return applyElementOrder(contexts, 'forward', params);
    case 'element.sendBackward':
      return applyElementOrder(contexts, 'backward', params);
    case 'element.toggleVisibility': {
      const elementId = requireId(params, 'elementId');
      const target = findElement(contexts, elementId);
      const visible = !readVisualPayload(target.type, target.payload).visible;
      await elements.toggleElementVisibility(elementId, visible);
      return { elementId, visible };
    }
    case 'element.toggleLock': {
      const elementId = requireId(params, 'elementId');
      const target = findElement(contexts, elementId);
      const locked = !readVisualPayload(target.type, target.payload).locked;
      await elements.toggleElementLock(elementId, locked);
      return { elementId, locked };
    }
    case 'element.rename': {
      const elementId = requireId(params, 'elementId');
      const name = requireString(params, 'name');
      findElement(contexts, elementId);
      await elements.renameElement(elementId, name);
      return { elementId, name };
    }
    case 'element.group': {
      const elementIds = requireIdArray(params, 'elementIds');
      const name = optionalString(params, 'name');
      const groupId = await elements.groupSelection(elementIds, name);
      if (!groupId) throw new Error('Grouping requires at least two unlocked, ungrouped elements from the same slide.');
      return { groupId };
    }
    case 'element.ungroup': {
      const groupId = requireId(params, 'groupId');
      const elementIds = await elements.ungroupSelection(groupId);
      if (elementIds.length === 0) throw new Error(`${groupId} is not an unlocked group element.`);
      return { elementIds };
    }
    case 'element.align': {
      const elementIds = requireIdArray(params, 'elementIds');
      const edge = requireEnum(params, 'edge', ['left', 'centerX', 'right', 'top', 'centerY', 'bottom'] as const);
      const to = optionalEnum(params, 'to', ['selection', 'slide'] as const) ?? (elementIds.length > 1 ? 'selection' : 'slide');
      await elements.alignSelection(edge as AlignEdge, to as AlignTarget, elementIds);
      return { elementIds, edge, to };
    }
    case 'element.distribute': {
      const elementIds = requireIdArray(params, 'elementIds');
      const axis = requireEnum(params, 'axis', ['horizontal', 'vertical'] as const);
      await elements.distributeSelection(axis as DistributeAxis, elementIds);
      return { elementIds, axis };
    }
    case 'element.setRichText': {
      const elementId = requireId(params, 'elementId');
      const hasText = typeof params.text === 'string';
      const hasRuns = params.runs !== undefined;
      if (hasText === hasRuns) {
        throw new InvalidActionParamsError('exactly one of text or runs is required');
      }
      findElement(contexts, elementId);
      const body = hasText ? richBodyFromPlainText(params.text as string) : buildRichBodyFromRuns(requireRichRuns(params, 'runs'));
      await elements.setElementRichText(elementId, body);
      return { elementId };
    }

    // --- History ---
    case 'edit.undo': {
      await cast.undo();
      return { canUndo: cast.canUndo };
    }
    case 'edit.redo': {
      await cast.redo();
      return { canRedo: cast.canRedo };
    }
  }
}
