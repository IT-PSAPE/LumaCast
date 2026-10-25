import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  AudioLines,
  Check,
  CircleStop,
  Disc3,
  FolderPlus,
  Headphones,
  Keyboard,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { Badge, Banner, EmptyState, ListRow, Panel, ReacstButton as Button, Sidebar, Slider, StatusBar, StatusDot, Switch, TextField, WindowChrome } from "@lumacast/ui";
import type { Sound, SoundBoard, SoundLibrary, SoundboardAPI, SoundPlaybackSettings, SoundShortcut } from "../shared/desktop-api";
import { defaultPlaybackSettings } from "../shared/desktop-api";
import { soundUrl } from "../shared/desktop-api";

type AudioPort = Pick<HTMLAudioElement, "currentTime" | "duration" | "paused" | "loop" | "play" | "pause" | "addEventListener" | "removeEventListener" | "src" | "load">;
type AudioFactory = (sound: Sound) => AudioPort;
type TileControls = { stop: () => void; toggle: () => void };

const browserAudio: AudioFactory = (sound) => {
  const audio = new Audio(soundUrl(sound.id));
  audio.preload = "metadata";
  return audio;
};

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
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

function parseTimestamp(input: string): number | null {
  const value = input.trim();
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  const parts = value.split(":");
  if (parts.length !== 2 && parts.length !== 3) return Number.NaN;
  const secondsText = parts[parts.length - 1]!;
  const minutesText = parts[parts.length - 2]!;
  const hoursText = parts.length === 3 ? parts[0]! : "0";
  if (!/^(?:[0-5]?\d)(?:\.\d+)?$/.test(secondsText)) return Number.NaN;
  if (parts.length === 2 && !/^\d+$/.test(minutesText)) return Number.NaN;
  if (parts.length === 3 && !/^\d{1,2}$/.test(minutesText)) return Number.NaN;
  if (!/^\d+$/.test(hoursText)) return Number.NaN;
  const seconds = Number(secondsText);
  const minutes = Number(minutesText);
  const hours = Number(hoursText);
  if (parts.length === 3 && minutes >= 60) return Number.NaN;
  return hours * 3600 + minutes * 60 + seconds;
}

function shortcutLabel(shortcut: SoundShortcut | null | undefined) {
  if (!shortcut) return "No shortcut";
  const parts = [shortcut.ctrl && "Ctrl", shortcut.alt && "Alt", shortcut.shift && "Shift", shortcut.meta && "Meta"] .filter(Boolean);
  const key = shortcut.code.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Arrow/, "");
  parts.push(key);
  return parts.join(" + ");
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return target.closest("input, textarea, select, [contenteditable='true']") !== null;
}

function matchesShortcut(event: KeyboardEvent, shortcut: SoundShortcut | null | undefined) {
  return Boolean(shortcut && event.code === shortcut.code && event.ctrlKey === shortcut.ctrl && event.altKey === shortcut.alt && event.shiftKey === shortcut.shift && event.metaKey === shortcut.meta);
}

function friendlyError(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Something went wrong. Please try again.";
}

export function App({ api = window.soundboard, audioFactory = browserAudio }: { api?: SoundboardAPI; audioFactory?: AudioFactory }) {
  const [library, setLibrary] = useState<SoundLibrary | null>(null);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [newBoardName, setNewBoardName] = useState("");
  const [renameValue, setRenameValue] = useState<string | null>(null);
  const [recordingShortcutId, setRecordingShortcutId] = useState<string | null>(null);
  const controls = useRef(new Map<string, TileControls>());
  const busyRef = useRef(false);
  const loadRequest = useRef(0);
  const activeBoardIdRef = useRef<string | null>(null);
  activeBoardIdRef.current = activeBoardId;
  const registerTile = useCallback((id: string, control: TileControls | null) => {
    if (control) controls.current.set(id, control);
    else controls.current.delete(id);
  }, []);

  const stopBoardSounds = useCallback((boardId: string | null) => {
    if (!boardId) return;
    library?.boards.find((board) => board.id === boardId)?.sounds.forEach((sound) => {
      controls.current.get(sound.id)?.stop();
    });
  }, [library]);

  const load = useCallback(async () => {
    const request = ++loadRequest.current;
    setLoading(true);
    setLoadError("");
    try {
      const next = await api.load();
      if (request !== loadRequest.current) return;
      setLibrary(next);
      setActiveBoardId((current) => next.boards.some((board) => board.id === current) ? current : next.boards[0]?.id ?? null);
    } catch (error) {
      if (request === loadRequest.current) setLoadError(friendlyError(error));
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
    return () => { loadRequest.current++; };
  }, [load]);
  useEffect(() => () => {
    controls.current.forEach((control) => control.stop());
    controls.current.clear();
  }, []);

  const mutate = async (operation: () => Promise<SoundLibrary>, after?: (next: SoundLibrary) => void): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setActionError("");
    try {
      const next = await operation();
      setLibrary(next);
      setActiveBoardId((current) => next.boards.some((board) => board.id === current) ? current : next.boards[0]?.id ?? null);
      after?.(next);
      return true;
    } catch (error) {
      setActionError(friendlyError(error));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const activeBoard = library?.boards.find((board) => board.id === activeBoardId) ?? null;

  const updateSound = async (soundId: string, settings: SoundPlaybackSettings) => {
    if (!activeBoard) return false;
    return mutate(() => api.updateSound(activeBoard.id, soundId, settings));
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (recordingShortcutId || event.repeat || event.isComposing || isEditableTarget(event.target) || !document.hasFocus()) return;
      const sound = activeBoard?.sounds.find((item) => matchesShortcut(event, item.playback?.shortcut));
      if (!sound) return;
      const playback = controls.current.get(sound.id);
      if (!playback) return;
      event.preventDefault();
      playback.toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeBoard, recordingShortcutId]);

  const createBoard = () => {
    const name = newBoardName.trim();
    if (!name || busy) return;
    const before = new Set(library?.boards.map((board) => board.id) ?? []);
    void mutate(() => api.createBoard(name), (next) => {
      const created = next.boards.find((board) => !before.has(board.id));
      if (created) setActiveBoardId(created.id);
      setNewBoardName("");
      setRenameValue(null);
    });
  };

  const renameBoard = (event: FormEvent) => {
    event.preventDefault();
    const name = renameValue?.trim() ?? "";
    if (!activeBoard || !name || busy) return;
    void mutate(() => api.renameBoard(activeBoard.id, name), () => setRenameValue(null));
  };

  const switchBoard = (boardId: string) => {
    if (busy || boardId === activeBoardIdRef.current) return;
    stopBoardSounds(activeBoardIdRef.current);
    setActiveBoardId(boardId);
    setRenameValue(null);
    setRecordingShortcutId(null);
    setActionError("");
  };

  const importSounds = () => {
    if (!activeBoard || busy) return;
    void mutate(() => api.importSounds(activeBoard.id));
  };

  const removeSound = (sound: Sound) => {
    if (!activeBoard || busy) return;
    controls.current.get(sound.id)?.stop();
    void mutate(() => api.removeSound(activeBoard.id, sound.id));
  };

  const stopAll = () => activeBoard?.sounds.forEach((sound) => controls.current.get(sound.id)?.stop());

  // The window has no native title bar, so the chrome (the only drag region)
  // renders in every state: loading, load error, and the main shell.
  const chrome = <WindowChrome><WindowChrome.Start draggable><WindowChrome.Title>LumaSoundboard</WindowChrome.Title></WindowChrome.Start></WindowChrome>;

  if (loading && !library) {
    return <div className="app-frame">{chrome}<main className="loading-screen"><div className="loader-mark"><AudioLines size={26} /></div><p>Loading your sound library</p></main></div>;
  }
  if (loadError && !library) {
    return <div className="app-frame">{chrome}<main className="loading-screen"><div className="error-card"><h1>Couldn’t open your boards</h1><p>{loadError}</p><Button variant="primary" size="xl" label="Try again" onClick={() => void load()}><RotateCcw size={16} /> Try again</Button></div></main></div>;
  }

  return (
    <div className="app-frame">
    {chrome}
    <div className="app-shell">
      <Sidebar width={258} className="board-rail">
        <Sidebar.Group label="Your boards" count={library?.boards.length ?? 0}>
          <Sidebar.Nav aria-label="Sound boards">
            {library?.boards.map((board) => <ListRow key={board.id} as="button" selected={board.id === activeBoardId} disabled={busy} onClick={() => switchBoard(board.id)} aria-label={board.name}>
              <ListRow.Leading><Disc3 size={17} /></ListRow.Leading><ListRow.Label>{board.name}</ListRow.Label><ListRow.Meta>{board.sounds.length}</ListRow.Meta>
            </ListRow>)}
          </Sidebar.Nav>
          <form className="mt-2" onSubmit={(event) => { event.preventDefault(); createBoard(); }}>
            <TextField label="New board name" labelPlacement="hidden" value={newBoardName} onValueChange={setNewBoardName} placeholder="Name a new board" maxLength={48} disabled={busy} trailing={<Button.Icon type="submit" label="Create board" variant="ghost" size="sm" disabled={busy || !newBoardName.trim()}><Plus size={17} /></Button.Icon>} />
          </form>
        </Sidebar.Group>
        <Sidebar.Footer className="flex items-center gap-2 text-xs text-tertiary"><Headphones size={17} className="text-brand" /><span>Ready when you are.</span><Sparkles className="ml-auto" size={15} /></Sidebar.Footer>
      </Sidebar>

      <Panel className="min-w-0">
        <Panel.Header>
          <Panel.HeaderTitle icon={<Volume2 size={16} />} count={activeBoard?.sounds.length}>{activeBoard?.name ?? "Boards"}</Panel.HeaderTitle>
          {activeBoard && <Panel.HeaderActions><Button size="md" label="Add sounds" onClick={importSounds} disabled={busy}><Plus size={16} /><span>Add sounds</span></Button>{activeBoard.sounds.length > 0 && <Button variant="ghost" size="md" label="Stop all" onClick={stopAll}><CircleStop size={16} /><span>Stop all</span></Button>}</Panel.HeaderActions>}
        </Panel.Header>
        <Panel.Body>
        <div className="content">
          {actionError && <Banner tone="error" size="sm" className="mb-6" onDismiss={() => setActionError("")}>{actionError}</Banner>}
          {library?.boards.length === 0 ? <EmptyState.Root className="min-h-[calc(100vh-196px)]"><EmptyState.Icon><AudioLines size={32} /></EmptyState.Icon><EmptyState.Title>Your soundboard begins here</EmptyState.Title><EmptyState.Description>Create a board to keep your sounds organized and ready to play.</EmptyState.Description><EmptyState.Action><form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); createBoard(); }}><TextField label="Board name" labelPlacement="hidden" value={newBoardName} onValueChange={setNewBoardName} placeholder="e.g. Studio cues" maxLength={48} disabled={busy} className="w-52" /><Button variant="primary" size="xl" label="Create board" type="submit" disabled={busy || !newBoardName.trim()}><FolderPlus size={16} /> Create board</Button></form></EmptyState.Action></EmptyState.Root>
          : activeBoard ? <BoardContent key={activeBoard.id} board={activeBoard} busy={busy} renameValue={renameValue} setRenameValue={setRenameValue} onRename={renameBoard} onImport={importSounds} onRemove={removeSound} onUpdateSound={updateSound} recordingShortcutId={recordingShortcutId} setRecordingShortcutId={setRecordingShortcutId} audioFactory={audioFactory} register={registerTile} /> : <EmptyState.Root className="min-h-[calc(100vh-196px)]"><EmptyState.Icon><AudioLines size={32} /></EmptyState.Icon><EmptyState.Title>No board selected</EmptyState.Title></EmptyState.Root>}
        </div>
        </Panel.Body>
      </Panel>
    </div>
    <StatusBar label="Library status"><StatusBar.Start><StatusBar.Item tone="success" icon={<StatusDot tone="success" />}>Local library</StatusBar.Item></StatusBar.Start></StatusBar>
    </div>
  );
}

function BoardContent({ board, busy, renameValue, setRenameValue, onRename, onImport, onRemove, onUpdateSound, recordingShortcutId, setRecordingShortcutId, audioFactory, register }: {
  board: SoundBoard; busy: boolean; renameValue: string | null; setRenameValue: (value: string | null) => void; onRename: (event: FormEvent) => void; onImport: () => void; onRemove: (sound: Sound) => void; onUpdateSound: (soundId: string, settings: SoundPlaybackSettings) => Promise<boolean>; recordingShortcutId: string | null; setRecordingShortcutId: (soundId: string | null) => void; audioFactory: AudioFactory; register: (id: string, controls: TileControls | null) => void;
}) {
  return <>
      <div className="board-heading"><div><form className="title-form" onSubmit={onRename}><TextField label="Board name" labelPlacement="hidden" value={renameValue ?? board.name} onValueChange={setRenameValue} maxLength={48} disabled={busy} className="w-[min(100%,360px)]" /><Button variant="take" size="sm" label="Save" type="submit" disabled={busy || !renameValue?.trim() || renameValue.trim() === board.name}>Save</Button></form><p className="board-subtitle">{board.sounds.length ? `${board.sounds.length} sound${board.sounds.length === 1 ? "" : "s"} in this collection` : "A quiet canvas, ready for your next sound."}</p></div></div>
    {board.sounds.length === 0 ? <EmptyState.Root className="min-h-[375px] rounded-lg border border-dashed border-primary"><EmptyState.Icon><Volume2 size={22} /></EmptyState.Icon><EmptyState.Title>No sounds in this board</EmptyState.Title><EmptyState.Description>Add audio files to start building your collection.</EmptyState.Description><EmptyState.Action><Button variant="primary" size="xl" label="Add sounds" onClick={onImport} disabled={busy}><Plus size={16} /> Add sounds</Button></EmptyState.Action></EmptyState.Root>
      : <div className="sound-grid">{board.sounds.map((sound, index) => <SoundTile key={sound.id} sound={sound} index={index} busy={busy} onRemove={() => onRemove(sound)} onUpdate={onUpdateSound} recording={recordingShortcutId === sound.id} onRecordingChange={(isRecording) => setRecordingShortcutId(isRecording ? sound.id : null)} audioFactory={audioFactory} register={register} />)}</div>}
  </>;
}

function SoundTile({ sound, index, busy, onRemove, onUpdate, recording, onRecordingChange, audioFactory, register }: {
  sound: Sound; index: number; busy: boolean; onRemove: () => void; onUpdate: (soundId: string, settings: SoundPlaybackSettings) => Promise<boolean>; recording: boolean; onRecordingChange: (recording: boolean) => void; audioFactory: AudioFactory; register: (id: string, controls: TileControls | null) => void;
}) {
  const audio = useRef<AudioPort | null>(null);
  const alive = useRef(true);
  const playRequest = useRef(0);
  const boundaryTimer = useRef<number | null>(null);
  const settings = sound.playback ?? defaultPlaybackSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const durationRef = useRef(0);
  const toggleRequest = useRef<() => void>(() => undefined);
  const scheduleBoundaryRef = useRef<() => void>(() => undefined);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const playIntent = useRef(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [startText, setStartText] = useState(() => formatTimestamp(settings.startTime));
  const [endText, setEndText] = useState(() => settings.endTime === null ? "" : formatTimestamp(settings.endTime));
  const [scrub, setScrub] = useState<number | null>(null);
  const [rangeError, setRangeError] = useState("");
  const [error, setError] = useState("");
  const markPlaying = useCallback((value: boolean) => {
    playingRef.current = value;
    setPlaying(value);
  }, []);

  const clearBoundary = useCallback(() => {
    if (boundaryTimer.current !== null) window.clearTimeout(boundaryTimer.current);
    boundaryTimer.current = null;
  }, []);

  const validPlayback = useCallback((candidate: SoundPlaybackSettings, length = durationRef.current) => {
    if (!Number.isFinite(length) || length <= 0) return false;
    if (!Number.isFinite(candidate.startTime) || candidate.startTime < 0 || candidate.startTime >= length) return false;
    if (candidate.endTime !== null && (!Number.isFinite(candidate.endTime) || candidate.endTime <= candidate.startTime || candidate.endTime > length)) return false;
    return true;
  }, []);

  const stop = useCallback(() => {
    playRequest.current++;
    playIntent.current = false;
    clearBoundary();
    const element = audio.current;
    if (!element) return;
    element.pause();
    const start = settingsRef.current.startTime;
    element.currentTime = start;
    setCurrent(start);
    markPlaying(false);
  }, [clearBoundary, markPlaying]);

  const pause = useCallback(() => {
    playRequest.current++;
    playIntent.current = false;
    clearBoundary();
    audio.current?.pause();
    markPlaying(false);
  }, [clearBoundary, markPlaying]);

  const resetToSegmentStart = useCallback(() => {
    const element = audio.current;
    if (!element) return;
    element.currentTime = settingsRef.current.startTime;
    setCurrent(settingsRef.current.startTime);
    markPlaying(false);
  }, [markPlaying]);

  const handleBoundary = useCallback(() => {
    const element = audio.current;
    if (!element || element.paused || !alive.current) return;
    const latest = settingsRef.current;
    const length = durationRef.current;
    const end = latest.endTime ?? length;
    if (!Number.isFinite(end) || end <= 0) return;
    if (element.currentTime < end) {
      const wait = Math.max(10, (end - element.currentTime) * 1000);
      boundaryTimer.current = window.setTimeout(handleBoundary, wait);
      return;
    }
    clearBoundary();
    if (latest.loop) {
      element.currentTime = latest.startTime;
      setCurrent(latest.startTime);
      const request = playRequest.current;
      void element.play().then(() => {
        if (alive.current && request === playRequest.current && playIntent.current) scheduleBoundaryRef.current();
      }).catch(() => {
        if (alive.current && request === playRequest.current && playIntent.current) { playIntent.current = false; markPlaying(false); setError("This audio segment couldn’t be played."); }
      });
      return;
    }
    playRequest.current++;
    playIntent.current = false;
    element.pause();
    resetToSegmentStart();
  }, [clearBoundary, markPlaying, resetToSegmentStart]);

  const scheduleBoundary = useCallback(() => {
    clearBoundary();
    const element = audio.current;
    if (!element || element.paused) return;
    const latest = settingsRef.current;
    const length = durationRef.current;
    const needsManualBoundary = latest.endTime !== null || latest.startTime > 0;
    if (!needsManualBoundary || !validPlayback(latest, length)) return;
    const end = latest.endTime ?? length;
    const wait = Math.max(0, (end - element.currentTime) * 1000);
    boundaryTimer.current = window.setTimeout(handleBoundary, wait);
  }, [clearBoundary, handleBoundary, validPlayback]);
  scheduleBoundaryRef.current = scheduleBoundary;

  const togglePlay = useCallback(async () => {
    const element = audio.current;
    if (!element || busy) return;
    setError("");
    if (!element.paused) { pause(); return; }
    const latest = settingsRef.current;
    if (!validPlayback(latest)) {
      setError(durationRef.current > 0 ? "The saved time range is outside this audio file." : "Audio duration is still loading.");
      return;
    }
    clearBoundary();
    if (element.currentTime < latest.startTime || element.currentTime >= (latest.endTime ?? durationRef.current)) {
      element.currentTime = latest.startTime;
      setCurrent(latest.startTime);
    }
    element.loop = latest.loop && latest.startTime === 0 && latest.endTime === null;
    const request = ++playRequest.current;
    playIntent.current = true;
    try {
      await element.play();
      if (!alive.current || request !== playRequest.current) return;
      markPlaying(true);
      scheduleBoundary();
    } catch (reason) {
      if (alive.current && request === playRequest.current) {
        playIntent.current = false;
        markPlaying(false);
        setError(reason instanceof Error && reason.name === "NotAllowedError" ? "Playback was blocked. Try again." : "This audio file couldn’t be played.");
      }
    }
  }, [busy, clearBoundary, markPlaying, pause, scheduleBoundary, validPlayback]);
  toggleRequest.current = () => { void togglePlay(); };

  useEffect(() => {
    alive.current = true;
    const element = audioFactory(sound);
    audio.current = element;
    const onTime = () => {
      if (!alive.current) return;
      setCurrent(element.currentTime || 0);
      const latest = settingsRef.current;
      const end = latest.endTime ?? durationRef.current;
      if ((latest.endTime !== null || latest.startTime > 0) && element.currentTime >= end) handleBoundary();
    };
    const onMetadata = () => {
      if (!alive.current) return;
      const length = Number.isFinite(element.duration) ? element.duration : 0;
      durationRef.current = length;
      setDuration(length);
      element.loop = settingsRef.current.loop && settingsRef.current.startTime === 0 && settingsRef.current.endTime === null;
      if (!validPlayback(settingsRef.current, length)) {
        clearBoundary();
        if (!element.paused) {
          playRequest.current++;
          playIntent.current = false;
          element.pause();
        }
        setError(length > 0 ? "The saved time range is outside this audio file." : "Audio duration couldn’t be read.");
        return;
      }
      if (element.paused) {
        element.currentTime = settingsRef.current.startTime;
        setCurrent(settingsRef.current.startTime);
      } else scheduleBoundary();
      setError("");
    };
    const onPlay = () => { if (alive.current) { markPlaying(true); setError(""); scheduleBoundary(); } };
    const onPause = () => { clearBoundary(); if (alive.current) markPlaying(false); };
    const onEnded = () => {
      if (!alive.current || !playIntent.current) return;
      playRequest.current++;
      clearBoundary();
      const latest = settingsRef.current;
      if (latest.loop) {
        playIntent.current = true;
        const request = playRequest.current;
        element.currentTime = latest.startTime;
        setCurrent(latest.startTime);
        void element.play().then(() => {
          if (alive.current && request === playRequest.current && playIntent.current) scheduleBoundaryRef.current();
        }).catch(() => { if (alive.current && request === playRequest.current && playIntent.current) { playIntent.current = false; markPlaying(false); setError("This audio segment couldn’t be played."); } });
      } else { playIntent.current = false; resetToSegmentStart(); }
    };
    const onError = () => { playRequest.current++; playIntent.current = false; clearBoundary(); if (alive.current) { markPlaying(false); setError("This audio file couldn’t be loaded."); } };
    element.addEventListener("timeupdate", onTime);
    element.addEventListener("loadedmetadata", onMetadata);
    element.addEventListener("durationchange", onMetadata);
    element.addEventListener("play", onPlay);
    element.addEventListener("pause", onPause);
    element.addEventListener("ended", onEnded);
    element.addEventListener("error", onError);
    if (Number.isFinite(element.duration) && element.duration > 0) onMetadata();
    register(sound.id, { stop, toggle: () => toggleRequest.current() });
    return () => {
      alive.current = false;
      playRequest.current++;
      clearBoundary();
      element.pause();
      element.currentTime = settingsRef.current.startTime;
      element.removeEventListener("timeupdate", onTime);
      element.removeEventListener("loadedmetadata", onMetadata);
      element.removeEventListener("durationchange", onMetadata);
      element.removeEventListener("play", onPlay);
      element.removeEventListener("pause", onPause);
      element.removeEventListener("ended", onEnded);
      element.removeEventListener("error", onError);
      element.src = "";
      element.load();
      register(sound.id, null);
      audio.current = null;
    };
  }, [audioFactory, clearBoundary, handleBoundary, markPlaying, register, resetToSegmentStart, scheduleBoundary, sound.id, stop, validPlayback]);

  useEffect(() => {
    setStartText(formatTimestamp(settings.startTime));
    setEndText(settings.endTime === null ? "" : formatTimestamp(settings.endTime));
    setRangeError("");
  }, [settings.startTime, settings.endTime]);

  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    element.loop = settings.loop && settings.startTime === 0 && settings.endTime === null;
    if (!validPlayback(settings, durationRef.current)) {
      clearBoundary();
      if (!element.paused) {
        playRequest.current++;
        playIntent.current = false;
        element.pause();
      }
      return;
    }
    if (element.currentTime < settings.startTime || element.currentTime >= (settings.endTime ?? durationRef.current)) {
      element.currentTime = settings.startTime;
      setCurrent(settings.startTime);
    }
    scheduleBoundary();
  }, [clearBoundary, scheduleBoundary, settings.endTime, settings.loop, settings.startTime, validPlayback]);

  useEffect(() => {
    if (!recording) return;
    const cancel = () => onRecordingChange(false);
    const onWindowBlur = () => cancel();
    const onKeyDown = (event: KeyboardEvent) => {
      if (!document.hasFocus() || event.repeat || event.isComposing) return;
      if (event.code === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancel();
        return;
      }
      if (["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"].includes(event.code)) return;
      event.preventDefault();
      event.stopPropagation();
      const shortcut: SoundShortcut = { code: event.code, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey };
      cancel();
      void onUpdate(sound.id, { ...settingsRef.current, shortcut });
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [onRecordingChange, onUpdate, recording, sound.id]);

  const handleSeek = (value: number) => {
    const element = audio.current;
    if (!element || !validPlayback(settings)) return;
    clearBoundary();
    element.currentTime = value;
    setCurrent(value);
    if (!element.paused) scheduleBoundary();
  };

  const saveRange = async (event: FormEvent) => {
    event.preventDefault();
    const start = parseTimestamp(startText);
    const end = endText.trim() ? parseTimestamp(endText) : null;
    const length = durationRef.current;
    let message = "";
    if (start === null || !Number.isFinite(start) || start < 0) message = "Enter a valid start time.";
    else if (end !== null && (!Number.isFinite(end) || end <= start)) message = "End time must be after start time.";
    else if (length <= 0) message = "Audio duration is still loading.";
    else if (length > 0 && start >= length) message = "Start time must be before the audio ends.";
    else if (length > 0 && end !== null && end > length) message = "End time can’t exceed the audio duration.";
    if (message) { setRangeError(message); return; }
    const updated = { ...settingsRef.current, startTime: start!, endTime: end };
    setRangeError("");
    const ok = await onUpdate(sound.id, updated);
    if (ok && audio.current && !validPlayback(updated)) {
      setRangeError(durationRef.current > 0 ? "The saved time range is outside this audio file." : "Audio duration is still loading.");
    }
  };

  const changeLoop = (loop: boolean) => {
    void onUpdate(sound.id, { ...settingsRef.current, loop });
  };
  const clearShortcut = () => {
    void onUpdate(sound.id, { ...settingsRef.current, shortcut: null });
  };

  const boundary = settings.endTime ?? duration;
  const maxSeek = Math.max(settings.startTime, boundary || settings.startTime);
  const seekValue = Math.min(maxSeek, Math.max(settings.startTime, current));
  const shownValue = scrub ?? seekValue;

  return <article className={`sound-card group ${playing ? "is-playing" : ""}`} style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
    <div className="card-topline"><span className="track-number">{String(index + 1).padStart(2, "0")}</span><Badge tone={playing ? "brand" : "neutral"} dot>{playing ? "PLAYING" : "READY"}</Badge><Button.Icon className="ml-auto opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" label={`Remove ${sound.name}`} variant="danger" size="sm" onClick={onRemove} disabled={busy}><Trash2 size={15} /></Button.Icon></div>
    <div className={`sound-art art-${index % 5}`}><div className="art-ring ring-a" /><div className="art-ring ring-b" /><div className="art-center"><AudioLines size={23} /></div><div className="art-orb orb-a" /><div className="art-orb orb-b" /></div>
    <div className="sound-copy"><h2 title={sound.name}>{sound.name}</h2><p>{audioType(sound.fileName)}</p></div>
    <div className="progress-wrap"><Slider label={`Seek ${sound.name}`} labelPlacement="hidden" size="sm" min={settings.startTime} max={maxSeek} step={0.01} value={shownValue} disabled={duration <= 0 || !validPlayback(settings)} onValueChange={setScrub} onCommit={(value) => { handleSeek(value); setScrub(null); }} /><div className="time-row"><span>{formatTime(shownValue)}</span><span>{formatTime(maxSeek)}</span></div></div>
    <div className="card-controls"><Button.Icon variant="primary" size="xl" shape="pill" label={playing ? `Pause ${sound.name}` : current > settings.startTime ? `Resume ${sound.name}` : `Play ${sound.name}`} onClick={() => { void togglePlay(); }} disabled={busy || duration <= 0 || !validPlayback(settings)}>{playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</Button.Icon><Button.Icon label={`Stop ${sound.name}`} variant="ghost" size="xl" onClick={stop} disabled={busy || !playing && current === settings.startTime}><CircleStop /></Button.Icon><span className="duration-label"><Volume2 size={13} /> {formatTime(duration)}</span></div>
    <form className="segment-settings" onSubmit={(event) => { void saveRange(event); }}>
      <div className="segment-fields"><TextField size="sm" label={`Start time for ${sound.name}`} labelPlacement="hidden" icon={<span>Start</span>} value={startText} placeholder="0:00" onValueChange={(value) => { setStartText(value); setRangeError(""); }} /><TextField size="sm" label={`End time for ${sound.name}`} labelPlacement="hidden" icon={<span>End</span>} value={endText} placeholder="Full duration" onValueChange={(value) => { setEndText(value); setRangeError(""); }} /><Button size="sm" label={`Save range for ${sound.name}`} type="submit" disabled={busy}>Save</Button></div>
      <div className="loop-row"><span>Loop</span><Switch checked={settings.loop} onCheckedChange={changeLoop} label={`Loop ${sound.name}`} disabled={busy} /></div>
      {rangeError && <Banner tone="error" size="sm" icon={null} className="mt-2">{rangeError}</Banner>}
    </form>
    <div className="shortcut-row"><div className="shortcut-current"><Keyboard size={14} /><kbd>{shortcutLabel(settings.shortcut)}</kbd></div><Button size="xs" className="ml-auto" label={recording ? `Cancel shortcut recording for ${sound.name}` : `Record shortcut for ${sound.name}`} variant={recording ? "take" : "ghost"} onClick={() => onRecordingChange(!recording)} onBlur={() => { if (recording) onRecordingChange(false); }} disabled={busy}>{recording ? <><Check size={13} /> Press a key</> : "Shortcut"}</Button>{settings.shortcut && <Button.Icon size="xs" label={`Clear shortcut for ${sound.name}`} variant="ghost" onClick={clearShortcut} disabled={busy}><X size={13} /></Button.Icon>}</div>
    {error && <Banner tone="error" size="sm" icon={null} className="mt-2.5">{error}</Banner>}
  </article>;
}

function audioType(fileName: string) {
  const extension = fileName.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toUpperCase();
  if (!extension || !["MP3", "WAV", "FLAC", "AAC", "OGG", "OPUS", "M4A", "AIFF", "WMA"].includes(extension)) return "AUDIO FILE";
  return extension ? `${extension} AUDIO` : "AUDIO FILE";
}
