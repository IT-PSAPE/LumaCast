import { randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultPlaybackSettings, type Sound, type SoundBoard, type SoundLibrary, type SoundPlaybackSettings, type SoundShortcut } from '../shared/desktop-api';

export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'] as const;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_CODES = /^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Numpad[0-9]|Space|Enter|Escape|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Arrow(?:Up|Down|Left|Right)|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Backquote|Comma|Period|Slash|Numpad(?:Add|Subtract|Multiply|Divide|Decimal|Enter|Equal|ParenLeft|ParenRight)|Intl(?:Backslash|Ro|Yen)|ContextMenu|PrintScreen|ScrollLock|Pause)$/;

function validName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validShortcut(value: unknown): value is SoundShortcut {
  return isRecord(value) &&
    Object.keys(value).length === 5 && Object.keys(value).every((key) => ['code', 'ctrl', 'alt', 'shift', 'meta'].includes(key)) &&
    typeof value.code === 'string' && KEY_CODES.test(value.code) &&
    typeof value.ctrl === 'boolean' && typeof value.alt === 'boolean' &&
    typeof value.shift === 'boolean' && typeof value.meta === 'boolean';
}

function parsePlayback(value: unknown): SoundPlaybackSettings {
  if (!isRecord(value) || Object.keys(value).length !== 4 || Object.keys(value).some((key) => !['startTime', 'endTime', 'loop', 'shortcut'].includes(key)) ||
      typeof value.startTime !== 'number' || !Number.isFinite(value.startTime) || value.startTime < 0 ||
      !(value.endTime === null || (typeof value.endTime === 'number' && Number.isFinite(value.endTime) && value.endTime > value.startTime)) ||
      typeof value.loop !== 'boolean' || !(value.shortcut === null || validShortcut(value.shortcut))) {
    throw new Error('Sound library contains invalid playback settings.');
  }
  return {
    startTime: value.startTime,
    endTime: value.endTime,
    loop: value.loop,
    shortcut: value.shortcut === null ? null : { ...value.shortcut },
  };
}

function shortcutKey(value: SoundShortcut): string {
  return `${value.code}|${Number(value.ctrl)}|${Number(value.alt)}|${Number(value.shift)}|${Number(value.meta)}`;
}

function parseLibrary(value: unknown): { library: SoundLibrary; migrated: boolean } {
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2) || !Array.isArray(value.boards)) {
    throw new Error('Sound library has an unsupported or invalid format.');
  }
  const sourceVersion = value.version;
  if (Object.keys(value).some((key) => key !== 'version' && key !== 'boards')) throw new Error('Sound library has an invalid shape.');
  const ids = new Set<string>();
  const boards: SoundBoard[] = value.boards.map((entry) => {
    if (!isRecord(entry) || Object.keys(entry).some((key) => !['id', 'name', 'sounds'].includes(key)) || typeof entry.id !== 'string' || !ID_PATTERN.test(entry.id) ||
        !validName(entry.name) || !Array.isArray(entry.sounds) || ids.has(entry.id)) {
      throw new Error('Sound library contains an invalid board.');
    }
    ids.add(entry.id);
    const shortcuts = new Set<string>();
    const sounds: Sound[] = entry.sounds.map((item) => {
      if (!isRecord(item) || Object.keys(item).some((key) => !['id', 'name', 'fileName', ...(sourceVersion === 2 ? ['playback'] : [])].includes(key)) || typeof item.id !== 'string' || !ID_PATTERN.test(item.id) ||
          !validName(item.name) || typeof item.fileName !== 'string' ||
          !new RegExp(`^${item.id}\\.(?:${AUDIO_EXTENSIONS.join('|')})$`, 'i').test(item.fileName) || ids.has(item.id)) {
        throw new Error('Sound library contains an invalid sound.');
      }
      ids.add(item.id);
      const playback = sourceVersion === 1 || item.playback === undefined ? defaultPlaybackSettings() : parsePlayback(item.playback);
      if (playback.shortcut) {
        const key = shortcutKey(playback.shortcut);
        if (shortcuts.has(key)) throw new Error('Sound library contains duplicate shortcuts in a board.');
        shortcuts.add(key);
      }
      return { id: item.id, name: item.name.trim(), fileName: item.fileName, playback };
    });
    return { id: entry.id, name: entry.name.trim(), sounds };
  });
  return { library: { version: 2, boards }, migrated: sourceVersion === 1 };
}

async function writeAtomically(filePath: string, content: string): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${randomUUID()}`;
  await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export class LibraryStore {
  private mutationQueue: Promise<unknown> = Promise.resolve();
  private initialized: Promise<SoundLibrary> | null = null;

  constructor(private readonly directory: string, private readonly removeManagedFile: (filePath: string) => Promise<unknown> = (filePath) => unlink(filePath)) {}

  private get libraryPath(): string { return path.join(this.directory, 'library.json'); }
  private get audioDirectory(): string { return path.join(this.directory, 'audio'); }

  private loadOnce(): Promise<SoundLibrary> {
    if (!this.initialized) {
      const pending = (async () => {
        await mkdir(this.audioDirectory, { recursive: true });
        let serialized: string;
        try {
          serialized = await readFile(this.libraryPath, 'utf8');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            const empty: SoundLibrary = { version: 2, boards: [] };
            await writeAtomically(this.libraryPath, JSON.stringify(empty, null, 2));
            return empty;
          }
          throw error;
        }
        const parsed = parseLibrary(JSON.parse(serialized) as unknown);
        if (parsed.migrated) await writeAtomically(this.libraryPath, JSON.stringify(parsed.library, null, 2));
        return parsed.library;
      })();
      this.initialized = pending;
      void pending.catch(() => {
        if (this.initialized === pending) this.initialized = null;
      });
    }
    return this.initialized;
  }

  async load(): Promise<SoundLibrary> {
    return structuredClone(await this.loadOnce());
  }

  private mutate<T>(operation: (library: SoundLibrary) => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(async () => {
      const library = structuredClone(await this.loadOnce());
      try {
        const value = await operation(library);
        this.initialized = Promise.resolve(library);
        return value;
      } catch (error) {
        this.initialized = null;
        throw error;
      }
    });
    this.mutationQueue = result.catch(() => undefined);
    return result;
  }

  private async save(library: SoundLibrary): Promise<void> {
    await writeAtomically(this.libraryPath, JSON.stringify(library, null, 2));
  }

  createBoard(name: string): Promise<SoundLibrary> {
    if (!validName(name)) return Promise.reject(new Error('Board name must contain 1 to 100 characters.'));
    return this.mutate(async (library) => {
      library.boards.push({ id: randomUUID(), name: name.trim(), sounds: [] });
      await this.save(library);
      return structuredClone(library);
    });
  }

  renameBoard(boardId: string, name: string): Promise<SoundLibrary> {
    if (!ID_PATTERN.test(boardId) || !validName(name)) return Promise.reject(new Error('Board ID or name is invalid.'));
    return this.mutate(async (library) => {
      const board = library.boards.find((item) => item.id === boardId);
      if (!board) throw new Error('Board was not found.');
      board.name = name.trim();
      await this.save(library);
      return structuredClone(library);
    });
  }

  removeBoard(boardId: string): Promise<SoundLibrary> {
    if (!ID_PATTERN.test(boardId)) return Promise.reject(new Error('Board ID is invalid.'));
    return this.mutate(async (library) => {
      const index = library.boards.findIndex((item) => item.id === boardId);
      if (index < 0) throw new Error('Board was not found.');
      const [removed] = library.boards.splice(index, 1);
      await this.save(library);
      await Promise.all(removed.sounds.map((sound) => this.removeManagedFile(path.join(this.audioDirectory, sound.fileName)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') console.warn('[soundboard] removed board metadata but could not delete managed audio', error);
      })));
      return structuredClone(library);
    });
  }

  importSounds(boardId: string, sourcePaths: string[]): Promise<SoundLibrary> {
    if (!ID_PATTERN.test(boardId)) return Promise.reject(new Error('Board ID is invalid.'));
    return this.mutate(async (library) => {
      const board = library.boards.find((item) => item.id === boardId);
      if (!board) throw new Error('Board was not found.');
      const additions: Sound[] = [];
      const copiedPaths: string[] = [];
      try {
        for (const sourcePath of sourcePaths) {
          const extension = path.extname(sourcePath).slice(1).toLowerCase();
          if (!(AUDIO_EXTENSIONS as readonly string[]).includes(extension)) throw new Error(`Unsupported audio file: ${path.basename(sourcePath)}`);
          const sourceStats = await lstat(sourcePath);
          if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) throw new Error(`Not a regular audio file: ${path.basename(sourcePath)}`);
          const id = randomUUID();
          const fileName = `${id}.${extension}`;
          const destination = path.join(this.audioDirectory, fileName);
          await copyFile(sourcePath, destination);
          copiedPaths.push(destination);
          const importedName = path.basename(sourcePath, path.extname(sourcePath)).trim();
          additions.push({ id, name: importedName.slice(0, 100).trim() || 'Untitled sound', fileName, playback: defaultPlaybackSettings() });
        }
        board.sounds.push(...additions);
        await this.save(library);
        return structuredClone(library);
      } catch (error) {
        await Promise.all(copiedPaths.map((filePath) => unlink(filePath).catch(() => undefined)));
        throw error;
      }
    });
  }

  removeSound(boardId: string, soundId: string): Promise<SoundLibrary> {
    if (!ID_PATTERN.test(boardId) || !ID_PATTERN.test(soundId)) return Promise.reject(new Error('Board or sound ID is invalid.'));
    return this.mutate(async (library) => {
      const board = library.boards.find((item) => item.id === boardId);
      if (!board) throw new Error('Board was not found.');
      const index = board.sounds.findIndex((item) => item.id === soundId);
      if (index < 0) throw new Error('Sound was not found.');
      const [removed] = board.sounds.splice(index, 1);
      await this.save(library);
      await this.removeManagedFile(path.join(this.audioDirectory, removed.fileName)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') console.warn('[soundboard] removed sound metadata but could not delete managed audio', error);
      });
      return structuredClone(library);
    });
  }

  updateSound(boardId: string, soundId: string, settings: SoundPlaybackSettings): Promise<SoundLibrary> {
    if (!ID_PATTERN.test(boardId) || !ID_PATTERN.test(soundId)) return Promise.reject(new Error('Board or sound ID is invalid.'));
    let playback: SoundPlaybackSettings;
    try {
      playback = parsePlayback(settings);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.mutate(async (library) => {
      const board = library.boards.find((item) => item.id === boardId);
      if (!board) throw new Error('Board was not found.');
      const sound = board.sounds.find((item) => item.id === soundId);
      if (!sound) throw new Error('Sound was not found.');
      if (playback.shortcut) {
        const key = shortcutKey(playback.shortcut);
        if (board.sounds.some((item) => item.id !== soundId && item.playback?.shortcut && shortcutKey(item.playback.shortcut) === key)) {
          throw new Error('Shortcut is already assigned on this board.');
        }
      }
      sound.playback = playback;
      await this.save(library);
      return structuredClone(library);
    });
  }
}
