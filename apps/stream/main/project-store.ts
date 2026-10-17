import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { CAMERA_FRAME_RATE_OPTIONS, CAMERA_RESOLUTION_OPTIONS, createDefaultProject, createDefaultTextStyle, DEFAULT_STREAM_GLOBAL_HOTKEYS, isAudioTrack, isVideoEncoderFamily, MAX_STREAM_PROFILES, MAX_STREAM_SCENE_COLLECTIONS, normalizeAudioTracks, supportsVideoRateControl, type AudioMonitoring, type AudioTrack, type CameraFrameRatePreset, type CameraResolutionPreset, type CaptureCursorMode, type ChromaKeyFilter, type RecordingContainer, type SceneCollectionSummary, type SourceCrop, type StreamProfile, type StreamProfileDocument, type StreamProfileSummary, type StreamProject, type StreamScene, type StreamSource, type StreamTextStyle, type StreamWorkspace, type VideoRateControlMode } from '../shared/desktop-api';
import { flattenSourceNodes, MAX_SOURCE_GROUP_DEPTH } from '../shared/source-tree';
import { getSceneReferenceValidationError } from '../shared/scene-reference-graph';
import { normalizeSourceRotation } from '../shared/source-geometry';

const MAX_PROJECT_BYTES = 32 * 1024 * 1024;
const MAX_COLLECTIONS = MAX_STREAM_SCENE_COLLECTIONS;
const COLLECTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_KINDS = new Set(['display', 'window', 'camera', 'microphone', 'desktop-audio', 'application-audio', 'image', 'slideshow', 'media', 'browser', 'text', 'color', 'group', 'scene']);
const MEDIA_KINDS = new Set(['image', 'video', 'audio']);
const MEDIA_EXTENSIONS: Record<string, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'],
  video: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi'],
  audio: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isAbsoluteApplicationPath(value: string): boolean {
  return path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}

function finiteNumber(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isAudioTrackList(value: unknown): value is AudioTrack[] {
  return Array.isArray(value) && value.length <= 6 && value.every(isAudioTrack) && new Set(value).size === value.length;
}

const VIDEO_RATE_CONTROLS = new Set<VideoRateControlMode>(['cbr', 'pc_vbr', 'u_vbr', 'quality']);
const CAPTURE_CURSOR_MODES = new Set<CaptureCursorMode>(['never', 'motion', 'always']);
const CAMERA_RESOLUTIONS = new Set<string>(CAMERA_RESOLUTION_OPTIONS.map((option) => option.value));
const CAMERA_FRAME_RATES = new Set<number>(CAMERA_FRAME_RATE_OPTIONS);

function decodeSource(value: unknown, groupDepth = 0): StreamSource {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length > 128 || typeof value.name !== 'string' || value.name.length > 120) {
    throw new Error('Project contains an invalid source.');
  }
  if (typeof value.kind !== 'string' || !SOURCE_KINDS.has(value.kind)) throw new Error('Project contains an unsupported source type.');
  if (value.kind === 'group' && groupDepth >= MAX_SOURCE_GROUP_DEPTH) throw new Error('Source groups exceed the maximum nesting depth.');
  if (typeof value.visible !== 'boolean' || typeof value.muted !== 'boolean' || !finiteNumber(value.volume, 0, 2)) {
    throw new Error('Project contains invalid source audio or visibility settings.');
  }
  if (value.locked !== undefined && typeof value.locked !== 'boolean') throw new Error('Project contains invalid source lock settings.');
  if (value.balance !== undefined && !finiteNumber(value.balance, -1, 1)) throw new Error('Project contains invalid source audio balance.');
  if (!isRecord(value.transform) || !finiteNumber(value.transform.x, -32768, 32768) || !finiteNumber(value.transform.y, -32768, 32768)
    || !finiteNumber(value.transform.width, 1, 32768) || !finiteNumber(value.transform.height, 1, 32768)
    || (value.transform.rotation !== undefined
      && (!finiteNumber(value.transform.rotation, -180, 180) || value.transform.rotation === 180))) {
    throw new Error('Project contains an invalid source transform.');
  }
  let crop: SourceCrop | undefined;
  if (value.crop !== undefined) {
    const cropValue = value.crop;
    if (!isRecord(cropValue)) throw new Error('Project contains invalid source crop settings.');
    const edges = ['top', 'right', 'bottom', 'left'] as const;
    if (edges.some((edge) => !Number.isInteger(cropValue[edge]) || !finiteNumber(cropValue[edge], 0, 16384))) {
      throw new Error('Project contains invalid source crop settings.');
    }
    crop = { top: cropValue.top as number, right: cropValue.right as number, bottom: cropValue.bottom as number, left: cropValue.left as number };
  }
  if (value.captureId !== undefined && (typeof value.captureId !== 'string' || value.captureId.length > 512)) throw new Error('Project contains an invalid capture source.');
  if (value.applicationPath !== undefined && (value.kind !== 'application-audio' || typeof value.applicationPath !== 'string'
    || value.applicationPath.length > 32768 || !isAbsoluteApplicationPath(value.applicationPath))) throw new Error('Project contains an invalid application audio source.');
  if (value.kind === 'application-audio' && (typeof value.applicationPath !== 'string' || value.applicationPath.length === 0)) {
    throw new Error('Project contains an incomplete application audio source.');
  }
  if (value.cursorMode !== undefined && (!CAPTURE_CURSOR_MODES.has(value.cursorMode as CaptureCursorMode)
    || (value.kind !== 'display' && value.kind !== 'window'))) throw new Error('Project contains invalid cursor capture settings.');
  if (value.deviceId !== undefined && (typeof value.deviceId !== 'string' || value.deviceId.length > 512)) throw new Error('Project contains an invalid media device.');
  if (value.cameraResolution !== undefined && (value.kind !== 'camera' || typeof value.cameraResolution !== 'string' || !CAMERA_RESOLUTIONS.has(value.cameraResolution))) {
    throw new Error('Project contains invalid camera resolution settings.');
  }
  if (value.cameraFrameRate !== undefined && (value.kind !== 'camera' || !Number.isInteger(value.cameraFrameRate)
    || !CAMERA_FRAME_RATES.has(value.cameraFrameRate as number))) throw new Error('Project contains invalid camera frame-rate settings.');
  if (value.url !== undefined && (typeof value.url !== 'string' || value.url.length > 2048 || /[\u0000-\u001f\u007f]/.test(value.url))) {
    throw new Error('Project contains an invalid browser source URL.');
  }
  if (value.assetId !== undefined && (typeof value.assetId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.assetId))) throw new Error('Project contains an invalid imported asset.');
  if (value.assetExtension !== undefined && (typeof value.assetExtension !== 'string' || !/^(png|jpg|jpeg|bmp|gif|webp|mp4|m4v|mov|webm|mkv|avi|mp3|wav|ogg|flac|m4a|aac|opus)$/.test(value.assetExtension))) throw new Error('Project contains an invalid asset extension.');
  if (value.mediaKind !== undefined && (typeof value.mediaKind !== 'string' || !MEDIA_KINDS.has(value.mediaKind))) throw new Error('Project contains an invalid media type.');
  if (value.loop !== undefined && typeof value.loop !== 'boolean') throw new Error('Project contains an invalid media loop setting.');
  if (value.restartPlaybackWhenActive !== undefined && (value.kind !== 'media' || typeof value.restartPlaybackWhenActive !== 'boolean')) {
    throw new Error('Project contains an invalid media restart setting.');
  }
  if (value.showNothingWhenPlaybackEnds !== undefined && (value.kind !== 'media' || typeof value.showNothingWhenPlaybackEnds !== 'boolean')) {
    throw new Error('Project contains an invalid media end-frame setting.');
  }
  let slideshowImages: StreamSource['slideshowImages'];
  if (value.slideshowImages !== undefined) {
    if (value.kind !== 'slideshow' || !Array.isArray(value.slideshowImages) || value.slideshowImages.length < 1 || value.slideshowImages.length > 100
      || value.slideshowImages.some((item) => !isRecord(item) || typeof item.assetId !== 'string'
        || !COLLECTION_ID_PATTERN.test(item.assetId) || typeof item.assetExtension !== 'string'
        || !MEDIA_EXTENSIONS.image.includes(item.assetExtension) || typeof item.name !== 'string' || item.name.length < 1 || item.name.length > 120)) {
      throw new Error('Project contains invalid image slideshow settings.');
    }
    slideshowImages = value.slideshowImages.map((item) => ({ assetId: (item as Record<string, string>).assetId, assetExtension: (item as Record<string, string>).assetExtension, name: (item as Record<string, string>).name }));
  }
  if (value.slideshowIntervalSeconds !== undefined && (value.kind !== 'slideshow' || !finiteNumber(value.slideshowIntervalSeconds, 1, 600))) {
    throw new Error('Project contains invalid image slideshow settings.');
  }
  if (value.slideshowLoop !== undefined && (value.kind !== 'slideshow' || typeof value.slideshowLoop !== 'boolean')) {
    throw new Error('Project contains invalid image slideshow settings.');
  }
  if (value.browserAudioEnabled !== undefined && typeof value.browserAudioEnabled !== 'boolean') throw new Error('Project contains invalid browser audio settings.');
  const assetExtension = typeof value.assetExtension === 'string' ? value.assetExtension : '';
  const mediaKindExtensions = typeof value.mediaKind === 'string' ? MEDIA_EXTENSIONS[value.mediaKind] : undefined;
  const incompleteImage = value.kind === 'image' && (value.mediaKind !== 'image' || typeof value.assetId !== 'string'
    || typeof value.assetExtension !== 'string' || !MEDIA_EXTENSIONS.image.includes(assetExtension));
  const incompleteMedia = value.kind === 'media' && ((value.mediaKind !== 'video' && value.mediaKind !== 'audio')
    || typeof value.assetId !== 'string' || typeof value.assetExtension !== 'string' || !mediaKindExtensions?.includes(assetExtension));
  let incompleteBrowser = value.kind === 'browser';
  if (value.kind === 'browser' && typeof value.url === 'string') {
    try {
      const url = new URL(value.url);
      incompleteBrowser = (url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || Boolean(url.username || url.password);
    } catch { incompleteBrowser = true; }
  }
  const incompleteSlideshow = value.kind === 'slideshow' && !slideshowImages;
  if (incompleteImage || incompleteMedia || incompleteSlideshow || incompleteBrowser || (value.kind !== 'browser' && value.url !== undefined)) {
    throw new Error('Project contains an incomplete or invalid source.');
  }
  if (value.text !== undefined && (typeof value.text !== 'string' || value.text.length > 10000)) throw new Error('Project contains invalid text.');
  if (value.color !== undefined && (typeof value.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value.color))) throw new Error('Project contains an invalid color.');
  let textStyle: StreamTextStyle | undefined;
  if (value.textStyle !== undefined) {
    const style = value.textStyle;
    if (value.kind !== 'text' || !isRecord(style) || typeof style.fontFamily !== 'string'
      || style.fontFamily.trim().length < 1 || style.fontFamily.length > 120 || /[\u0000-\u001f\u007f]/.test(style.fontFamily)
      || !finiteNumber(style.fontSize, 1, 512) || typeof style.bold !== 'boolean' || typeof style.italic !== 'boolean'
      || !['left', 'center', 'right'].includes(String(style.horizontalAlignment))
      || !['top', 'center', 'bottom'].includes(String(style.verticalAlignment))
      || !isRecord(style.outline) || typeof style.outline.enabled !== 'boolean'
      || typeof style.outline.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(style.outline.color)
      || !finiteNumber(style.outline.width, 0, 32)
      || !isRecord(style.shadow) || typeof style.shadow.enabled !== 'boolean'
      || typeof style.shadow.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(style.shadow.color)
      || !finiteNumber(style.shadow.blur, 0, 100) || !finiteNumber(style.shadow.offsetX, -128, 128)
      || !finiteNumber(style.shadow.offsetY, -128, 128)
      || !isRecord(style.background) || typeof style.background.color !== 'string'
      || !/^#[0-9a-fA-F]{6}$/.test(style.background.color) || !finiteNumber(style.background.opacity, 0, 1)) {
      throw new Error('Project contains invalid text settings.');
    }
    textStyle = {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      bold: style.bold,
      italic: style.italic,
      horizontalAlignment: style.horizontalAlignment as StreamTextStyle['horizontalAlignment'],
      verticalAlignment: style.verticalAlignment as StreamTextStyle['verticalAlignment'],
      outline: { enabled: style.outline.enabled, color: style.outline.color, width: style.outline.width },
      shadow: { enabled: style.shadow.enabled, color: style.shadow.color, blur: style.shadow.blur, offsetX: style.shadow.offsetX, offsetY: style.shadow.offsetY },
      background: { color: style.background.color, opacity: style.background.opacity },
    };
  } else if (value.kind === 'text') {
    textStyle = createDefaultTextStyle();
  }
  let filters: StreamSource['filters'];
  if (value.filters !== undefined) {
    if (!isRecord(value.filters)) throw new Error('Project contains invalid source filters.');
    const defaults = { brightness: 100, contrast: 100, saturation: 100, opacity: 100, blur: 0 };
    const ranges = { brightness: [0, 200], contrast: [0, 200], saturation: [0, 200], opacity: [0, 100], blur: [0, 20] } as const;
    const decoded = { ...defaults };
    for (const key of Object.keys(ranges) as Array<keyof typeof ranges>) {
      const candidate = value.filters[key];
      const [minimum, maximum] = ranges[key];
      if (candidate !== undefined && !finiteNumber(candidate, minimum, maximum)) throw new Error('Project contains invalid source filters.');
      if (typeof candidate === 'number') decoded[key] = candidate;
    }
    filters = decoded;
  }
  let chromaKey: ChromaKeyFilter | undefined;
  if (value.chromaKey !== undefined) {
    if (!isRecord(value.chromaKey)
      || typeof value.chromaKey.enabled !== 'boolean'
      || typeof value.chromaKey.keyColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value.chromaKey.keyColor)
      || !finiteNumber(value.chromaKey.similarity, 0, 100)
      || !finiteNumber(value.chromaKey.smoothness, 0, 100)) {
      throw new Error('Project contains invalid chroma key settings.');
    }
    chromaKey = {
      enabled: value.chromaKey.enabled,
      keyColor: value.chromaKey.keyColor,
      similarity: value.chromaKey.similarity,
      smoothness: value.chromaKey.smoothness,
    };
  }
  let audioFilters: StreamSource['audioFilters'];
  if (value.audioFilters !== undefined) {
    if (!isRecord(value.audioFilters)) throw new Error('Project contains invalid audio filters.');
    const compressor = value.audioFilters.compressor;
    const threshold = value.audioFilters.compressorThresholdDb;
    const ratio = value.audioFilters.compressorRatio;
    const limiter = value.audioFilters.limiter;
    const noiseGate = value.audioFilters.noiseGate;
    const noiseSuppression = value.audioFilters.noiseSuppression;
    const gateOpenThreshold = value.audioFilters.noiseGateOpenThresholdDb;
    const gateCloseThreshold = value.audioFilters.noiseGateCloseThresholdDb;
    const gateAttack = value.audioFilters.noiseGateAttackMs;
    const gateHold = value.audioFilters.noiseGateHoldMs;
    const gateRelease = value.audioFilters.noiseGateReleaseMs;
    const expander = value.audioFilters.expander;
    const expanderThreshold = value.audioFilters.expanderThresholdDb;
    const expanderRatio = value.audioFilters.expanderRatio;
    const expanderAttack = value.audioFilters.expanderAttackMs;
    const expanderRelease = value.audioFilters.expanderReleaseMs;
    const gainDb = value.audioFilters.gainDb;
    if ((compressor !== undefined && typeof compressor !== 'boolean')
      || (limiter !== undefined && typeof limiter !== 'boolean')
      || (noiseGate !== undefined && typeof noiseGate !== 'boolean')
      || (noiseSuppression !== undefined && typeof noiseSuppression !== 'boolean')
      || (expander !== undefined && typeof expander !== 'boolean')
      || (gainDb !== undefined && !finiteNumber(gainDb, -30, 30))
      || (threshold !== undefined && !finiteNumber(threshold, -60, 0))
      || (ratio !== undefined && !finiteNumber(ratio, 1, 20))
      || (gateOpenThreshold !== undefined && !finiteNumber(gateOpenThreshold, -80, 0))
      || (gateCloseThreshold !== undefined && !finiteNumber(gateCloseThreshold, -80, 0))
      || (typeof gateOpenThreshold === 'number' && typeof gateCloseThreshold === 'number' && gateCloseThreshold > gateOpenThreshold)
      || (gateAttack !== undefined && !finiteNumber(gateAttack, 1, 1000))
      || (gateHold !== undefined && !finiteNumber(gateHold, 0, 2000))
      || (gateRelease !== undefined && !finiteNumber(gateRelease, 10, 2000))
      || (expanderThreshold !== undefined && !finiteNumber(expanderThreshold, -80, 0))
      || (expanderRatio !== undefined && !finiteNumber(expanderRatio, 1, 10))
      || (expanderAttack !== undefined && !finiteNumber(expanderAttack, 1, 1000))
      || (expanderRelease !== undefined && !finiteNumber(expanderRelease, 10, 2000))) {
      throw new Error('Project contains invalid audio filters.');
    }
    audioFilters = {
      gainDb: typeof gainDb === 'number' ? gainDb : 0,
      noiseSuppression: noiseSuppression === true,
      noiseGate: noiseGate === true,
      noiseGateOpenThresholdDb: typeof gateOpenThreshold === 'number' ? gateOpenThreshold : -26,
      noiseGateCloseThresholdDb: typeof gateCloseThreshold === 'number' ? gateCloseThreshold : -32,
      noiseGateAttackMs: typeof gateAttack === 'number' ? gateAttack : 10,
      noiseGateHoldMs: typeof gateHold === 'number' ? gateHold : 150,
      noiseGateReleaseMs: typeof gateRelease === 'number' ? gateRelease : 250,
      expander: expander === true,
      expanderThresholdDb: typeof expanderThreshold === 'number' ? expanderThreshold : -40,
      expanderRatio: typeof expanderRatio === 'number' ? expanderRatio : 2,
      expanderAttackMs: typeof expanderAttack === 'number' ? expanderAttack : 10,
      expanderReleaseMs: typeof expanderRelease === 'number' ? expanderRelease : 150,
      compressor: compressor === true,
      compressorThresholdDb: typeof threshold === 'number' ? threshold : -18,
      compressorRatio: typeof ratio === 'number' ? ratio : 4,
      limiter: limiter === true,
    };
  }
  if (value.audioMonitoring !== undefined && !['off', 'monitor-only', 'monitor-and-output'].includes(String(value.audioMonitoring))) {
    throw new Error('Project contains invalid audio monitoring settings.');
  }
  if (value.audioTracks !== undefined && !isAudioTrackList(value.audioTracks)) throw new Error('Project contains invalid audio track routing.');
  let children: StreamSource[] | undefined;
  if (value.kind === 'group') {
    if (!Array.isArray(value.children) || value.children.length > 10000) throw new Error('Project contains an invalid source group.');
    children = value.children.map((child) => decodeSource(child, groupDepth + 1));
  } else if (value.children !== undefined) throw new Error('Project contains invalid nested sources.');
  if (value.kind === 'scene') {
    if (typeof value.referencedSceneId !== 'string' || value.referencedSceneId.length < 1 || value.referencedSceneId.length > 128) {
      throw new Error('Project contains an invalid Scene source reference.');
    }
  } else if (value.referencedSceneId !== undefined) throw new Error('Project contains an invalid Scene source reference.');

  return {
    id: value.id,
    name: value.name,
    kind: value.kind as StreamSource['kind'],
    visible: value.visible,
    locked: value.locked === true,
    muted: value.muted,
    volume: value.volume,
    balance: typeof value.balance === 'number' ? value.balance : 0,
    transform: {
      x: value.transform.x,
      y: value.transform.y,
      width: value.transform.width,
      height: value.transform.height,
      rotation: normalizeSourceRotation(value.transform.rotation as number | undefined),
    },
    ...(crop ? { crop } : {}),
    ...(filters ? { filters } : {}),
    ...(chromaKey ? { chromaKey } : {}),
    ...(audioFilters ? { audioFilters } : {}),
    audioMonitoring: (value.audioMonitoring as AudioMonitoring | undefined) ?? 'off',
    audioTracks: value.audioTracks === undefined ? [1] : normalizeAudioTracks(value.audioTracks),
    ...(typeof value.captureId === 'string' ? { captureId: value.captureId } : {}),
    ...(value.kind === 'application-audio' && typeof value.applicationPath === 'string' ? { applicationPath: value.applicationPath } : {}),
    ...((value.kind === 'display' || value.kind === 'window') ? { cursorMode: (value.cursorMode as CaptureCursorMode | undefined) ?? 'motion' } : {}),
    ...(typeof value.deviceId === 'string' ? { deviceId: value.deviceId } : {}),
    ...(typeof value.cameraResolution === 'string' ? { cameraResolution: value.cameraResolution as CameraResolutionPreset } : {}),
    ...(typeof value.cameraFrameRate === 'number' ? { cameraFrameRate: value.cameraFrameRate as CameraFrameRatePreset } : {}),
    ...(typeof value.url === 'string' ? { url: value.url } : {}),
    ...(typeof value.assetId === 'string' ? { assetId: value.assetId } : {}),
    ...(typeof value.assetExtension === 'string' ? { assetExtension: value.assetExtension } : {}),
    ...(typeof value.mediaKind === 'string' ? { mediaKind: value.mediaKind as StreamSource['mediaKind'] } : {}),
    ...(value.kind === 'media' && typeof value.loop === 'boolean' ? { loop: value.loop } : {}),
    ...(typeof value.restartPlaybackWhenActive === 'boolean' ? { restartPlaybackWhenActive: value.restartPlaybackWhenActive } : {}),
    ...(typeof value.showNothingWhenPlaybackEnds === 'boolean' ? { showNothingWhenPlaybackEnds: value.showNothingWhenPlaybackEnds } : {}),
    ...(slideshowImages ? { slideshowImages } : {}),
    ...(typeof value.slideshowIntervalSeconds === 'number' ? { slideshowIntervalSeconds: value.slideshowIntervalSeconds } : {}),
    ...(typeof value.slideshowLoop === 'boolean' ? { slideshowLoop: value.slideshowLoop } : {}),
    ...(typeof value.browserAudioEnabled === 'boolean' ? { browserAudioEnabled: value.browserAudioEnabled } : {}),
    ...(typeof value.text === 'string' ? { text: value.text } : {}),
    ...(textStyle ? { textStyle } : {}),
    ...(typeof value.color === 'string' ? { color: value.color } : {}),
    ...(children ? { children } : {}),
    ...(value.kind === 'scene' ? { referencedSceneId: value.referencedSceneId as string } : {}),
  };
}

function decodeProject(value: unknown): StreamProject {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.output)) throw new Error('This Stream project is not supported.');
  const baseWidth = value.output.baseWidth === undefined ? value.output.width : value.output.baseWidth;
  const baseHeight = value.output.baseHeight === undefined ? value.output.height : value.output.baseHeight;
  if (!finiteNumber(baseWidth, 320, 16384) || !finiteNumber(baseHeight, 180, 16384)
    || !finiteNumber(value.output.width, 320, 16384) || !finiteNumber(value.output.height, 180, 16384)
    || !finiteNumber(value.output.frameRate, 1, 240)
    || (value.output.streamVideoBitrateKbps !== undefined && (!Number.isInteger(value.output.streamVideoBitrateKbps) || !finiteNumber(value.output.streamVideoBitrateKbps, 250, 50000)))
    || (value.output.streamAudioBitrateKbps !== undefined && (!Number.isInteger(value.output.streamAudioBitrateKbps) || !finiteNumber(value.output.streamAudioBitrateKbps, 32, 320)))
    || (value.output.streamAudioTrack !== undefined && !isAudioTrack(value.output.streamAudioTrack))
    || (value.output.recordingAudioTracks !== undefined && !isAudioTrackList(value.output.recordingAudioTracks))
    || (value.output.streamRateControl !== undefined && !VIDEO_RATE_CONTROLS.has(value.output.streamRateControl as VideoRateControlMode))
    || (value.output.streamVideoEncoder !== undefined && !isVideoEncoderFamily(value.output.streamVideoEncoder))
    || !supportsVideoRateControl(
      isVideoEncoderFamily(value.output.streamVideoEncoder) ? value.output.streamVideoEncoder : 'h264_mf',
      VIDEO_RATE_CONTROLS.has(value.output.streamRateControl as VideoRateControlMode) ? value.output.streamRateControl as VideoRateControlMode : 'cbr',
    )
    || (value.output.streamEncoderQuality !== undefined && (!Number.isInteger(value.output.streamEncoderQuality) || !finiteNumber(value.output.streamEncoderQuality, 0, 100)))
    || (value.output.streamHardwareEncoding !== undefined && typeof value.output.streamHardwareEncoding !== 'boolean')
    || (value.output.streamKeyframeIntervalSeconds !== undefined && (!Number.isInteger(value.output.streamKeyframeIntervalSeconds) || !finiteNumber(value.output.streamKeyframeIntervalSeconds, 1, 10)))
    || (value.output.recordingVideoBitrateKbps !== undefined && (!Number.isInteger(value.output.recordingVideoBitrateKbps) || !finiteNumber(value.output.recordingVideoBitrateKbps, 500, 50000)))
    || (value.output.recordingAudioBitrateKbps !== undefined && (!Number.isInteger(value.output.recordingAudioBitrateKbps) || !finiteNumber(value.output.recordingAudioBitrateKbps, 32, 320)))
    || (value.output.recordingContainer !== undefined && !['webm', 'mkv', 'mp4'].includes(String(value.output.recordingContainer)))
    || (value.output.recordingRateControl !== undefined && !VIDEO_RATE_CONTROLS.has(value.output.recordingRateControl as VideoRateControlMode))
    || (value.output.recordingVideoEncoder !== undefined && !isVideoEncoderFamily(value.output.recordingVideoEncoder))
    || !supportsVideoRateControl(
      isVideoEncoderFamily(value.output.recordingVideoEncoder) ? value.output.recordingVideoEncoder : 'h264_mf',
      VIDEO_RATE_CONTROLS.has(value.output.recordingRateControl as VideoRateControlMode) ? value.output.recordingRateControl as VideoRateControlMode : 'cbr',
    )
    || (value.output.recordingEncoderQuality !== undefined && (!Number.isInteger(value.output.recordingEncoderQuality) || !finiteNumber(value.output.recordingEncoderQuality, 0, 100)))
    || (value.output.recordingHardwareEncoding !== undefined && typeof value.output.recordingHardwareEncoding !== 'boolean')
    || (value.output.recordingKeyframeIntervalSeconds !== undefined && (!Number.isInteger(value.output.recordingKeyframeIntervalSeconds) || !finiteNumber(value.output.recordingKeyframeIntervalSeconds, 1, 10)))) {
    throw new Error('Project contains invalid video settings.');
  }
  if (typeof value.studioMode !== 'boolean' || typeof value.activeSceneId !== 'string' || typeof value.liveSceneId !== 'string'
    || !Array.isArray(value.scenes) || value.scenes.length === 0 || value.scenes.length > 1000) throw new Error('Project contains invalid scenes.');

  const scenes: StreamScene[] = value.scenes.map((sceneValue): StreamScene => {
    if (!isRecord(sceneValue) || typeof sceneValue.id !== 'string' || sceneValue.id.length > 128
      || typeof sceneValue.name !== 'string' || sceneValue.name.length > 120 || !Array.isArray(sceneValue.sources)
      || sceneValue.sources.length > 10000) throw new Error('Project contains an invalid scene.');
    return { id: sceneValue.id, name: sceneValue.name, sources: sceneValue.sources.map((source) => decodeSource(source)) };
  });
  const sceneIds = new Set(scenes.map((scene) => scene.id));
  const referenceValidation = getSceneReferenceValidationError(scenes);
  if (referenceValidation) throw new Error(referenceValidation);
  const sourceIds = scenes.flatMap((scene) => flattenSourceNodes(scene.sources).map((source) => source.id));
  const sourceIdSet = new Set(sourceIds);
  if (sceneIds.size !== scenes.length || !sceneIds.has(value.activeSceneId) || !sceneIds.has(value.liveSceneId)) {
    throw new Error('Project refers to a scene that does not exist.');
  }
  if (sourceIdSet.size !== sourceIds.length) throw new Error('Project contains duplicate source IDs.');
  const hotkeysValue = value.hotkeys;
  if (hotkeysValue !== undefined && (!isRecord(hotkeysValue)
    || ['toggleStreaming', 'toggleRecording', 'toggleReplayBuffer', 'saveReplay'].some((key) => {
      const accelerator = hotkeysValue[key];
      return typeof accelerator !== 'string' || accelerator.length > 64 || /[\u0000-\u001f\u007f]/.test(accelerator);
    }))) throw new Error('Project contains invalid global hotkeys.');
  const hotkeys = isRecord(hotkeysValue) ? {
    toggleStreaming: hotkeysValue.toggleStreaming as string,
    toggleRecording: hotkeysValue.toggleRecording as string,
    toggleReplayBuffer: hotkeysValue.toggleReplayBuffer as string,
    saveReplay: hotkeysValue.saveReplay as string,
  } : { ...DEFAULT_STREAM_GLOBAL_HOTKEYS };
  const sceneSwitchHotkeysValue = value.sceneSwitchHotkeys;
  if (sceneSwitchHotkeysValue !== undefined && (!isRecord(sceneSwitchHotkeysValue)
    || Object.entries(sceneSwitchHotkeysValue).some(([sceneId, accelerator]) => !sceneIds.has(sceneId)
      || typeof accelerator !== 'string' || accelerator.length > 64 || /[\u0000-\u001f\u007f]/.test(accelerator)))) {
    throw new Error('Project contains invalid scene switch hotkeys.');
  }
  const sceneSwitchHotkeys = isRecord(sceneSwitchHotkeysValue)
    ? Object.fromEntries(Object.entries(sceneSwitchHotkeysValue) as Array<[string, string]>)
    : {};
  const sourceVisibilityHotkeysValue = value.sourceVisibilityHotkeys;
  if (sourceVisibilityHotkeysValue !== undefined && (!isRecord(sourceVisibilityHotkeysValue)
    || Object.entries(sourceVisibilityHotkeysValue).some(([sourceId, accelerator]) => !sourceIdSet.has(sourceId)
      || typeof accelerator !== 'string' || accelerator.length > 64 || /[\u0000-\u001f\u007f]/.test(accelerator)))) {
    throw new Error('Project contains invalid source visibility hotkeys.');
  }
  const sourceVisibilityHotkeys = isRecord(sourceVisibilityHotkeysValue)
    ? Object.fromEntries(Object.entries(sourceVisibilityHotkeysValue) as Array<[string, string]>)
    : {};
  return {
    version: 1,
    output: {
      baseWidth,
      baseHeight,
      width: value.output.width,
      height: value.output.height,
      frameRate: value.output.frameRate,
      streamVideoBitrateKbps: typeof value.output.streamVideoBitrateKbps === 'number' ? value.output.streamVideoBitrateKbps : 6000,
      streamAudioBitrateKbps: typeof value.output.streamAudioBitrateKbps === 'number' ? value.output.streamAudioBitrateKbps : 160,
      streamAudioTrack: isAudioTrack(value.output.streamAudioTrack) ? value.output.streamAudioTrack : 1,
      streamRateControl: (VIDEO_RATE_CONTROLS.has(value.output.streamRateControl as VideoRateControlMode) ? value.output.streamRateControl : 'cbr') as VideoRateControlMode,
      streamVideoEncoder: isVideoEncoderFamily(value.output.streamVideoEncoder) ? value.output.streamVideoEncoder : 'h264_mf',
      streamEncoderQuality: typeof value.output.streamEncoderQuality === 'number' ? value.output.streamEncoderQuality : 60,
      streamHardwareEncoding: value.output.streamHardwareEncoding === true,
      streamKeyframeIntervalSeconds: typeof value.output.streamKeyframeIntervalSeconds === 'number' ? value.output.streamKeyframeIntervalSeconds : 2,
      recordingVideoBitrateKbps: typeof value.output.recordingVideoBitrateKbps === 'number' ? value.output.recordingVideoBitrateKbps : 8000,
      recordingAudioBitrateKbps: typeof value.output.recordingAudioBitrateKbps === 'number' ? value.output.recordingAudioBitrateKbps : 160,
      recordingAudioTracks: value.output.recordingAudioTracks === undefined ? [1] : normalizeAudioTracks(value.output.recordingAudioTracks),
      recordingContainer: (value.output.recordingContainer === 'mkv' || value.output.recordingContainer === 'mp4' ? value.output.recordingContainer : 'webm') as RecordingContainer,
      recordingRateControl: (VIDEO_RATE_CONTROLS.has(value.output.recordingRateControl as VideoRateControlMode) ? value.output.recordingRateControl : 'cbr') as VideoRateControlMode,
      recordingVideoEncoder: isVideoEncoderFamily(value.output.recordingVideoEncoder) ? value.output.recordingVideoEncoder : 'h264_mf',
      recordingEncoderQuality: typeof value.output.recordingEncoderQuality === 'number' ? value.output.recordingEncoderQuality : 60,
      recordingHardwareEncoding: value.output.recordingHardwareEncoding === true,
      recordingKeyframeIntervalSeconds: typeof value.output.recordingKeyframeIntervalSeconds === 'number' ? value.output.recordingKeyframeIntervalSeconds : 2,
    },
    studioMode: value.studioMode,
    activeSceneId: value.activeSceneId,
    liveSceneId: value.liveSceneId,
    hotkeys,
    sceneSwitchHotkeys,
    sourceVisibilityHotkeys,
    scenes,
  };
}

interface CollectionIndex {
  version: 1;
  activeCollectionId: string;
  collections: SceneCollectionSummary[];
}

interface ProfileIndex {
  version: 1;
  activeProfileId: string;
  profiles: StreamProfile[];
}

function validateCollectionName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter a collection name.');
  const name = value.trim();
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Collection names must be 1–80 characters.');
  return name;
}

function decodeCollectionIndex(value: unknown): CollectionIndex {
  if (!isRecord(value) || value.version !== 1 || typeof value.activeCollectionId !== 'string'
    || !Array.isArray(value.collections) || value.collections.length === 0 || value.collections.length > MAX_COLLECTIONS) {
    throw new Error('Stream contains an invalid scene-collection index.');
  }
  const collections = value.collections.map((entry): SceneCollectionSummary => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !COLLECTION_ID_PATTERN.test(entry.id)) {
      throw new Error('Stream contains an invalid scene collection.');
    }
    return { id: entry.id, name: validateCollectionName(entry.name) };
  });
  const ids = new Set(collections.map((entry) => entry.id));
  const names = new Set(collections.map((entry) => entry.name.toLocaleLowerCase('en-US')));
  if (ids.size !== collections.length || names.size !== collections.length || !ids.has(value.activeCollectionId)) {
    throw new Error('Stream contains duplicate collections or an invalid active collection.');
  }
  return { version: 1, activeCollectionId: value.activeCollectionId, collections };
}

function validateProfileName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Profile name must be text.');
  const name = value.trim();
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Profile names must be 1–80 characters.');
  return name;
}

function decodeProfileIndex(value: unknown): ProfileIndex {
  if (!isRecord(value) || value.version !== 1 || typeof value.activeProfileId !== 'string'
    || !Array.isArray(value.profiles) || value.profiles.length === 0 || value.profiles.length > MAX_STREAM_PROFILES) {
    throw new Error('Stream contains an invalid profile index.');
  }
  const profiles = value.profiles.map((entry): StreamProfile => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !COLLECTION_ID_PATTERN.test(entry.id)) {
      throw new Error('Stream contains an invalid profile.');
    }
    const name = validateProfileName(entry.name);
    const decoded = decodeProject({ ...createDefaultProject(), output: entry.output, hotkeys: entry.hotkeys });
    return { id: entry.id, name, output: decoded.output, hotkeys: decoded.hotkeys };
  });
  const ids = new Set(profiles.map((profile) => profile.id));
  const names = new Set(profiles.map((profile) => profile.name.toLocaleLowerCase('en-US')));
  if (ids.size !== profiles.length || names.size !== profiles.length || !ids.has(value.activeProfileId)) {
    throw new Error('Stream contains duplicate profiles or an invalid active profile.');
  }
  return { version: 1, activeProfileId: value.activeProfileId, profiles };
}

function decodeProfileDocument(value: unknown): StreamProfileDocument {
  if (!isRecord(value) || value.format !== 'lumastream-profile' || value.version !== 1) {
    throw new Error('This file is not a supported LumaStream profile.');
  }
  const name = validateProfileName(value.name);
  const decoded = decodeProject({ ...createDefaultProject(), output: value.output, hotkeys: value.hotkeys });
  return { format: 'lumastream-profile', version: 1, name, output: decoded.output, hotkeys: decoded.hotkeys };
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    const handle = await open(temporaryPath, 'wx');
    try {
      await handle.writeFile(JSON.stringify(value, null, 2), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

function duplicateProject(project: StreamProject): StreamProject {
  const sceneIds = new Map(project.scenes.map((scene) => [scene.id, crypto.randomUUID()]));
  const sourceIds = new Map(project.scenes.flatMap((scene) => flattenSourceNodes(scene.sources)).map((source) => [source.id, crypto.randomUUID()]));
  const cloneSource = (source: StreamSource): StreamSource => ({
    ...source,
    id: sourceIds.get(source.id)!,
    transform: { ...source.transform },
    ...(source.crop ? { crop: { ...source.crop } } : {}),
    ...(source.filters ? { filters: { ...source.filters } } : {}),
    ...(source.chromaKey ? { chromaKey: { ...source.chromaKey } } : {}),
    ...(source.audioFilters ? { audioFilters: { ...source.audioFilters } } : {}),
    ...(source.slideshowImages ? { slideshowImages: source.slideshowImages.map((image) => ({ ...image })) } : {}),
    ...(source.children ? { children: source.children.map(cloneSource) } : {}),
    ...(source.kind === 'scene' && source.referencedSceneId ? { referencedSceneId: sceneIds.get(source.referencedSceneId) ?? source.referencedSceneId } : {}),
    audioTracks: [...(source.audioTracks ?? [1])],
  });
  const scenes = project.scenes.map((scene) => ({
    ...scene,
    id: sceneIds.get(scene.id)!,
    sources: scene.sources.map(cloneSource),
  }));
  return {
    ...project,
    output: { ...project.output },
    hotkeys: { ...project.hotkeys },
    activeSceneId: sceneIds.get(project.activeSceneId)!,
    liveSceneId: sceneIds.get(project.liveSceneId)!,
    sceneSwitchHotkeys: Object.fromEntries(Object.entries(project.sceneSwitchHotkeys).map(([sceneId, accelerator]) => [sceneIds.get(sceneId) ?? sceneId, accelerator])),
    sourceVisibilityHotkeys: Object.fromEntries(Object.entries(project.sourceVisibilityHotkeys).map(([sourceId, accelerator]) => [sourceIds.get(sourceId) ?? sourceId, accelerator])),
    scenes,
  };
}

export class ProjectStore {
  private readonly collectionsDirectory: string;
  private readonly indexPath: string;
  private readonly profilesPath: string;
  private readonly legacyPath: string;
  private collectionIndex: CollectionIndex | null = null;
  private profileIndex: ProfileIndex | null = null;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(dataDirectory: string) {
    this.collectionsDirectory = path.join(dataDirectory, 'scene-collections');
    this.indexPath = path.join(this.collectionsDirectory, 'index.json');
    this.profilesPath = path.join(this.collectionsDirectory, 'profiles.json');
    this.legacyPath = path.join(dataDirectory, 'scene-collection.json');
  }

  async load(): Promise<StreamWorkspace> {
    const index = await this.ensureIndex();
    const profiles = await this.ensureProfiles(index);
    const project = this.withProfile(await this.readProject(index.activeCollectionId), this.activeProfile(profiles));
    return this.workspace(index, profiles, project);
  }

  save(collectionId: string, profileId: string, value: unknown): Promise<void> {
    const project = decodeProject(value);
    return this.serialize(async () => {
      const index = await this.ensureIndex();
      const profiles = await this.ensureProfiles(index);
      if (!index.collections.some((collection) => collection.id === collectionId)) throw new Error('The scene collection no longer exists.');
      if (profiles.activeProfileId !== profileId) throw new Error('The active profile changed before these settings could be saved.');
      const activeProfile = this.activeProfile(profiles);
      const nextProfiles: ProfileIndex = {
        ...profiles,
        profiles: profiles.profiles.map((profile) => profile.id === profileId
          ? { ...profile, output: project.output, hotkeys: project.hotkeys }
          : profile),
      };
      if (JSON.stringify(activeProfile.output) !== JSON.stringify(project.output)
        || JSON.stringify(activeProfile.hotkeys) !== JSON.stringify(project.hotkeys)) {
        await writeJsonAtomic(this.profilesPath, nextProfiles);
        this.profileIndex = nextProfiles;
      }
      await writeJsonAtomic(this.projectPath(collectionId), project);
    });
  }

  validateImportedProject(value: unknown): StreamProject {
    return decodeProject(value);
  }

  exportCollection(id: string): Promise<{ name: string; project: StreamProject }> {
    return this.serialize(async () => {
      const index = await this.ensureIndex();
      const collection = index.collections.find((item) => item.id === id);
      if (!collection) throw new Error('The scene collection does not exist.');
      return { name: collection.name, project: await this.readProject(id) };
    });
  }

  importCollection(nameValue: unknown, projectValue: unknown): Promise<StreamWorkspace> {
    const project = decodeProject(projectValue);
    const requestedName = validateCollectionName(nameValue);
    return this.serialize(async () => {
      const index = await this.ensureIndex();
      const profiles = await this.ensureProfiles(index);
      if (index.collections.length >= MAX_COLLECTIONS) throw new Error(`Stream supports up to ${MAX_COLLECTIONS} scene collections.`);
      const name = this.uniqueImportedCollectionName(index, requestedName);
      const collection = { id: crypto.randomUUID(), name };
      const importedProject = this.withProfile(project, this.activeProfile(profiles));
      await writeJsonAtomic(this.projectPath(collection.id), importedProject);
      const next: CollectionIndex = { ...index, activeCollectionId: collection.id, collections: [...index.collections, collection] };
      try {
        await writeJsonAtomic(this.indexPath, next);
      } catch (error) {
        await rm(this.projectPath(collection.id), { force: true });
        throw error;
      }
      this.collectionIndex = next;
      return this.workspace(next, profiles, importedProject);
    });
  }

  create(nameValue: unknown, duplicateCurrent: boolean): Promise<StreamWorkspace> {
    const name = validateCollectionName(nameValue);
    return this.serialize(async () => {
      const index = await this.ensureIndex();
      const profiles = await this.ensureProfiles(index);
      this.assertUniqueName(index, name);
      if (index.collections.length >= MAX_COLLECTIONS) throw new Error(`Stream supports up to ${MAX_COLLECTIONS} scene collections.`);
      const sourceProject = duplicateCurrent ? await this.readProject(index.activeCollectionId) : null;
      const project = this.withProfile(sourceProject ? duplicateProject(sourceProject) : createDefaultProject(), this.activeProfile(profiles));
      const collection = { id: crypto.randomUUID(), name };
      await writeJsonAtomic(this.projectPath(collection.id), project);
      const next: CollectionIndex = { ...index, activeCollectionId: collection.id, collections: [...index.collections, collection] };
      try {
        await writeJsonAtomic(this.indexPath, next);
      } catch (error) {
        await rm(this.projectPath(collection.id), { force: true });
        throw error;
      }
      this.collectionIndex = next;
      return this.workspace(next, profiles, project);
    });
  }

  activate(id: string): Promise<StreamWorkspace> {
    return this.serialize(async () => {
      const index = await this.ensureIndex();
      const profiles = await this.ensureProfiles(index);
      if (!index.collections.some((collection) => collection.id === id)) throw new Error('The scene collection does not exist.');
      const project = this.withProfile(await this.readProject(id), this.activeProfile(profiles));
      const next = { ...index, activeCollectionId: id };
      await writeJsonAtomic(this.indexPath, next);
      this.collectionIndex = next;
      return this.workspace(next, profiles, project);
    });
  }

  rename(id: string, nameValue: unknown): Promise<SceneCollectionSummary[]> {
    const name = validateCollectionName(nameValue);
    return this.serialize(async () => {
      const index = await this.ensureIndex();
      if (!index.collections.some((collection) => collection.id === id)) throw new Error('The scene collection does not exist.');
      this.assertUniqueName(index, name, id);
      const next = { ...index, collections: index.collections.map((collection) => collection.id === id ? { ...collection, name } : collection) };
      await writeJsonAtomic(this.indexPath, next);
      this.collectionIndex = next;
      return next.collections;
    });
  }

  delete(id: string): Promise<StreamWorkspace> {
    return this.serialize(async () => {
      const index = await this.ensureIndex();
      const profiles = await this.ensureProfiles(index);
      if (index.collections.length <= 1) throw new Error('The final scene collection cannot be deleted.');
      if (!index.collections.some((collection) => collection.id === id)) throw new Error('The scene collection does not exist.');
      const collections = index.collections.filter((collection) => collection.id !== id);
      const activeCollectionId = index.activeCollectionId === id ? collections[0]!.id : index.activeCollectionId;
      const project = this.withProfile(await this.readProject(activeCollectionId), this.activeProfile(profiles));
      const next: CollectionIndex = { ...index, activeCollectionId, collections };
      await writeJsonAtomic(this.indexPath, next);
      this.collectionIndex = next;
      void rm(this.projectPath(id), { force: true }).catch(() => undefined);
      return this.workspace(next, profiles, project);
    });
  }

  createProfile(nameValue: unknown, duplicateCurrent: boolean): Promise<StreamWorkspace> {
    const name = validateProfileName(nameValue);
    return this.serialize(async () => {
      const index = await this.ensureIndex();
      const profileIndex = await this.ensureProfiles(index);
      this.assertUniqueProfileName(profileIndex, name);
      if (profileIndex.profiles.length >= MAX_STREAM_PROFILES) throw new Error(`Stream supports up to ${MAX_STREAM_PROFILES} profiles.`);
      const current = this.activeProfile(profileIndex);
      const defaults = createDefaultProject();
      const profile: StreamProfile = {
        id: crypto.randomUUID(),
        name,
        output: duplicateCurrent ? { ...current.output, recordingAudioTracks: [...current.output.recordingAudioTracks] } : defaults.output,
        hotkeys: duplicateCurrent ? { ...current.hotkeys } : defaults.hotkeys,
      };
      const next: ProfileIndex = { ...profileIndex, activeProfileId: profile.id, profiles: [...profileIndex.profiles, profile] };
      await writeJsonAtomic(this.profilesPath, next);
      this.profileIndex = next;
      const project = this.withProfile(await this.readProject(index.activeCollectionId), profile);
      return this.workspace(index, next, project);
    });
  }

  activateProfile(id: string): Promise<StreamWorkspace> {
    return this.serialize(async () => {
      const index = await this.ensureIndex();
      const profileIndex = await this.ensureProfiles(index);
      const profile = profileIndex.profiles.find((item) => item.id === id);
      if (!profile) throw new Error('The profile does not exist.');
      const next = { ...profileIndex, activeProfileId: id };
      await writeJsonAtomic(this.profilesPath, next);
      this.profileIndex = next;
      const project = this.withProfile(await this.readProject(index.activeCollectionId), profile);
      return this.workspace(index, next, project);
    });
  }

  renameProfile(id: string, nameValue: unknown): Promise<StreamProfileSummary[]> {
    const name = validateProfileName(nameValue);
    return this.serialize(async () => {
      const index = await this.ensureIndex();
      const profileIndex = await this.ensureProfiles(index);
      if (!profileIndex.profiles.some((profile) => profile.id === id)) throw new Error('The profile does not exist.');
      this.assertUniqueProfileName(profileIndex, name, id);
      const next = { ...profileIndex, profiles: profileIndex.profiles.map((profile) => profile.id === id ? { ...profile, name } : profile) };
      await writeJsonAtomic(this.profilesPath, next);
      this.profileIndex = next;
      return next.profiles.map(({ id: profileId, name: profileName }) => ({ id: profileId, name: profileName }));
    });
  }

  deleteProfile(id: string): Promise<StreamWorkspace> {
    return this.serialize(async () => {
      const index = await this.ensureIndex();
      const profileIndex = await this.ensureProfiles(index);
      if (profileIndex.profiles.length <= 1) throw new Error('The final profile cannot be deleted.');
      if (!profileIndex.profiles.some((profile) => profile.id === id)) throw new Error('The profile does not exist.');
      const profiles = profileIndex.profiles.filter((profile) => profile.id !== id);
      const activeProfileId = profileIndex.activeProfileId === id ? profiles[0]!.id : profileIndex.activeProfileId;
      const next: ProfileIndex = { ...profileIndex, activeProfileId, profiles };
      await writeJsonAtomic(this.profilesPath, next);
      this.profileIndex = next;
      const project = this.withProfile(await this.readProject(index.activeCollectionId), this.activeProfile(next));
      return this.workspace(index, next, project);
    });
  }

  exportProfile(id: string): Promise<StreamProfileDocument> {
    return this.serialize(async () => {
      const index = await this.ensureIndex();
      const profileIndex = await this.ensureProfiles(index);
      const profile = profileIndex.profiles.find((item) => item.id === id);
      if (!profile) throw new Error('The profile does not exist.');
      return {
        format: 'lumastream-profile',
        version: 1,
        name: profile.name,
        output: { ...profile.output, recordingAudioTracks: [...profile.output.recordingAudioTracks] },
        hotkeys: { ...profile.hotkeys },
      };
    });
  }

  importProfile(value: unknown): Promise<StreamWorkspace> {
    return this.serialize(async () => {
      const document = decodeProfileDocument(value);
      const index = await this.ensureIndex();
      const profileIndex = await this.ensureProfiles(index);
      if (profileIndex.profiles.length >= MAX_STREAM_PROFILES) throw new Error(`Stream supports up to ${MAX_STREAM_PROFILES} profiles.`);
      const name = this.uniqueImportedProfileName(profileIndex, document.name);
      const profile: StreamProfile = {
        id: crypto.randomUUID(),
        name,
        output: { ...document.output, recordingAudioTracks: [...document.output.recordingAudioTracks] },
        hotkeys: { ...document.hotkeys },
      };
      const project = this.withProfile(await this.readProject(index.activeCollectionId), profile);
      const next: ProfileIndex = { ...profileIndex, activeProfileId: profile.id, profiles: [...profileIndex.profiles, profile] };
      await writeJsonAtomic(this.profilesPath, next);
      this.profileIndex = next;
      return this.workspace(index, next, project);
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async ensureIndex(): Promise<CollectionIndex> {
    if (this.collectionIndex) return this.collectionIndex;
    await mkdir(this.collectionsDirectory, { recursive: true });
    try {
      const bytes = await readFile(this.indexPath);
      if (bytes.byteLength > 1024 * 1024) throw new Error('The scene-collection index is too large to open.');
      this.collectionIndex = decodeCollectionIndex(JSON.parse(bytes.toString('utf8')));
      return this.collectionIndex;
    } catch (error) {
      if (!isRecord(error) || error.code !== 'ENOENT') throw error;
    }

    let initial = createDefaultProject();
    try {
      const bytes = await readFile(this.legacyPath);
      if (bytes.byteLength > MAX_PROJECT_BYTES) throw new Error('Stream project is too large to open.');
      initial = decodeProject(JSON.parse(bytes.toString('utf8')));
    } catch (error) {
      if (!isRecord(error) || error.code !== 'ENOENT') throw error;
    }
    const collection = { id: crypto.randomUUID(), name: 'Scene Collection' };
    const index: CollectionIndex = { version: 1, activeCollectionId: collection.id, collections: [collection] };
    await writeJsonAtomic(this.projectPath(collection.id), initial);
    await writeJsonAtomic(this.indexPath, index);
    this.collectionIndex = index;
    return index;
  }

  private async ensureProfiles(index: CollectionIndex): Promise<ProfileIndex> {
    if (this.profileIndex) return this.profileIndex;
    try {
      const bytes = await readFile(this.profilesPath);
      if (bytes.byteLength > 4 * 1024 * 1024) throw new Error('The profile index is too large to open.');
      this.profileIndex = decodeProfileIndex(JSON.parse(bytes.toString('utf8')));
      return this.profileIndex;
    } catch (error) {
      if (!isRecord(error) || error.code !== 'ENOENT') throw error;
    }

    const legacyProject = await this.readProject(index.activeCollectionId);
    const profileId = crypto.randomUUID();
    const initial: ProfileIndex = {
      version: 1,
      activeProfileId: profileId,
      profiles: [{ id: profileId, name: 'Profile 1', output: legacyProject.output, hotkeys: legacyProject.hotkeys }],
    };
    await writeJsonAtomic(this.profilesPath, initial);
    this.profileIndex = initial;
    return initial;
  }

  private activeProfile(index: ProfileIndex): StreamProfile {
    const profile = index.profiles.find((item) => item.id === index.activeProfileId);
    if (!profile) throw new Error('The active profile does not exist.');
    return profile;
  }

  private withProfile(project: StreamProject, profile: StreamProfile): StreamProject {
    return {
      ...project,
      output: { ...profile.output, recordingAudioTracks: [...profile.output.recordingAudioTracks] },
      hotkeys: { ...profile.hotkeys },
    };
  }

  private workspace(index: CollectionIndex, profileIndex: ProfileIndex, project: StreamProject): StreamWorkspace {
    return {
      activeCollectionId: index.activeCollectionId,
      collections: index.collections.map(({ id, name }) => ({ id, name })),
      activeProfileId: profileIndex.activeProfileId,
      profiles: profileIndex.profiles.map(({ id, name }) => ({ id, name })),
      project,
    };
  }

  private async readProject(id: string): Promise<StreamProject> {
    const bytes = await readFile(this.projectPath(id));
    if (bytes.byteLength > MAX_PROJECT_BYTES) throw new Error('Stream project is too large to open.');
    return decodeProject(JSON.parse(bytes.toString('utf8')));
  }

  private projectPath(id: string): string {
    if (!COLLECTION_ID_PATTERN.test(id)) throw new Error('Invalid scene collection ID.');
    return path.join(this.collectionsDirectory, `${id}.json`);
  }

  private assertUniqueName(index: CollectionIndex, name: string, exceptId?: string): void {
    if (index.collections.some((collection) => collection.id !== exceptId && collection.name.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'))) {
      throw new Error('A scene collection with that name already exists.');
    }
  }

  private uniqueImportedCollectionName(index: CollectionIndex, originalName: string): string {
    const names = new Set(index.collections.map((collection) => collection.name.toLocaleLowerCase('en-US')));
    if (!names.has(originalName.toLocaleLowerCase('en-US'))) return originalName;
    for (let suffix = 2; suffix <= MAX_COLLECTIONS + 1; suffix++) {
      const marker = ` (${suffix})`;
      const candidate = `${originalName.slice(0, 80 - marker.length)}${marker}`;
      if (!names.has(candidate.toLocaleLowerCase('en-US'))) return candidate;
    }
    throw new Error('A unique imported collection name could not be created.');
  }

  private assertUniqueProfileName(index: ProfileIndex, name: string, exceptId?: string): void {
    if (index.profiles.some((profile) => profile.id !== exceptId && profile.name.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'))) {
      throw new Error('A profile with that name already exists.');
    }
  }

  private uniqueImportedProfileName(index: ProfileIndex, originalName: string): string {
    const names = new Set(index.profiles.map((profile) => profile.name.toLocaleLowerCase('en-US')));
    if (!names.has(originalName.toLocaleLowerCase('en-US'))) return originalName;
    for (let suffix = 2; suffix <= MAX_STREAM_PROFILES + 1; suffix++) {
      const marker = ` (${suffix})`;
      const candidate = `${originalName.slice(0, 80 - marker.length)}${marker}`;
      if (!names.has(candidate.toLocaleLowerCase('en-US'))) return candidate;
    }
    throw new Error('A unique imported profile name could not be created.');
  }
}
