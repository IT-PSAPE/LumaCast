import type { Sound, SoundPlaybackSettings } from "../shared/desktop-api";

export type AudioPort = Pick<HTMLAudioElement, "currentTime" | "duration" | "paused" | "loop" | "play" | "pause" | "addEventListener" | "removeEventListener" | "src" | "load">;
export type AudioFactory = (sound: Sound) => AudioPort;
export type TileControls = { stop: () => void; toggle: () => void };
export type RegisterTile = (id: string, controls: TileControls | null) => void;

// An intent changes only the supplied fields. The library owner merges it with
// canonical settings once the write slot is available.
// Coalesced continuations preserve errors from earlier writes in the same edit.
export type SaveSoundSettings = (soundId: string, intent: Partial<SoundPlaybackSettings>, options?: { preserveError?: boolean }) => Promise<"saved" | "failed" | "discarded">;
