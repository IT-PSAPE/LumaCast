import type { StreamProject, StreamScene, StreamSource } from '../shared/desktop-api';

/**
 * A source bound to one runtime resource configuration. `id` is an ephemeral,
 * native-safe runtime ID; `originSourceId` keeps editor identity available to
 * UI and callbacks.
 */
export interface RuntimeSource extends StreamSource {
  originSourceId: string;
  /** Internal browser-capture viewport, bound to the project output size. */
  browserViewportWidth?: number;
  browserViewportHeight?: number;
}

export type RuntimeScene = Omit<StreamScene, 'sources'> & { sources: RuntimeSource[] };
export type RuntimeProject = Omit<StreamProject, 'scenes'> & { scenes: RuntimeScene[] };

export interface RuntimeViewport {
  width: number;
  height: number;
}

type SourceWithRuntimeMetadata = StreamSource & {
  originSourceId?: string;
  browserViewportWidth?: number;
  browserViewportHeight?: number;
};

// Native capture IPC validates IDs as UUID-like strings. Runtime sources are
// volatile, so allocate collision-free IDs per canonical stateful resource or
// origin/resource pair for this renderer session rather than encoding or
// hashing configuration into IDs.
const runtimeIds = new Map<string, string>();
// Automatic desktop-capture recovery can change the native handle while the
// same logical source remains on air. Keep that narrow rebinding separate
// from normal resource ID allocation so ordinary target edits stay distinct.
const runtimeAliases = new Map<string, string>();

function resourceDescriptor(source: SourceWithRuntimeMetadata, browserViewport?: RuntimeViewport): unknown {
  if (source.kind === 'media') {
    return {
      kind: source.kind,
      mediaKind: source.mediaKind ?? null,
      assetId: source.assetId ?? null,
      assetExtension: source.assetExtension ?? null,
    };
  }
  if (source.kind === 'slideshow') {
    return {
      kind: source.kind,
      slideshowImages: source.slideshowImages?.map(({ assetId, assetExtension }) => ({ assetId, assetExtension })) ?? null,
    };
  }
  if (source.kind === 'presentation') {
    return {
      kind: source.kind,
      presentationSlides: source.presentationSlides?.map(({ assetId, assetExtension }) => ({ assetId, assetExtension })) ?? null,
    };
  }
  if (source.kind === 'browser') {
    return {
      kind: source.kind,
      url: normalizeBrowserUrl(source.url),
      browserViewport: { width: browserViewport?.width ?? null, height: browserViewport?.height ?? null },
    };
  }

  return {
    kind: source.kind,
    referencedSceneId: source.kind === 'scene' ? source.referencedSceneId ?? null : null,
    browserViewport: null,
    mediaKind: source.mediaKind ?? null,
    assetId: source.assetId ?? null,
    assetExtension: source.assetExtension ?? null,
    captureId: source.captureId ?? null,
    captureBindingId: source.kind === 'display' || source.kind === 'window' ? source.captureBindingId ?? null : null,
    ndiSourceName: source.ndiSourceName ?? null,
    ndiUrlAddress: source.ndiUrlAddress ?? null,
    applicationPath: source.applicationPath ?? null,
    cursorMode: source.kind === 'display' || source.kind === 'window' ? source.cursorMode ?? 'motion' : null,
    deviceId: source.deviceId ?? null,
    captureAudioEnabled: source.captureAudioEnabled ?? null,
    captureAudioMode: source.captureAudioMode ?? null,
    captureAudioApplicationPath: source.captureAudioApplicationPath ?? null,
    audioDeviceId: source.captureAudioEnabled === true ? source.audioDeviceId ?? null : null,
    cameraResolution: source.cameraResolution ?? null,
    cameraFrameRate: source.cameraFrameRate ?? null,
    url: null,
    slideshowImages: null,
    presentationSlides: null,
  };
}

function normalizeBrowserUrl(value: string | undefined): string | null {
  if (!value) return null;
  const authoredUrl = value.trim();
  if (!authoredUrl) return null;
  try {
    const url = new URL(authoredUrl);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function getOriginSourceId(source: Pick<SourceWithRuntimeMetadata, 'id' | 'originSourceId'>): string {
  return source.originSourceId ?? source.id;
}

function resolveBrowserViewport(
  source: SourceWithRuntimeMetadata,
  browserViewport?: RuntimeViewport,
): RuntimeViewport | undefined {
  if (source.kind !== 'browser') return undefined;
  if (browserViewport) return browserViewport;
  if (source.browserViewportWidth === undefined || source.browserViewportHeight === undefined) return undefined;
  return { width: source.browserViewportWidth, height: source.browserViewportHeight };
}

function isShareableStatefulResource(source: StreamSource): boolean {
  if (source.kind === 'media') return Boolean(source.assetId && source.mediaKind);
  if (source.kind === 'slideshow') return (source.slideshowImages?.length ?? 0) > 0;
  if (source.kind === 'presentation') return (source.presentationSlides?.length ?? 0) > 0;
  if (source.kind === 'browser') return normalizeBrowserUrl(source.url) !== null;
  return false;
}

function runtimeBindingKey(source: SourceWithRuntimeMetadata, browserViewport?: RuntimeViewport): string {
  const originSourceId = getOriginSourceId(source);
  const descriptor = resourceDescriptor(source, resolveBrowserViewport(source, browserViewport));
  return JSON.stringify(isShareableStatefulResource(source)
    ? ['shared-resource', descriptor]
    : ['logical-source', originSourceId, descriptor]);
}

/** Returns a stable native-safe UUID for this resource's current runtime session. */
export function getSourceRuntimeId(source: SourceWithRuntimeMetadata, browserViewport?: RuntimeViewport): string {
  const key = runtimeBindingKey(source, browserViewport);
  const alias = runtimeAliases.get(key);
  if (alias) return alias;
  let runtimeId = runtimeIds.get(key);
  if (!runtimeId) {
    runtimeId = crypto.randomUUID();
    runtimeIds.set(key, runtimeId);
  }
  return runtimeId;
}

/**
 * Keeps an automatically restored display/window on its existing runtime
 * binding after the OS returns a refreshed native capture handle. Manual
 * target changes do not call this helper and therefore get their own UUID.
 */
export function preserveDesktopCaptureRuntime(
  current: SourceWithRuntimeMetadata,
  rebound: SourceWithRuntimeMetadata,
): string {
  const isDesktopCapture = (source: SourceWithRuntimeMetadata) => source.kind === 'display' || source.kind === 'window';
  const currentOrigin = getOriginSourceId(current);
  if (!isDesktopCapture(current) || !isDesktopCapture(rebound) || current.kind !== rebound.kind
    || currentOrigin !== getOriginSourceId(rebound)) {
    throw new Error('Automatic capture recovery must keep the same logical display or window source.');
  }
  if (current.captureBindingId !== rebound.captureBindingId) {
    throw new Error('Automatic capture recovery must preserve the same capture binding generation.');
  }

  const runtimeId = getSourceRuntimeId(current);
  const reboundKey = runtimeBindingKey(rebound);
  const existing = runtimeAliases.get(reboundKey) ?? runtimeIds.get(reboundKey);
  if (existing && existing !== runtimeId) {
    throw new Error('The refreshed capture source is already bound to another runtime.');
  }
  runtimeAliases.set(reboundKey, runtimeId);
  return runtimeId;
}

export function toRuntimeSource(source: SourceWithRuntimeMetadata, browserViewport?: RuntimeViewport): RuntimeSource {
  const originSourceId = getOriginSourceId(source);
  const viewport = resolveBrowserViewport(source, browserViewport);
  const runtimeSource: RuntimeSource = {
    ...source,
    id: getSourceRuntimeId(source, viewport),
    originSourceId,
    ...(viewport ? { browserViewportWidth: viewport.width, browserViewportHeight: viewport.height } : {}),
    ...(source.kind === 'group' ? { children: toRuntimeSources(source.children ?? [], browserViewport) } : {}),
  };
  if (!viewport) {
    delete runtimeSource.browserViewportWidth;
    delete runtimeSource.browserViewportHeight;
  }
  return runtimeSource;
}

export function toRuntimeSources(sources: readonly StreamSource[], browserViewport?: RuntimeViewport): RuntimeSource[] {
  return sources.map((source) => toRuntimeSource(source, browserViewport));
}

/** Maps every source node to its runtime ID while preserving scene references. */
export function toRuntimeProject(project: StreamProject): RuntimeProject {
  const browserViewport = { width: project.output.baseWidth, height: project.output.baseHeight };
  return {
    ...project,
    scenes: project.scenes.map((scene) => ({ ...scene, sources: toRuntimeSources(scene.sources, browserViewport) })),
  };
}

function flattenVisibleSourceNodes(sources: readonly StreamSource[]): StreamSource[] {
  const visible: StreamSource[] = [];
  const visit = (nodes: readonly StreamSource[], ancestorsVisible: boolean) => {
    if (!ancestorsVisible) return;
    for (const source of nodes) {
      if (!source.visible) continue;
      visible.push(source);
      if (source.kind === 'group') visit(source.children ?? [], true);
    }
  };
  visit(sources, true);
  return visible;
}

/**
 * Flattens source graphs into one resource owner per runtime ID. Hidden source
 * nodes never retain resources; visible sources in inactive scenes stay warm.
 * When visibility sets are supplied, visible configs layer in draft -> outgoing
 * -> Program order while every visible graph resource stays staged.
 */
export function mergeRuntimeSources({
  draftScenes,
  programScenes,
  outgoingScenes = [],
  draftSourceIds,
  programSourceIds,
  outgoingSourceIds,
}: {
  draftScenes: readonly StreamScene[];
  programScenes: readonly StreamScene[];
  outgoingScenes?: readonly StreamScene[];
  /** Logical source IDs visible in the active Preview graph. */
  draftSourceIds?: ReadonlySet<string>;
  /** Logical source IDs visible in the committed Program graph. */
  programSourceIds?: ReadonlySet<string>;
  /** Logical source IDs visible in the retained outgoing Program graph. */
  outgoingSourceIds?: ReadonlySet<string>;
}): RuntimeSource[] {
  const merged = new Map<string, RuntimeSource>();
  const addScenes = (scenes: readonly StreamScene[], visibleSourceIds?: ReadonlySet<string>, overwrite = true) => {
    for (const scene of scenes) {
      for (const source of flattenVisibleSourceNodes(scene.sources)) {
        if (visibleSourceIds && !visibleSourceIds.has(getOriginSourceId(source))) continue;
        const runtimeSource = toRuntimeSource(source);
        if (overwrite || !merged.has(runtimeSource.id)) merged.set(runtimeSource.id, runtimeSource);
      }
    }
  };

  const hasVisibilitySets = draftSourceIds !== undefined || outgoingSourceIds !== undefined || programSourceIds !== undefined;
  if (!hasVisibilitySets) {
    addScenes(draftScenes);
    addScenes(outgoingScenes);
    addScenes(programScenes);
    return [...merged.values()];
  }

  // Every visible draft scene remains warm. Program/outgoing ownership follows
  // their root-visible sets when supplied so hidden scene-reference descendants
  // do not retain resources on their own.
  addScenes(draftScenes, undefined, false);
  addScenes(outgoingScenes, outgoingSourceIds, false);
  addScenes(programScenes, programSourceIds, false);

  // Visible aliases select the effective config in front-to-back precedence.
  if (draftSourceIds) addScenes(draftScenes, draftSourceIds);
  if (outgoingSourceIds) addScenes(outgoingScenes, outgoingSourceIds);
  if (programSourceIds) addScenes(programScenes, programSourceIds);
  return [...merged.values()];
}
