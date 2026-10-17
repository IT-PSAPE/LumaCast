export interface SoundShortcut {
  code: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

export interface SoundPlaybackSettings {
  startTime: number;
  endTime: number | null;
  loop: boolean;
  shortcut: SoundShortcut | null;
}

export function defaultPlaybackSettings(): SoundPlaybackSettings {
  return { startTime: 0, endTime: null, loop: false, shortcut: null };
}

export interface Sound {
  id: string;
  name: string;
  fileName: string;
  playback?: SoundPlaybackSettings;
}

export interface SoundBoard {
  id: string;
  name: string;
  sounds: Sound[];
}

export interface SoundLibrary {
  version: 2;
  boards: SoundBoard[];
}

export interface SoundboardAPI {
  load(): Promise<SoundLibrary>;
  createBoard(name: string): Promise<SoundLibrary>;
  renameBoard(boardId: string, name: string): Promise<SoundLibrary>;
  importSounds(boardId: string): Promise<SoundLibrary>;
  removeSound(boardId: string, soundId: string): Promise<SoundLibrary>;
  updateSound(boardId: string, soundId: string, settings: SoundPlaybackSettings): Promise<SoundLibrary>;
}

export function soundUrl(soundId: string): string {
  return `lumasoundboard://audio/${encodeURIComponent(soundId)}`;
}
