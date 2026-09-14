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
import type {
  AgentMcpStatus,
  AppSnapshot,
  ItemSummary,
  MainApi,
  NdiDiagnostics,
  NdiOutputState,
  OverlaySummary,
  PlaylistSummary,
  ProjectOverview,
  StageSummary,
} from '@lumacast/protocol';
import { createDefaultAgentConfig, createDefaultNdiOutputConfigs } from '@lumacast/protocol';

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

/**
 * Read projections (see @lumacast/protocol's rpc-results.ts): the shim has
 * no repository, only the same read-only `/snapshot` document `getSnapshot`
 * already fetches, so the four list-shaped projections cheap to derive from
 * it — `listPlaylists`, `listOverlays`, `listStages`,
 * `getProjectOverview`'s counts — are computed here on every call (no
 * caching, matching `getSnapshot` above). Everything else needs SQL joins
 * (name-filtered pagination, slide/element detail, full-text search) this
 * preview surface cannot do against a snapshot cheaply, so those either
 * resolve to an empty list or throw, exactly like the mutation stubs below.
 */
async function fetchCurrentSnapshot(): Promise<AppSnapshot> {
  return fetchSnapshot<AppSnapshot>('/snapshot');
}

function countPlaylistRows(entries: AppSnapshot['playlistEntries'], playlistId: string): {
  rowCount: number;
  itemCount: number;
  separatorCount: number;
} {
  let rowCount = 0;
  let itemCount = 0;
  let separatorCount = 0;
  for (const entry of entries) {
    if (entry.playlistId !== playlistId) continue;
    rowCount += 1;
    if (entry.kind === 'item') itemCount += 1;
    else separatorCount += 1;
  }
  return { rowCount, itemCount, separatorCount };
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
  availabilityDrops: {
    audience: { outputDisabled: 0, senderUnavailable: 0 },
    stage: { outputDisabled: 0, senderUnavailable: 0 },
  },
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
  onNdiFrameReleased: noSubscription,
  onMediaDerivativeProgress: noSubscription,
  onMediaLibraryProgress: noSubscription,
  onPersistenceProgress: noSubscription,
  onAppMenuCommand: noSubscription,
  // No agent runtime exists in the browser preview, so nothing ever dispatches
  // an action and nothing ever needs answering.
  onAgentActionRequest: noSubscription,
  onAgentBatch: noSubscription,
  onAgentActionCancelled: noSubscription,
  onAgentThreadEvent: noSubscription,
  onAgentMcpStatus: noSubscription,
  requestNdiFrameTransport: noopVoid,
  requestNdiAudioTransport: noopVoid,
  sendNdiFrame: noopVoid,
  sendNdiAudio: noopVoid,

  // ── Interaction-only: benign resolved no-ops, never throw ──────────────
  readClipboardText: noop,
  writeClipboardText: noop,
  getInlineWindowMenuItems: noop,
  popupInlineWindowMenu: noop,
  checkForAppUpdates: noop,
  applySnapshotPatch: noop,
  restoreFromSnapshot: noop,
  chooseBundleExportPath: noop,
  chooseBundleImportPath: noop,
  chooseImportReplacementMediaPath: noop,
  exportBundle: noop,
  inspectImportBundle: noop,
  finalizeImportBundle: noop,
  listPlaybackSchedules: async () => [],
  savePlaybackSchedule: async () => { throw new Error('Slide timing changes require the desktop app.'); },
  deletePlaybackSchedule: async () => { throw new Error('Slide timing changes require the desktop app.'); },
  listSlideTags: async () => [],
  createSlideTag: noop,
  updateSlideTag: noop,
  deleteSlideTag: noop,
  assignSlideTags: noop,
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
  createSlide: noop,
  duplicateSlide: noop,
  deleteSlide: noop,
  updateSlideNotes: noop,
  updateSlideBackground: noop,
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
  reclaimMediaLibrary: async () => ({ removedFiles: 0, freedBytes: 0, keptFiles: 0 }),
  ensureMediaDerivative: noop,
  uploadMediaDerivativeFallback: noop,
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
  setLyricBlankSlides: noop,
  movePresentation: noop,
  moveLyric: noop,
  deletePlaylist: noop,
  deletePresentation: noop,
  deleteLyric: noop,
  setNdiOutputEnabled: async () => defaultNdiOutputState,
  updateNdiOutputConfig: async () => createDefaultNdiOutputConfigs(),
  restoreProjectBackup: noop,
  obsListLogSessions: noop,
  obsReadLogSession: noop,
  obsGetCurrentLogPath: noop,
  obsOpenLogFolder: noop,
  obsGetSystemMetrics: noop,
  agentRespondAction: noop,
  // The agent runtime is a main-process thing: there is no provider
  // credential, no model loop and no filesystem authorizer in a browser tab,
  // so every control answers with an empty/disabled shape rather than
  // pretending.
  agentListThreads: async () => [],
  agentGetThread: async () => null,
  agentCreateThread: async () => { throw new Error('The assistant requires the desktop app.'); },
  agentDeleteThread: noop,
  agentRenameThread: async () => { throw new Error('The assistant requires the desktop app.'); },
  agentSetThreadModel: async () => { throw new Error('The assistant requires the desktop app.'); },
  agentSendMessage: async () => { throw new Error('The assistant requires the desktop app.'); },
  agentStopGeneration: noop,
  agentGetConfig: async () => createDefaultAgentConfig(),
  agentUpdateConfig: async () => { throw new Error('The assistant requires the desktop app.'); },
  agentGetCredentialStatus: async () => [],
  agentSetCredential: async () => { throw new Error('The assistant requires the desktop app.'); },
  agentDeleteCredential: async () => { throw new Error('The assistant requires the desktop app.'); },
  agentListModels: async () => [],
  agentValidateModel: async () => 'unknown' as const,
  agentGrantFilesystemRoot: async () => null,
  agentRevokeFilesystemRoot: async () => { throw new Error('The assistant requires the desktop app.'); },
  agentImportMedia: async () => { throw new Error('The assistant requires the desktop app.'); },
  agentReplaceMediaSource: async () => { throw new Error('The assistant requires the desktop app.'); },
  agentExtractDocumentText: async () => { throw new Error('The assistant requires the desktop app.'); },
  agentGetMcpStatus: async (): Promise<AgentMcpStatus> => ({
    enabled: false,
    running: false,
    port: null,
    endpoint: null,
    clients: [],
    lastError: null,
  }),
  agentSetMcpEnabled: async () => { throw new Error('The assistant requires the desktop app.'); },
  agentCreateMcpClient: async () => { throw new Error('The assistant requires the desktop app.'); },
  agentRevokeMcpClient: async () => { throw new Error('The assistant requires the desktop app.'); },
  agentUpdateMcpClientPermissions: async () => { throw new Error('The assistant requires the desktop app.'); },

  // ── Read projections: cheap ones computed from `/snapshot`, the rest ───
  // either an empty list (list-shaped) or a clear error (single-item
  // "get"-shaped, which has no sensible empty value) — see the comment on
  // `fetchCurrentSnapshot` above.
  listPlaylists: async (): Promise<PlaylistSummary[]> => {
    const snapshot = await fetchCurrentSnapshot();
    return snapshot.playlists
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        order: playlist.order,
        ...countPlaylistRows(snapshot.playlistEntries, playlist.id),
      }));
  },
  getPlaylist: async () => { throw new Error('getPlaylist requires the desktop app.'); },
  listItems: async () => [],
  getItem: async () => { throw new Error('getItem requires the desktop app.'); },
  getSlide: async () => { throw new Error('getSlide requires the desktop app.'); },
  listMediaAssets: async () => [],
  listThemes: async () => [],
  listOverlays: async (): Promise<OverlaySummary[]> => {
    const snapshot = await fetchCurrentSnapshot();
    return snapshot.overlays
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((overlay) => ({
        id: overlay.id,
        name: overlay.name,
        enabled: overlay.enabled,
        order: overlay.order,
        animation: overlay.animation,
      }));
  },
  listStages: async (): Promise<StageSummary[]> => {
    const snapshot = await fetchCurrentSnapshot();
    return snapshot.stages
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((stage) => ({
        id: stage.id,
        name: stage.name,
        width: stage.width,
        height: stage.height,
        order: stage.order,
      }));
  },
  getProjectOverview: async (): Promise<ProjectOverview> => {
    const snapshot = await fetchCurrentSnapshot();

    const slideCountByOwnerId = new Map<string, number>();
    for (const slide of snapshot.slides) {
      const ownerId = slide.presentationId ?? slide.lyricId;
      if (!ownerId) continue;
      slideCountByOwnerId.set(ownerId, (slideCountByOwnerId.get(ownerId) ?? 0) + 1);
    }
    const playlistIdsByOwnerId = new Map<string, string[]>();
    for (const entry of snapshot.playlistEntries) {
      if (entry.kind !== 'item') continue;
      const ownerId = entry.presentationId ?? entry.lyricId;
      if (!ownerId) continue;
      const list = playlistIdsByOwnerId.get(ownerId);
      if (list) list.push(entry.playlistId);
      else playlistIdsByOwnerId.set(ownerId, [entry.playlistId]);
    }

    const items: ItemSummary[] = [
      ...snapshot.presentations.map((presentation) => ({
        ref: { type: 'presentation' as const, id: presentation.id },
        title: presentation.title,
        slideCount: slideCountByOwnerId.get(presentation.id) ?? 0,
        themeId: presentation.themeId ?? null,
        playlistIds: playlistIdsByOwnerId.get(presentation.id) ?? [],
        updatedAt: presentation.updatedAt,
      })),
      ...snapshot.lyrics.map((lyric) => ({
        ref: { type: 'lyric' as const, id: lyric.id },
        title: lyric.title,
        slideCount: slideCountByOwnerId.get(lyric.id) ?? 0,
        themeId: lyric.themeId ?? null,
        playlistIds: playlistIdsByOwnerId.get(lyric.id) ?? [],
        updatedAt: lyric.updatedAt,
      })),
    ];
    const recentItems = items
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 10);

    return {
      counts: {
        playlists: snapshot.playlists.length,
        presentations: snapshot.presentations.length,
        lyrics: snapshot.lyrics.length,
        slides: snapshot.slides.length,
        mediaAssets: snapshot.mediaAssets.length,
        themes: snapshot.presentationThemes.length + snapshot.lyricThemes.length + snapshot.overlayThemes.length,
        overlays: snapshot.overlays.length,
        stages: snapshot.stages.length,
        macros: snapshot.macros.length,
        cues: snapshot.cues.length,
      },
      playlists: snapshot.playlists.map((playlist) => ({ id: playlist.id, name: playlist.name })),
      recentItems,
      // Not exposed by the read-only preview snapshot endpoint — the real
      // app reads this from `PRAGMA user_version`, which this browser
      // preview surface has no access to.
      schemaVersion: 0,
    };
  },
  searchContent: async () => [],
} satisfies MainApi;

window.castApi = castApi;
