// Browser-preview shim: stands in for app/main/preload.ts's contextBridge
// bridge when the built renderer is loaded in a plain Chrome tab instead of
// Electron (`npm run preview:browser`, see tool/browser-preview/server.ts).
//
// tool/browser-preview/server.ts injects this file as a classic (non-module)
// `<script src="/__browser-shim.js">` tag ordered ahead of the renderer's
// `type="module"` entry point in the served index.html. That ordering is
// load-bearing: app/renderer/features/workbench/app-toolbar.tsx and
// windows-inline-menu-bar.tsx read `window.castApi.platform` at MODULE TOP
// LEVEL, so `window.castApi` must already exist before the module graph
// starts evaluating, or those modules throw before React ever mounts.
//
// Everything not explicitly implemented below is a no-op that resolves with a
// benign value and never throws: this is a read-only preview surface fed by
// tool/browser-preview/server.ts's real, read-only snapshot, so mutations
// have nothing to legitimately do. Boot-required calls — platform,
// getSnapshot, the NDI getters, updateAppMenuState, and the four subscription
// methods — have real or well-shaped default implementations so the
// workbench mounts and renders without throwing on first paint.
import type { MainApi, NdiDiagnostics, NdiOutputState } from '@lumacast/protocol';
import { createDefaultNdiOutputConfigs } from '@lumacast/protocol';

declare global {
  interface Window {
    /**
     * Overrides the `cast-media://` scheme prefix that
     * app/renderer/utils/slides.ts's `castMediaSrc` builds for a
     * freshly-picked file's outbound import-capability reference. Set here,
     * before any other module evaluates, so that call site — the only
     * cast-media-URL *builder* in the renderer — points at this server's
     * `/cast-media/` route instead of an unfetchable custom scheme.
     *
     * This alone does not make *existing* snapshot media (images/video
     * already in the project) render: those `src` values arrive pre-minted
     * as `cast-media://<id>` inside the AppSnapshot JSON itself, never built
     * client-side. `fetchSnapshot` below rewrites those in the same way when
     * it loads the snapshot, which is the seam that actually matters for
     * rendering.
     */
    __castMediaBase?: string;
  }
}

window.__castMediaBase = `${location.origin}/cast-media/`;

function detectPlatform(): NodeJS.Platform {
  const ua = navigator.userAgent;
  if (/Mac|iPhone|iPad|iPod/.test(ua)) return 'darwin';
  if (/Win/.test(ua)) return 'win32';
  return 'linux';
}

/**
 * Rewrites every `cast-media://<id>` reference in a JSON payload's raw text
 * into a same-origin HTTP URL before parsing. `cast-media:` is a custom
 * scheme with no registered protocol handler in a plain browser — no
 * `<img>`/`<video>` can ever load it, regardless of prefix — so this is the
 * actual seam that makes the snapshot's pre-existing media assets render in
 * preview mode; server.ts's `/cast-media/<id>` route resolves the id the
 * same way main's `cast-media:` protocol handler does.
 *
 * Managed media ids are exactly `m` + 32 lowercase hex characters
 * (app/main/media-capability.ts), so a verbatim substring replace is safe:
 * nothing else in the JSON can legitimately contain the literal
 * `cast-media://`.
 */
function rewriteCastMediaUrls(rawJson: string): string {
  return rawJson.split('cast-media://').join(`${location.origin}/cast-media/`);
}

async function fetchSnapshot<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`browser-preview shim: GET ${path} responded ${response.status}`);
  }
  const text = await response.text();
  return JSON.parse(rewriteCastMediaUrls(text)) as T;
}

const noop = async (..._args: unknown[]): Promise<any> => undefined;
const noopVoid = (..._args: unknown[]): void => {};
const noSubscription = (..._args: unknown[]): (() => void) => () => {};

const defaultNdiOutputState: NdiOutputState = { audience: false, stage: false };

const defaultNdiDiagnostics: NdiDiagnostics = {
  outputState: defaultNdiOutputState,
  outputConfig: createDefaultNdiOutputConfigs().audience,
  outputConfigs: createDefaultNdiOutputConfigs(),
  runtimeLoaded: false,
  runtimePath: null,
  activeSender: null,
  senders: { audience: null, stage: null },
  sourceStatus: 'idle',
  lastError: null,
};

const castApi = {
  // ── Boot-required: real platform + a real, read-only snapshot ──────────
  platform: detectPlatform(),
  getPathForFile: (_file: File) => '',
  getSnapshot: () => fetchSnapshot('/snapshot'),
  getNdiOutputState: async () => defaultNdiOutputState,
  getNdiOutputConfigs: async () => createDefaultNdiOutputConfigs(),
  getNdiDiagnostics: async () => defaultNdiDiagnostics,
  updateAppMenuState: noop,
  onNdiOutputStateChanged: noSubscription,
  onNdiDiagnosticsChanged: noSubscription,
  onNdiFrameAck: noSubscription,
  onAppMenuCommand: noSubscription,
  sendNdiFrame: noopVoid,
  sendNdiAudio: noopVoid,

  // ── Interaction-only: benign resolved no-ops, never throw ──────────────
  readClipboardText: noop,
  writeClipboardText: noop,
  getInlineWindowMenuItems: noop,
  popupInlineWindowMenu: noop,
  checkForAppUpdates: noop,
  restoreFromSnapshot: noop,
  chooseBundleExportPath: noop,
  chooseBundleImportPath: noop,
  chooseImportReplacementMediaPath: noop,
  exportBundle: noop,
  inspectImportBundle: noop,
  finalizeImportBundle: noop,
  listCues: noop,
  createCue: noop,
  updateCue: noop,
  deleteCue: noop,
  listMacros: noop,
  createMacro: noop,
  updateMacro: noop,
  deleteMacro: noop,
  listTriggerBindings: noop,
  createTriggerBinding: noop,
  deleteTriggerBinding: noop,
  createPlaylist: noop,
  createSeparator: noop,
  renameSeparator: noop,
  setSeparatorColor: noop,
  movePlaylist: noop,
  movePlaylistRow: noop,
  removePlaylistRow: noop,
  addItemToPlaylist: noop,
  createPresentation: noop,
  createLyric: noop,
  createTalk: noop,
  createSlide: noop,
  duplicateSlide: noop,
  deleteSlide: noop,
  updateSlideNotes: noop,
  updateSlideBackground: noop,
  createTalkScriptBlock: noop,
  updateTalkScriptBlock: noop,
  deleteTalkScriptBlock: noop,
  setTalkScriptBlockOrder: noop,
  setSlideOrder: noop,
  setPlaylistOrder: noop,
  setOverlayOrder: noop,
  setStageOrder: noop,
  setThemeOrder: noop,
  setMacroOrder: noop,
  createElement: noop,
  createElementsBatch: noop,
  updateElement: noop,
  updateElementsBatch: noop,
  deleteElement: noop,
  deleteElementsBatch: noop,
  createMediaAsset: noop,
  deleteMediaAsset: noop,
  updateMediaAssetSrc: noop,
  getAudioCoverArt: noop,
  createOverlay: noop,
  updateOverlay: noop,
  setOverlayEnabled: noop,
  deleteOverlay: noop,
  createTheme: noop,
  updateTheme: noop,
  deleteTheme: noop,
  applyThemeToItem: noop,
  detachThemeFromItem: noop,
  syncThemeToLinkedItems: noop,
  applyThemeToOverlay: noop,
  createItem: noop,
  duplicateItem: noop,
  createStage: noop,
  updateStage: noop,
  deleteStage: noop,
  duplicateStage: noop,
  renamePlaylist: noop,
  renamePresentation: noop,
  renameLyric: noop,
  renameTalk: noop,
  movePresentation: noop,
  moveLyric: noop,
  moveTalk: noop,
  deletePlaylist: noop,
  deletePresentation: noop,
  deleteLyric: noop,
  deleteTalk: noop,
  setNdiOutputEnabled: async () => defaultNdiOutputState,
  updateNdiOutputConfig: async () => createDefaultNdiOutputConfigs(),
  restoreProjectBackup: noop,
  obsListLogSessions: noop,
  obsReadLogSession: noop,
  obsGetCurrentLogPath: noop,
  obsOpenLogFolder: noop,
  obsGetSystemMetrics: noop,
} satisfies MainApi;

window.castApi = castApi;
