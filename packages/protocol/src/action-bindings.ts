// How each canonical `ActionId` is actually executed.
//
// `ACTION_RPC_BINDINGS` covers every `site: 'main'` action: which RPC method
// it calls and, for positional methods, which fields of the action's parameter
// object supply which argument. `RendererActionParams` covers every
// `site: 'renderer'` action: the parameter object the dispatcher's executor
// expects. Together they are the complete execution map — the compile-time
// assertion at the bottom of this file fails the build the moment an
// `ActionId` is added without one.
//
// This file stays declarative on purpose. It names methods and fields; it
// never calls anything and never imports renderer code (protocol may not).
// The three actions that read the filesystem (`media.import`,
// `media.replaceSource`, `document.extractText`) bind to their own `agent*`
// RPCs, which take a raw path: main authorizes it against the user's granted
// roots and does the media-type sniffing itself, so no renderer-side argument
// preparation is involved.
import type { Id } from '@lumacast/kernel';
import type { ItemRef, RichRun } from '@lumacast/composition';
import type { ActionId } from '@lumacast/commands';
import type { RpcOperations } from './ipc';

/** Every RPC operation name on the `castApi` bridge. */
export type RpcMethodName = keyof RpcOperations;

export interface ActionRpcBinding {
  /**
   * The RPC method this action calls. `null` marks a reserved action id with
   * no implementation behind it yet — the dispatcher answers those with
   * `failed: 'Not implemented'`.
   *
   * For a polymorphic action (see `resolve`) this names the default family so
   * the channel-existence check still has something concrete to verify.
   */
  method: RpcMethodName | null;
  /**
   * Parameter-object field names in the positional order the RPC method takes
   * them. A trailing optional argument may be absent from the params object,
   * in which case the dispatcher stops building arguments there.
   *
   * The single sentinel value `'input'` means "pass the whole parameter object
   * as the method's one argument". `[]` means the method takes no arguments.
   *
   */
  args: readonly string[];
  /**
   * Params-dependent method selection, for the three actions whose canonical
   * id spans two per-type RPC methods (`ItemRef.type` picks the table).
   */
  resolve?: (params: Record<string, unknown>) => { method: RpcMethodName; args: unknown[] };
}

function itemRefArg(params: Record<string, unknown>, field: string): ItemRef {
  const candidate = params[field];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error(`${field} must be an item reference`);
  }
  const { type, id } = candidate as { type?: unknown; id?: unknown };
  if ((type !== 'presentation' && type !== 'lyric') || typeof id !== 'string') {
    throw new Error(`${field} must be an item reference`);
  }
  return { type, id: id as Id };
}

const BINDINGS = {
  // --- Playlists ---
  'playlist.create': { method: 'createPlaylist', args: ['name'] },
  'playlist.rename': { method: 'renamePlaylist', args: ['id', 'name'] },
  'playlist.delete': { method: 'deletePlaylist', args: ['id'] },
  'playlist.setOrder': { method: 'setPlaylistOrder', args: ['playlistId', 'newOrder'] },
  'playlist.list': { method: 'listPlaylists', args: [] },
  'playlist.get': { method: 'getPlaylist', args: ['input'] },
  'playlist.addItem': { method: 'addItemToPlaylist', args: ['playlistId', 'itemRef', 'position'] },
  'playlist.moveRow': { method: 'movePlaylistRow', args: ['rowId', 'newOrder'] },
  'playlist.removeRow': { method: 'removePlaylistRow', args: ['rowId'] },
  'separator.create': { method: 'createSeparator', args: ['playlistId', 'label'] },
  'separator.rename': { method: 'renameSeparator', args: ['id', 'label'] },
  'separator.setColor': { method: 'setSeparatorColor', args: ['id', 'colorKey'] },

  // --- Items ---
  // The three polymorphic ids below collapse a per-table method pair that
  // differs only in which of the two item tables the id lives in — a
  // distinction `ItemRef` already carries.
  'item.create': { method: 'createItem', args: ['input'] },
  'item.duplicate': { method: 'duplicateItem', args: ['input'] },
  'item.rename': {
    method: 'renamePresentation',
    args: ['ref', 'title'],
    resolve: (params) => {
      const ref = itemRefArg(params, 'ref');
      return { method: ref.type === 'lyric' ? 'renameLyric' : 'renamePresentation', args: [ref.id, params.title] };
    },
  },
  'item.move': {
    method: 'movePresentation',
    args: ['ref', 'direction'],
    resolve: (params) => {
      const ref = itemRefArg(params, 'ref');
      return { method: ref.type === 'lyric' ? 'moveLyric' : 'movePresentation', args: [ref.id, params.direction] };
    },
  },
  'item.delete': {
    method: 'deletePresentation',
    args: ['ref'],
    resolve: (params) => {
      const ref = itemRefArg(params, 'ref');
      return { method: ref.type === 'lyric' ? 'deleteLyric' : 'deletePresentation', args: [ref.id] };
    },
  },
  'item.list': { method: 'listItems', args: ['input'] },
  'item.get': { method: 'getItem', args: ['input'] },
  'item.applyTheme': { method: 'applyThemeToItem', args: ['themeId', 'itemRef'] },
  'item.detachTheme': { method: 'detachThemeFromItem', args: ['itemRef'] },

  // --- Slides ---
  'slide.create': { method: 'createSlide', args: ['input'] },
  'slide.duplicate': { method: 'duplicateSlide', args: ['slideId'] },
  'slide.delete': { method: 'deleteSlide', args: ['slideId'] },
  'slide.setOrder': { method: 'setSlideOrder', args: ['input'] },
  'slide.updateNotes': { method: 'updateSlideNotes', args: ['input'] },
  'slide.updateBackground': { method: 'updateSlideBackground', args: ['input'] },
  'slide.get': { method: 'getSlide', args: ['input'] },
  'slideTag.create': { method: 'createSlideTag', args: ['input'] },
  'slideTag.update': { method: 'updateSlideTag', args: ['input'] },
  'slideTag.delete': { method: 'deleteSlideTag', args: ['id'] },
  'slideTag.assign': { method: 'assignSlideTags', args: ['input'] },
  'slideTag.list': { method: 'listSlideTags', args: [] },

  // --- Elements ---
  'element.create': { method: 'createElement', args: ['input'] },
  'element.createMany': { method: 'createElementsBatch', args: ['inputs'] },
  'element.update': { method: 'updateElement', args: ['input'] },
  'element.updateMany': { method: 'updateElementsBatch', args: ['inputs'] },
  'element.delete': { method: 'deleteElement', args: ['id'] },
  'element.deleteMany': { method: 'deleteElementsBatch', args: ['ids'] },

  // --- Media ---
  // The three filesystem-reading actions take a raw path and go to their own
  // `agent*` RPC rather than the RPC a UI gesture would use. Main authorizes
  // the path against the user's granted roots before reading it — a check a
  // picker-supplied `cast-media:` capability does not need and cannot carry.
  'media.import': { method: 'agentImportMedia', args: ['input'] },
  'media.delete': { method: 'deleteMediaAsset', args: ['id'] },
  'media.replaceSource': { method: 'agentReplaceMediaSource', args: ['input'] },
  'media.reclaimLibrary': { method: 'reclaimMediaLibrary', args: [] },
  'media.ensureDerivative': { method: 'ensureMediaDerivative', args: ['assetId'] },
  'media.list': { method: 'listMediaAssets', args: ['input'] },

  // --- Overlays ---
  'overlay.create': { method: 'createOverlay', args: ['input'] },
  'overlay.update': { method: 'updateOverlay', args: ['input'] },
  'overlay.setEnabled': { method: 'setOverlayEnabled', args: ['overlayId', 'enabled'] },
  'overlay.delete': { method: 'deleteOverlay', args: ['overlayId'] },
  'overlay.setOrder': { method: 'setOverlayOrder', args: ['overlayId', 'newOrder'] },
  'overlay.applyTheme': { method: 'applyThemeToOverlay', args: ['themeId', 'overlayId'] },
  'overlay.list': { method: 'listOverlays', args: [] },

  // --- Themes ---
  'theme.create': { method: 'createTheme', args: ['input'] },
  'theme.update': { method: 'updateTheme', args: ['input'] },
  'theme.delete': { method: 'deleteTheme', args: ['themeId', 'themeType'] },
  'theme.setOrder': { method: 'setThemeOrder', args: ['themeId', 'themeType', 'newOrder'] },
  'theme.syncLinkedItems': { method: 'syncThemeToLinkedItems', args: ['themeId', 'itemType'] },
  'theme.list': { method: 'listThemes', args: ['input'] },

  // --- Stages ---
  'stage.create': { method: 'createStage', args: ['input'] },
  'stage.update': { method: 'updateStage', args: ['input'] },
  'stage.delete': { method: 'deleteStage', args: ['stageId'] },
  'stage.duplicate': { method: 'duplicateStage', args: ['stageId'] },
  'stage.setOrder': { method: 'setStageOrder', args: ['stageId', 'newOrder'] },
  'stage.list': { method: 'listStages', args: [] },

  // --- Automation definitions ---
  'cue.create': { method: 'createCue', args: ['input'] },
  'cue.update': { method: 'updateCue', args: ['input'] },
  'cue.delete': { method: 'deleteCue', args: ['id'] },
  'cue.list': { method: 'listCues', args: [] },
  'macro.create': { method: 'createMacro', args: ['input'] },
  'macro.update': { method: 'updateMacro', args: ['input'] },
  'macro.delete': { method: 'deleteMacro', args: ['id'] },
  'macro.setOrder': { method: 'setMacroOrder', args: ['macroId', 'newOrder'] },
  'macro.list': { method: 'listMacros', args: [] },
  'triggerBinding.create': { method: 'createTriggerBinding', args: ['input'] },
  'triggerBinding.delete': { method: 'deleteTriggerBinding', args: ['id'] },
  'triggerBinding.list': { method: 'listTriggerBindings', args: [] },
  'schedule.save': { method: 'savePlaybackSchedule', args: ['schedule'] },
  'schedule.delete': { method: 'deletePlaybackSchedule', args: ['id'] },
  'schedule.list': { method: 'listPlaybackSchedules', args: [] },

  // --- Project ---
  'project.getSnapshot': { method: 'getSnapshot', args: [] },
  'project.getOverview': { method: 'getProjectOverview', args: [] },
  'project.search': { method: 'searchContent', args: ['input'] },
  'project.exportBundle': { method: 'exportBundle', args: ['itemIds', 'filePath', 'options'] },
  'project.inspectBundle': { method: 'inspectImportBundle', args: ['filePath'] },
  'project.importBundle': { method: 'finalizeImportBundle', args: ['filePath', 'decisions'] },
  'project.restoreBackup': { method: 'restoreProjectBackup', args: ['input'] },

  // --- Output ---
  'output.setEnabled': { method: 'setNdiOutputEnabled', args: ['name', 'enabled'] },
  'output.getState': { method: 'getNdiOutputState', args: [] },
  'output.getConfigs': { method: 'getNdiOutputConfigs', args: [] },
  'output.updateConfig': { method: 'updateNdiOutputConfig', args: ['name', 'config'] },
  'output.getDiagnostics': { method: 'getNdiDiagnostics', args: [] },

  // --- System ---
  'clipboard.read': { method: 'readClipboardText', args: [] },
  'clipboard.write': { method: 'writeClipboardText', args: ['text'] },
  'logs.listSessions': { method: 'obsListLogSessions', args: [] },
  'logs.readSession': { method: 'obsReadLogSession', args: ['filePath', 'offset', 'limit'] },
  'logs.getCurrentPath': { method: 'obsGetCurrentLogPath', args: [] },
  'logs.getSystemMetrics': { method: 'obsGetSystemMetrics', args: [] },

  'document.extractText': { method: 'agentExtractDocumentText', args: ['input'] },
} satisfies Readonly<Record<string, ActionRpcBinding>>;

/** Every action whose effect is realised in main, over the typed IPC contract. */
export type MainActionId = keyof typeof BINDINGS;

export const ACTION_RPC_BINDINGS: Readonly<Record<MainActionId, ActionRpcBinding>> = BINDINGS;

// `slide.render`, `slide.renderContactSheet`, `element.setRichText`,
// `element.group`, `element.ungroup`, `element.align`, and
// `element.distribute` were reserved main-site ids with a null binding here.
// They are now `site: 'renderer'` (ADR-0037) and implemented against the
// canvas and render features — see `RendererActionParams` below — so no
// reserved, unimplemented main-site id remains.

// ---------------------------------------------------------------------------
// Renderer-site parameters
// ---------------------------------------------------------------------------

// These unions mirror renderer UI vocabularies that live in
// `app/renderer/types/ui.ts` and the playback package. They are restated here
// rather than imported because protocol may depend on neither, and because
// the wire contract should pin the exact strings an agent may send.
export type ActionWorkbenchMode =
  | 'show'
  | 'item-editor'
  | 'overlay-editor'
  | 'theme-editor'
  | 'stage-editor'
  | 'macro-editor'
  | 'settings';

export type ActionSlideBrowserMode = 'grid' | 'list';
export type ActionProgramMode = 'single' | 'all';
export type ActionOverlayMode = 'single' | 'multiple';

/**
 * The parameter object every `site: 'renderer'` action takes. An empty object
 * type means the action takes no parameters; the dispatcher still accepts an
 * absent or empty `params`.
 */
export interface RendererActionParams {
  // --- Take / navigation ---
  'slide.take': Record<string, never>;
  /** Either addressing form; `slideId` wins when both are given. */
  'slide.activate': { slideId?: Id; index?: number };
  'slide.next': Record<string, never>;
  'slide.previous': Record<string, never>;
  /** Zero-based index within the currently loaded item. */
  'slide.jumpTo': { index: number };
  'slide.select': { slideId?: Id; index?: number };
  'slide.selectRange': { fromIndex: number; toIndex: number };

  // --- Layers ---
  'overlay.activate': { overlayId: Id };
  'overlay.clear': { overlayId: Id };
  'overlay.clearAll': Record<string, never>;
  'overlay.setMode': { mode: ActionOverlayMode };
  'mediaLayer.set': { assetId: Id };
  'mediaLayer.clear': Record<string, never>;
  'layer.clearContent': Record<string, never>;
  'layer.clearAll': Record<string, never>;

  // --- Video transport ---
  'video.arm': { assetId: Id };
  'video.clear': Record<string, never>;
  'video.play': Record<string, never>;
  'video.pause': Record<string, never>;
  'video.seek': { seconds: number };
  /** `0`–`1`. */
  'video.setVolume': { volume: number };
  'video.toggleMute': Record<string, never>;
  'video.toggleLoop': Record<string, never>;
  'video.next': Record<string, never>;
  'video.previous': Record<string, never>;

  // --- Audio transport ---
  'audio.arm': { assetId: Id };
  'audio.clear': Record<string, never>;
  'audio.play': Record<string, never>;
  'audio.pause': Record<string, never>;
  'audio.seek': { seconds: number };
  /** `0`–`1`. */
  'audio.setVolume': { volume: number };
  'audio.toggleMute': Record<string, never>;
  'audio.toggleLoop': Record<string, never>;
  'audio.next': Record<string, never>;
  'audio.previous': Record<string, never>;
  'audioSync.resume': Record<string, never>;

  // --- Stage ---
  'stage.arm': { stageId: Id };
  'stage.clear': Record<string, never>;

  // --- Automation execution ---
  'macro.run': { macroId: Id };
  'macro.cancelAll': Record<string, never>;
  'cue.run': { cueId: Id };

  // --- Workbench ---
  'workbench.setMode': { mode: ActionWorkbenchMode };
  'workbench.openSettings': Record<string, never>;
  'workbench.togglePanel': { splitId: string; paneId: string };
  'workbench.setSlideBrowserMode': { mode: ActionSlideBrowserMode };
  'workbench.setProgramMode': { mode: ActionProgramMode };
  'commandPalette.open': Record<string, never>;
  'lyricEditor.open': Record<string, never>;
  'editor.saveChanges': Record<string, never>;

  // --- Navigation / selection ---
  'navigation.selectPlaylist': { playlistId: Id };
  'navigation.selectPlaylistEntry': { entryId: Id };
  'navigation.browseItem': { ref: ItemRef };

  // --- Element editing ---
  'element.select': { elementId: Id };
  'element.selectMany': { elementIds: Id[] };
  'element.clearSelection': Record<string, never>;
  'element.copy': Record<string, never>;
  'element.cut': Record<string, never>;
  'element.paste': Record<string, never>;
  'element.duplicateSelection': Record<string, never>;
  'element.nudge': { dx: number; dy: number };
  /** Omit `elementId` to reorder the current selection. */
  'element.bringToFront': { elementId?: Id };
  'element.sendToBack': { elementId?: Id };
  'element.bringForward': { elementId?: Id };
  'element.sendBackward': { elementId?: Id };
  'element.toggleVisibility': { elementId: Id };
  'element.toggleLock': { elementId: Id };
  'element.rename': { elementId: Id; name: string };

  // --- History ---
  'edit.undo': Record<string, never>;
  'edit.redo': Record<string, never>;

  // --- Canvas grouping/align, rich text, and slide rendering ---
  // Field names mirror `./action-schemas.ts`'s `ACTION_SCHEMAS` exactly —
  // that module is the agent-facing vocabulary's source of truth. These ids
  // used to be `site: 'main'` reserved ids with a null binding and their own
  // (differently-named) `ReservedActionParams` shapes; they are now
  // `site: 'renderer'` (ADR-0037), executed against the canvas context
  // (`element.group`/`ungroup`/`align`/`distribute`/`setRichText`) and the
  // slide-render feature (`slide.render`/`renderContactSheet`).
  /** Renders a single slide to an image; `renderSlideToImage`'s own defaults apply when a field is omitted. */
  'slide.render': { slideId: Id; width?: number; height?: number; format?: 'png' | 'jpeg' };
  /** Renders a contact sheet of thumbnails; `renderContactSheet`'s own defaults apply when a field is omitted. */
  'slide.renderContactSheet': { slideIds: Id[]; columns?: number; thumbnailWidth?: number };
  /** Exactly one of `text`/`runs` is required; the executor rejects both or neither. */
  'element.setRichText': { elementId: Id; text?: string; runs?: RichRun[] };
  'element.group': { elementIds: Id[]; name?: string };
  'element.ungroup': { groupId: Id };
  /** `to` defaults to `'selection'` for 2+ elements, `'slide'` for a single element. */
  'element.align': { elementIds: Id[]; edge: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom'; to?: 'selection' | 'slide' };
  'element.distribute': { elementIds: Id[]; axis: 'horizontal' | 'vertical' };
}

/** Every action whose effect is realised in the renderer. */
export type RendererActionId = keyof RendererActionParams;

// ---------------------------------------------------------------------------
// Completeness
// ---------------------------------------------------------------------------

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertTrue<T extends true> = T;

/** Fails to compile if a binding or reserved id is not a real `ActionId`. */
export type MainActionIdsAreActionIds = AssertTrue<MainActionId extends ActionId ? true : false>;

/**
 * Fails to compile the moment an `ActionId` is added without either an RPC
 * binding or a renderer parameter shape — or one is declared for an id that no
 * longer exists.
 */
export type EveryActionIdIsBound = AssertTrue<Equal<ActionId, MainActionId | RendererActionId>>;
