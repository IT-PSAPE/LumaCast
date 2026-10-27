import { flattenSourceNodes } from '../shared/source-tree';
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
// volatile, so allocate collision-free IDs per origin/resource descriptor for
// this renderer session rather than encoding or hashing configuration into IDs.
const runtimeIds = new Map<string, string>();

function resourceDescriptor(source: StreamSource, browserViewport?: RuntimeViewport): unknown {
  return {
    kind: source.kind,
    referencedSceneId: source.kind === 'scene' ? source.referencedSceneId ?? null : null,
    browserViewport: source.kind === 'browser'
      ? { width: browserViewport?.width ?? null, height: browserViewport?.height ?? null }
      : null,
    mediaKind: source.mediaKind ?? null,
    assetId: source.assetId ?? null,
    assetExtension: source.assetExtension ?? null,
    captureId: source.captureId ?? null,
    applicationPath: source.applicationPath ?? null,
    cursorMode: source.cursorMode ?? null,
    deviceId: source.deviceId ?? null,
    cameraResolution: source.cameraResolution ?? null,
    cameraFrameRate: source.cameraFrameRate ?? null,
    url: source.url ?? null,
    slideshowImages: source.slideshowImages?.map(({ assetId, assetExtension }) => ({ assetId, assetExtension })) ?? null,
  };
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

/** Returns a stable UUID for this logical source's current resource variant. */
export function getSourceRuntimeId(source: SourceWithRuntimeMetadata, browserViewport?: RuntimeViewport): string {
  const originSourceId = getOriginSourceId(source);
  const key = JSON.stringify([originSourceId, resourceDescriptor(source, resolveBrowserViewport(source, browserViewport))]);
  let runtimeId = runtimeIds.get(key);
  if (!runtimeId) {
    runtimeId = crypto.randomUUID();
    runtimeIds.set(key, runtimeId);
  }
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

/**
 * Flattens and merges draft, outgoing, then Program source graphs. Later
 * entries override earlier entries for a shared runtime ID, preserving the
 * on-air version of mute, gain, filters, loop, and other non-resource config.
 */
export function mergeRuntimeSources({
  draftScenes,
  programScenes,
  outgoingScenes = [],
}: {
  draftScenes: readonly StreamScene[];
  programScenes: readonly StreamScene[];
  outgoingScenes?: readonly StreamScene[];
}): RuntimeSource[] {
  const merged = new Map<string, RuntimeSource>();
  const addScenes = (scenes: readonly StreamScene[]) => {
    for (const source of scenes.flatMap((scene) => flattenSourceNodes(scene.sources))) {
      const runtimeSource = toRuntimeSource(source);
      merged.set(runtimeSource.id, runtimeSource);
    }
  };

  addScenes(draftScenes);
  addScenes(outgoingScenes);
  addScenes(programScenes);
  return [...merged.values()];
}
