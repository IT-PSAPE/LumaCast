import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  AudioLines,
  CircleStop,
  Disc3,
  FolderPlus,
  Headphones,
  Pause,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  Sparkles,
  Volume2,
  Ellipsis,
} from "lucide-react";
import { Banner, DropdownMenu, EmptyState, ListRow, Panel, RangeSlider, ReacstButton as Button, Sidebar, StatusBar, StatusDot, TextField, WindowChrome, type MenuEntry } from "@lumacast/ui";
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

// Range handles are `input[type=range]`, which are not text entry: I/O must work while one is focused.
function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return target.closest("input:not([type='range']), textarea, select, [contenteditable='true']") !== null;
}

const MIN_RANGE = 0.1;
const OUT_OF_RANGE = "The saved time range is outside this audio file.";
const round = (value: number) => Math.round(value * 100) / 100;

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
      if (!api) throw new Error("LumaSoundboard's desktop bridge is missing. Open the LumaSoundboard app window; this page cannot run in a browser tab or an outdated instance.");
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
        <Sidebar.Group label="Your boards">
          <Sidebar.Nav aria-label="Sound boards">
            {library?.boards.map((board) => <ListRow key={board.id} as="button" selected={board.id === activeBoardId} disabled={busy} onClick={() => switchBoard(board.id)} aria-label={board.name}>
              <ListRow.Leading><Disc3 size={17} /></ListRow.Leading><ListRow.Label>{board.name}</ListRow.Label>
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
          <Panel.HeaderTitle icon={<Volume2 size={16} />}>{activeBoard?.name ?? "Boards"}</Panel.HeaderTitle>
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
      <div className="board-heading"><div><form className="title-form" onSubmit={onRename}><TextField label="Board name" labelPlacement="hidden" value={renameValue ?? board.name} onValueChange={setRenameValue} maxLength={48} disabled={busy} className="w-[min(100%,360px)]" /><Button variant="take" size="sm" label="Save" type="submit" disabled={busy || !renameValue?.trim() || renameValue.trim() === board.name}>Save</Button></form></div></div>
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
  const [draft, setDraft] = useState<[number, number] | null>(null);
  const pendingRange = useRef<[number, number] | null>(null);
  const savingRange = useRef(false);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
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
      setError(durationRef.current > 0 ? OUT_OF_RANGE : "Audio duration is still loading.");
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
        setError((reason as { name?: unknown } | null)?.name === "NotAllowedError" ? "Playback was blocked. Try again." : "This audio file couldn’t be played.");
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
        setError(length > 0 ? OUT_OF_RANGE : "Audio duration couldn’t be read.");
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
    setError((message) => message === OUT_OF_RANGE ? "" : message);
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

  const seekTo = (value: number) => {
    const element = audio.current;
    if (!element || !validPlayback(settings)) return;
    const end = settings.endTime ?? durationRef.current;
    const target = Math.min(end, Math.max(settings.startTime, value));
    clearBoundary();
    element.currentTime = target;
    setCurrent(target);
    if (!element.paused) scheduleBoundary();
  };

  // Range edits apply as they are made. The draft keeps the handles under the pointer while a
  // save is in flight; edits made during a save coalesce into one follow-up write.
  const commitRange = async (range: [number, number]) => {
    pendingRange.current = range;
    if (savingRange.current) return;
    savingRange.current = true;
    try {
      while (pendingRange.current) {
        const [from, to] = pendingRange.current;
        pendingRange.current = null;
        const length = durationRef.current;
        await onUpdateRef.current(sound.id, { ...settingsRef.current, startTime: from, endTime: length > 0 && to >= length - 0.005 ? null : to });
      }
    } finally {
      savingRange.current = false;
      if (alive.current) setDraft(null);
    }
  };

  const playhead = () => audio.current?.currentTime ?? current;
  const markIn = () => {
    const length = durationRef.current;
    const end = settingsRef.current.endTime ?? length;
    if (length <= 0 || end - MIN_RANGE < 0) return;
    const from = round(Math.min(Math.max(0, playhead()), end - MIN_RANGE));
    void commitRange([from, end]);
  };
  const markOut = () => {
    const length = durationRef.current;
    if (length <= 0) return;
    const start = settingsRef.current.startTime;
    const to = round(Math.min(length, Math.max(playhead(), start + MIN_RANGE)));
    void commitRange([start, to]);
  };
  const resetRange = () => { void commitRange([0, durationRef.current]); };

  const onCardKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    // Menu popups are portalled but still bubble here through React; only keys from inside the card count.
    if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    if (!event.currentTarget.contains(event.target as Node) || isTextEntryTarget(event.target)) return;
    if (event.code === "KeyI") { event.preventDefault(); markIn(); }
    else if (event.code === "KeyO") { event.preventDefault(); markOut(); }
    else if ((event.code === "ArrowLeft" || event.code === "ArrowRight") && (event.target as Element).closest("[data-transport]")) {
      event.preventDefault();
      seekTo(playhead() + (event.code === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 5 : 1));
    }
  };

  const changeLoop = (loop: boolean) => {
    void onUpdate(sound.id, { ...settingsRef.current, loop });
  };
  const clearShortcut = () => {
    void onUpdate(sound.id, { ...settingsRef.current, shortcut: null });
  };

  const trackMax = duration > 0 ? duration : Math.max(1, settings.endTime ?? 1);
  const savedEnd = Math.min(trackMax, settings.endTime ?? trackMax);
  const range: [number, number] = draft ?? [Math.min(settings.startTime, Math.max(0, savedEnd - MIN_RANGE)), savedEnd];
  const trimmed = range[0] > 0 || (duration > 0 && range[1] < duration - 0.005);
  const canEdit = duration > 0;
  const shortcutText = settings.shortcut ? shortcutLabel(settings.shortcut) : null;

  const menuEntries: MenuEntry[] = [
    { id: "in", label: "Set in at playhead", shortcut: "I", onSelect: markIn, disabled: !canEdit },
    { id: "out", label: "Set out at playhead", shortcut: "O", onSelect: markOut, disabled: !canEdit },
    { id: "reset", label: "Reset range", onSelect: resetRange, disabled: !canEdit || !trimmed },
    { separator: true },
    { id: "loop", label: "Loop range", checked: settings.loop, onSelect: () => changeLoop(!settings.loop), disabled: busy },
    { separator: true },
    { id: "record", label: recording ? "Cancel shortcut recording" : shortcutText ? `Change shortcut (${shortcutText})` : "Record shortcut", onSelect: () => onRecordingChange(!recording), disabled: busy },
    { id: "clear", label: "Clear shortcut", onSelect: clearShortcut, disabled: busy || !settings.shortcut },
    { separator: true },
    { id: "remove", label: "Remove sound", danger: true, onSelect: onRemove, disabled: busy },
  ];

  const reveal = "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100";

  return <article className={`sound-card group ${playing ? "is-playing" : ""}`} style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }} onKeyDown={onCardKeyDown}>
    <div className="card-head">
      <div className={`sound-art art-${index % 5}`}><AudioLines size={16} /></div>
      <div className="sound-copy"><h2 title={sound.name}>{sound.name}</h2><p>{recording
        ? <Button size="xs" variant="take" label={`Cancel shortcut recording for ${sound.name}`} onClick={() => onRecordingChange(false)}>Press a key · Esc</Button>
        : <>{audioType(sound.fileName)}{shortcutText && <> · <kbd>{shortcutText}</kbd></>}</>}</p></div>
      <DropdownMenu align="end" entries={menuEntries} trigger={<Button.Icon label={`More actions for ${sound.name}`} variant="ghost" size="sm" className={`${reveal} aria-expanded:opacity-100`}><Ellipsis /></Button.Icon>} />
    </div>
    <div className="range-row">
      <RangeSlider size="sm" label={`Range of ${sound.name}`} labelPlacement="hidden" startLabel={`Start of ${sound.name}`} endLabel={`End of ${sound.name}`} min={0} max={trackMax} step={0.01} minRange={MIN_RANGE} value={range} playhead={canEdit ? current : undefined} disabled={!canEdit} formatValue={formatTimestamp} onValueChange={setDraft} onCommit={(next) => { void commitRange(next); }} onSeek={seekTo} />
      <Button.Icon size="sm" variant="ghost" pressed={settings.loop} label={`Loop ${sound.name}`} onClick={() => changeLoop(!settings.loop)} disabled={busy}><Repeat /></Button.Icon>
    </div>
    <div className="time-row"><span>{formatTimestamp(range[0]) || "0:00"}</span><span>{formatTime(current)}</span><span>{formatTimestamp(range[1]) || "0:00"}</span></div>
    <div className="card-controls">
      <Button.Icon data-transport="" variant="primary" size="xl" shape="pill" label={playing ? `Pause ${sound.name}` : current > settings.startTime ? `Resume ${sound.name}` : `Play ${sound.name}`} onClick={() => { void togglePlay(); }} disabled={busy || duration <= 0 || !validPlayback(settings)}>{playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</Button.Icon>
      <Button.Icon data-transport="" label={`Stop ${sound.name}`} variant="ghost" size="xl" onClick={stop} disabled={busy || !playing && current === settings.startTime}><CircleStop /></Button.Icon>
      <div className={`mark-buttons ${reveal}`}>
        <Button size="xs" variant="ghost" label={`Set in for ${sound.name}`} onClick={markIn} disabled={!canEdit}>Set in <kbd>I</kbd></Button>
        <Button size="xs" variant="ghost" label={`Set out for ${sound.name}`} onClick={markOut} disabled={!canEdit}>Set out <kbd>O</kbd></Button>
      </div>
    </div>
    {error && <Banner tone="error" size="sm" icon={null} className="mt-2.5">{error}</Banner>}
  </article>;
}

function audioType(fileName: string) {
  const extension = fileName.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toUpperCase();
  if (!extension || !["MP3", "WAV", "FLAC", "AAC", "OGG", "OPUS", "M4A", "AIFF", "WMA"].includes(extension)) return "AUDIO FILE";
  return extension ? `${extension} AUDIO` : "AUDIO FILE";
}
