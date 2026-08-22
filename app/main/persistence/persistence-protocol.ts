import type { CastRepository, RepositoryOptions } from '@lumacast/persistence-sqlite';
import type { ProjectBackup } from '@lumacast/protocol';

export const PERSISTENCE_METHODS = [
  'getSnapshot',
  'listCues',
  'createCue',
  'updateCue',
  'deleteCue',
  'listMacros',
  'createMacro',
  'updateMacro',
  'deleteMacro',
  'setMacroOrder',
  'listTriggerBindings',
  'createTriggerBinding',
  'deleteTriggerBinding',
  'applyPatch',
  'restoreFromSnapshot',
  'exportBundle',
  'inspectImportBundle',
  'finalizeImportBundle',
  'createPlaylist',
  'createSeparator',
  'renameSeparator',
  'setSeparatorColor',
  'movePlaylistRow',
  'removePlaylistRow',
  'addItemToPlaylist',
  'createPresentation',
  'createLyric',
  'createTalk',
  'createTheme',
  'updateTheme',
  'deleteTheme',
  'applyThemeToItem',
  'syncThemeToLinkedItems',
  'detachThemeFromItem',
  'applyThemeToOverlay',
  'createItem',
  'duplicateItem',
  'movePresentation',
  'moveLyric',
  'moveTalk',
  'movePlaylist',
  'setPlaylistOrder',
  'deletePlaylist',
  'deletePresentation',
  'deleteLyric',
  'deleteTalk',
  'renamePlaylist',
  'renamePresentation',
  'renameLyric',
  'renameTalk',
  'createSlide',
  'deleteSlide',
  'updateSlideNotes',
  'updateSlideBackground',
  'createTalkScriptBlock',
  'updateTalkScriptBlock',
  'deleteTalkScriptBlock',
  'setTalkScriptBlockOrder',
  'duplicateSlide',
  'setSlideOrder',
  'createElement',
  'createElementsBatch',
  'updateElement',
  'updateElementsBatch',
  'deleteElement',
  'deleteElementsBatch',
  'createMediaAsset',
  'deleteMediaAsset',
  'updateMediaAssetSrc',
  'getMediaAsset',
  'buildMediaAssetPatch',
  'updateMediaAssetMetadata',
  'createOverlay',
  'updateOverlay',
  'setOverlayEnabled',
  'deleteOverlay',
  'setOverlayOrder',
  'createStage',
  'updateStage',
  'deleteStage',
  'setStageOrder',
  'setThemeOrder',
  'duplicateStage',
  'exportProjectBackup',
  'validateProjectBackup',
  'restoreProjectBackup',
] as const satisfies readonly RepositoryMethodName[];

type AnyFunction = (...args: never[]) => unknown;
type RepositoryMethodName = {
  [Key in keyof CastRepository]: Key extends 'close'
    ? never
    : CastRepository[Key] extends AnyFunction ? Key : never;
}[keyof CastRepository] & string;

export type PersistenceMethodName = typeof PERSISTENCE_METHODS[number];

type Assert<T extends true> = T;
export type PersistenceVocabularyIsExhaustive = Assert<
  Exclude<RepositoryMethodName, PersistenceMethodName> extends never ? true : false
>;

type RepositoryMethod<Key extends PersistenceMethodName> = Extract<CastRepository[Key], AnyFunction>;

type AsyncPersistenceMethods = {
  [Key in PersistenceMethodName]: (
    ...args: Parameters<RepositoryMethod<Key>>
  ) => Promise<Awaited<ReturnType<RepositoryMethod<Key>>>>;
};

export type PersistenceServiceLike = Omit<AsyncPersistenceMethods, 'restoreProjectBackup'> & {
  restoreProjectBackup: (
    backup: ProjectBackup,
  ) => Promise<Awaited<ReturnType<RepositoryMethod<'restoreProjectBackup'>>>>;
};

export type PersistenceRepositoryOptions = Omit<RepositoryOptions, 'onProgress'>;

export interface SerializedPersistenceError {
  name: string;
  message: string;
  stack?: string;
  code?: string | number;
  foundVersion?: number;
  supportedVersion?: number;
}

export interface PersistenceProgressPayload {
  operation: 'initialize' | PersistenceMethodName;
  phase: string;
  completed?: number;
  total?: number;
}

export interface PersistenceProgress extends PersistenceProgressPayload {
  requestId?: number;
}

export type PersistenceHostCommand =
  | { type: 'initialize'; options: PersistenceRepositoryOptions }
  | { type: 'call'; requestId: number; method: PersistenceMethodName; args: unknown[] }
  | { type: 'shutdown'; requestId: number };

export type PersistenceHostEvent =
  | { type: 'ready' }
  | { type: 'result'; requestId: number; result: unknown }
  | { type: 'error'; requestId: number; error: SerializedPersistenceError }
  | { type: 'progress'; requestId?: number; progress: PersistenceProgressPayload }
  | { type: 'closed'; requestId: number }
  | { type: 'fatal'; error: SerializedPersistenceError };

const PERSISTENCE_METHOD_SET = new Set<string>(PERSISTENCE_METHODS);

export function isPersistenceMethodName(value: string): value is PersistenceMethodName {
  return PERSISTENCE_METHOD_SET.has(value);
}

export function cloneForPersistenceTransport<T>(value: T, description: string): T {
  try {
    return structuredClone(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new TypeError(`${description} is not structured clone-safe: ${detail}`);
  }
}

export function serializePersistenceError(error: unknown): SerializedPersistenceError {
  if (!(error instanceof Error)) {
    return { name: 'Error', message: String(error) };
  }

  const source = error as Error & {
    code?: unknown;
    foundVersion?: unknown;
    supportedVersion?: unknown;
  };
  const serialized: SerializedPersistenceError = {
    name: error.name || 'Error',
    message: error.message,
  };
  if (error.stack) serialized.stack = error.stack;
  if (typeof source.code === 'string' || typeof source.code === 'number') serialized.code = source.code;
  if (typeof source.foundVersion === 'number') serialized.foundVersion = source.foundVersion;
  if (typeof source.supportedVersion === 'number') serialized.supportedVersion = source.supportedVersion;
  return serialized;
}

export function deserializePersistenceError(error: SerializedPersistenceError): Error {
  const restored = new Error(error.message) as Error & {
    code?: string | number;
    foundVersion?: number;
    supportedVersion?: number;
  };
  restored.name = error.name;
  if (error.stack) restored.stack = error.stack;
  if (error.code !== undefined) restored.code = error.code;
  if (error.foundVersion !== undefined) restored.foundVersion = error.foundVersion;
  if (error.supportedVersion !== undefined) restored.supportedVersion = error.supportedVersion;
  return restored;
}
