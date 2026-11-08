import { createContext, use, useEffect, type KeyboardEvent, type ReactNode } from "react";
import { AudioLines, CircleStop, Ellipsis, Pause, Play, Repeat } from "lucide-react";
import { Banner, ContextMenu, DropdownMenu, RangeSlider, ReacstButton as Button, useContextMenuTrigger, type MenuEntry } from "@lumacast/ui";
import { defaultPlaybackSettings, type Sound, type SoundPlaybackSettings } from "../shared/desktop-api";
import type { AudioFactory, RegisterTile, SaveSoundSettings } from "./sound-ports";
import { isTextEntryTarget, shortcutLabel, useShortcutRecording } from "./sound-shortcuts";
import { useSoundPlayer } from "./use-sound-player";
import { MIN_RANGE, useSoundRange } from "./use-sound-range";

type Modifiers = { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean };
type SoundTileProps = {
  sound: Sound;
  index: number;
  busy: boolean;
  selected: boolean;
  onSelectionClick: (id: string, modifiers: Modifiers) => void;
  onSelectionToggle: (id: string, checked: boolean) => void;
  onContextMenuTarget: (id: string) => void;
  onRemove: () => void;
  onUpdate: SaveSoundSettings;
  recording: boolean;
  onRecordingChange: (recording: boolean) => void;
  audioFactory: AudioFactory;
  register: RegisterTile;
};

type SoundTileContextValue = {
  state: {
    sound: Sound; index: number; busy: boolean; recording: boolean;
    settings: SoundPlaybackSettings; shortcutText: string | null;
    playing: boolean; current: number; duration: number; error: string; canPlay: boolean;
    range: [number, number]; trackMax: number; canEdit: boolean; trimmed: boolean;
  };
  actions: {
    toggle: () => void; stop: () => void; seek: (value: number) => void; readPlayhead: () => number;
    changeRange: (range: [number, number]) => void; commitRange: (range: [number, number]) => void; cancelRangePreview: () => void;
    markIn: () => void; markOut: () => void; resetRange: () => void;
    changeLoop: (loop: boolean) => void; clearShortcut: () => void; setRecording: (recording: boolean) => void;
  };
};
const SoundTileContext = createContext<SoundTileContextValue | null>(null);
function useSoundTile() {
  const value = use(SoundTileContext);
  if (!value) throw new Error("Sound tile parts require a sound tile provider.");
  return value;
}

// The sound's resource and edit lifetimes live above its composed UI parts.
// Context exposes the product state/actions, without audio elements or refs.
function SoundTileProvider({ sound, index, busy, recording, onRecordingChange, onUpdate, audioFactory, register, children }: Pick<SoundTileProps, "sound" | "index" | "busy" | "recording" | "onRecordingChange" | "onUpdate" | "audioFactory" | "register"> & { children: ReactNode }) {
  const settings = sound.playback ?? defaultPlaybackSettings();
  const player = useSoundPlayer({ sound, settings, busy, audioFactory });
  const range = useSoundRange({ soundId: sound.id, settings, duration: player.duration, readPlayhead: player.readPlayhead, save: onUpdate });
  useShortcutRecording({ soundId: sound.id, recording, onRecordingChange, save: onUpdate });
  useEffect(() => {
    register(sound.id, { stop: player.stop, toggle: player.toggle });
    return () => register(sound.id, null);
  }, [register, sound.id, player.stop, player.toggle]);

  const value: SoundTileContextValue = {
    state: {
      sound, index, busy, recording, settings, shortcutText: settings.shortcut ? shortcutLabel(settings.shortcut) : null,
      playing: player.playing, current: player.current, duration: player.duration, error: player.error, canPlay: player.canPlay,
      range: range.range, trackMax: range.trackMax, canEdit: range.canEdit, trimmed: range.trimmed,
    },
    actions: {
      toggle: player.toggle, stop: player.stop, seek: player.seek, readPlayhead: player.readPlayhead,
      changeRange: range.change, commitRange: (next) => { void range.commit(next); }, cancelRangePreview: range.cancelPreview,
      markIn: range.markIn, markOut: range.markOut, resetRange: range.reset,
      changeLoop: (loop) => { void onUpdate(sound.id, { loop }); },
      clearShortcut: () => { void onUpdate(sound.id, { shortcut: null }); },
      setRecording: onRecordingChange,
    },
  };
  return <SoundTileContext value={value}>{children}</SoundTileContext>;
}

export function SoundTile(props: SoundTileProps) {
  return <ContextMenu.Root>
    <SoundTileProvider sound={props.sound} index={props.index} busy={props.busy} recording={props.recording} onRecordingChange={props.onRecordingChange} onUpdate={props.onUpdate} audioFactory={props.audioFactory} register={props.register}>
      <SoundTileFrame selected={props.selected} onSelectionClick={props.onSelectionClick} onContextMenuTarget={props.onContextMenuTarget} onRemove={props.onRemove}>
        <SoundTileHeader selected={props.selected} onSelectionToggle={props.onSelectionToggle} onRemove={props.onRemove} />
        <SoundTileRange />
        <SoundTileTransport />
        <SoundTileFeedback />
      </SoundTileFrame>
      <ContextMenu.Portal><ContextMenu.Menu aria-label={`Actions for ${props.sound.name}`}>
        <ContextMenu.Item variant="destructive" onSelect={props.onRemove}>{props.selected ? "Remove selected sounds" : "Remove sound"}</ContextMenu.Item>
      </ContextMenu.Menu></ContextMenu.Portal>
    </SoundTileProvider>
  </ContextMenu.Root>;
}

function SoundTileFrame({ selected, onSelectionClick, onContextMenuTarget, onRemove, children }: Pick<SoundTileProps, "selected" | "onSelectionClick" | "onContextMenuTarget" | "onRemove"> & { children: ReactNode }) {
  const { state: { sound, index, playing }, actions } = useSoundTile();
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger({ onDelete: onRemove });
  const onCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // React portal events bubble here too; only keys from inside the card count.
    if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    if (!event.currentTarget.contains(event.target as Node) || isTextEntryTarget(event.target)) return;
    if (event.code === "KeyI") { event.preventDefault(); actions.markIn(); }
    else if (event.code === "KeyO") { event.preventDefault(); actions.markOut(); }
    else if ((event.code === "ArrowLeft" || event.code === "ArrowRight") && (event.target as Element).closest("[data-transport]")) {
      event.preventDefault();
      actions.seek(actions.readPlayhead() + (event.code === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 5 : 1));
    }
  };

  return <article {...triggerHandlers} ref={triggerRef} role="group" data-sound-id={sound.id} data-multi-selected={selected ? "true" : undefined} aria-label={`Sound ${sound.name}${selected ? ", selected for group actions" : ""}`} className={`sound-card group ${playing ? "is-playing" : ""} ${selected ? "is-multi-selected" : ""}`} style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }} onContextMenuCapture={() => onContextMenuTarget(sound.id)} onTouchStartCapture={() => onContextMenuTarget(sound.id)} onKeyDownCapture={(event) => {
    if (event.target instanceof Element && event.target.closest("[data-sound-selection]") && (event.key === " " || event.key === "Enter") && (event.shiftKey || event.metaKey || event.ctrlKey)) {
      onSelectionClick(sound.id, { shiftKey: event.shiftKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey });
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) onContextMenuTarget(sound.id);
  }} onClickCapture={(event) => {
    if (!event.shiftKey && !event.metaKey && !event.ctrlKey) return;
    onSelectionClick(sound.id, { shiftKey: event.shiftKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey });
    event.preventDefault();
    event.stopPropagation();
  }} onKeyDown={(event) => { triggerHandlers.onKeyDown?.(event); onCardKeyDown(event); }}>
    {children}
  </article>;
}

const reveal = "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100";

function SoundTileHeader({ selected, onSelectionToggle, onRemove }: Pick<SoundTileProps, "selected" | "onSelectionToggle" | "onRemove">) {
  const { state: { sound, index, busy, recording, settings, shortcutText, canEdit, trimmed }, actions } = useSoundTile();
  const menuEntries: MenuEntry[] = [
    { id: "in", label: "Set in at playhead", shortcut: "I", onSelect: actions.markIn, disabled: !canEdit },
    { id: "out", label: "Set out at playhead", shortcut: "O", onSelect: actions.markOut, disabled: !canEdit },
    { id: "reset", label: "Reset range", onSelect: actions.resetRange, disabled: !canEdit || !trimmed },
    { separator: true },
    { id: "loop", label: "Loop range", checked: settings.loop, onSelect: () => actions.changeLoop(!settings.loop), disabled: busy },
    { separator: true },
    { id: "record", label: recording ? "Cancel shortcut recording" : shortcutText ? `Change shortcut (${shortcutText})` : "Record shortcut", onSelect: () => actions.setRecording(!recording), disabled: busy },
    { id: "clear", label: "Clear shortcut", onSelect: actions.clearShortcut, disabled: busy || !settings.shortcut },
    { separator: true },
    { id: "remove", label: selected ? "Remove selected sounds" : "Remove sound", danger: true, onSelect: onRemove, disabled: busy },
  ];
  return <div className="card-head">
    <input data-sound-selection="" type="checkbox" className="size-4 shrink-0 accent-brand focus-visible:outline-2 focus-visible:outline-brand" aria-label={`Select sound ${sound.name}`} checked={selected} disabled={busy} onChange={(event) => onSelectionToggle(sound.id, event.currentTarget.checked)} />
    <div className={`sound-art art-${index % 5}`}><AudioLines size={16} /></div>
    <div className="sound-copy"><h2 title={sound.name}>{sound.name}</h2><p>{recording
      ? <Button size="xs" variant="take" label={`Cancel shortcut recording for ${sound.name}`} onClick={() => actions.setRecording(false)}>Press a key · Esc</Button>
      : <>{audioType(sound.fileName)}{shortcutText && <> · <kbd>{shortcutText}</kbd></>}</>}</p></div>
    <DropdownMenu align="end" entries={menuEntries} trigger={<Button.Icon label={`More actions for ${sound.name}`} variant="ghost" size="sm" className={`${reveal} aria-expanded:opacity-100`}><Ellipsis /></Button.Icon>} />
  </div>;
}

function SoundTileRange() {
  const { state: { sound, busy, settings, range, trackMax, canEdit, current }, actions } = useSoundTile();
  return <>
    <div className="range-row">
      <RangeSlider size="sm" label={`Range of ${sound.name}`} labelPlacement="hidden" startLabel={`Start of ${sound.name}`} endLabel={`End of ${sound.name}`} min={0} max={trackMax} step={0.01} minRange={MIN_RANGE} value={range} playhead={canEdit ? current : undefined} disabled={!canEdit} formatValue={formatTimestamp} onValueChange={actions.changeRange} onCommit={actions.commitRange} onCancel={actions.cancelRangePreview} onSeek={actions.seek} />
      <Button.Icon size="sm" variant="ghost" pressed={settings.loop} label={`Loop ${sound.name}`} onClick={() => actions.changeLoop(!settings.loop)} disabled={busy}><Repeat /></Button.Icon>
    </div>
    <div className="time-row"><span>{formatTimestamp(range[0]) || "0:00"}</span><span>{formatTime(current)}</span><span>{formatTimestamp(range[1]) || "0:00"}</span></div>
  </>;
}

function SoundTileTransport() {
  const { state: { sound, busy, settings, playing, current, canPlay, canEdit }, actions } = useSoundTile();
  return <div className="card-controls">
    <Button.Icon data-transport="" variant="primary" size="xl" shape="pill" label={playing ? `Pause ${sound.name}` : current > settings.startTime ? `Resume ${sound.name}` : `Play ${sound.name}`} onClick={actions.toggle} disabled={busy || !canPlay}>{playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</Button.Icon>
    <Button.Icon data-transport="" label={`Stop ${sound.name}`} variant="ghost" size="xl" onClick={actions.stop} disabled={busy || !playing && current === settings.startTime}><CircleStop /></Button.Icon>
    <div className={`mark-buttons ${reveal}`}>
      <Button size="xs" variant="ghost" label={`Set in for ${sound.name}`} onClick={actions.markIn} disabled={!canEdit}>Set in <kbd>I</kbd></Button>
      <Button size="xs" variant="ghost" label={`Set out for ${sound.name}`} onClick={actions.markOut} disabled={!canEdit}>Set out <kbd>O</kbd></Button>
    </div>
  </div>;
}

function SoundTileFeedback() {
  const { state: { error } } = useSoundTile();
  return error ? <Banner tone="error" size="sm" icon={null} className="mt-2.5">{error}</Banner> : null;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

function formatTimestamp(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const totalMilliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor(totalMilliseconds / 60_000) % 60;
  const wholeSeconds = Math.floor(totalMilliseconds / 1000) % 60;
  const milliseconds = totalMilliseconds % 1000;
  const fraction = milliseconds ? `.${milliseconds.toString().padStart(3, "0").replace(/0+$/, "")}` : "";
  const secondText = `${wholeSeconds.toString().padStart(2, "0")}${fraction}`;
  return hours > 0
    ? `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secondText.padStart(2, "0")}`
    : `${minutes}:${secondText.padStart(2, "0")}`;
}

function audioType(fileName: string) {
  const extension = fileName.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toUpperCase();
  return extension && ["MP3", "WAV", "FLAC", "AAC", "OGG", "OPUS", "M4A", "AIFF", "WMA"].includes(extension) ? `${extension} AUDIO` : "AUDIO FILE";
}
