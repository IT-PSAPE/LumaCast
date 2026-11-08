import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  AudioLines,
  CircleStop,
  Disc3,
  FolderPlus,
  Headphones,
  Plus,
  RotateCcw,
  Sparkles,
  Volume2,
} from "lucide-react";
import { Banner, ContextMenu, EmptyState, ListRow, Panel, ReacstButton as Button, Sidebar, StatusBar, StatusDot, TextField, WindowChrome, useConfirm, useContextMenuTrigger } from "@lumacast/ui";
import { useMultiSelection, useMultiSelectionKeyHandler } from "@lumacast/selection";
import type { Sound, SoundBoard, SoundLibrary, SoundboardAPI, SoundShortcut } from "../shared/desktop-api";
import { defaultPlaybackSettings } from "../shared/desktop-api";
import { soundUrl } from "../shared/desktop-api";
import type { AudioFactory, SaveSoundSettings, TileControls } from "./sound-ports";
import { isEditableTarget, isTextEntryTarget } from "./sound-shortcuts";
import { SoundTile } from "./sound-tile";

type LibrarySnapshot = { api: SoundboardAPI | undefined; value: SoundLibrary };
type MutationLifetime = { api: SoundboardAPI | undefined; controller: AbortController };

const browserAudio: AudioFactory = (sound) => {
  const audio = new Audio(soundUrl(sound.id));
  audio.preload = "metadata";
  return audio;
};

function matchesShortcut(event: KeyboardEvent, shortcut: SoundShortcut | null | undefined) {
  return Boolean(shortcut && event.code === shortcut.code && event.ctrlKey === shortcut.ctrl && event.altKey === shortcut.alt && event.shiftKey === shortcut.shift && event.metaKey === shortcut.meta);
}

function friendlyError(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Something went wrong. Please try again.";
}

function waitForMutation(settled: Promise<void>, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => { signal.removeEventListener("abort", finish); resolve(); };
    signal.addEventListener("abort", finish, { once: true });
    void settled.then(finish);
    if (signal.aborted) finish();
  });
}

export function App({ api = window.soundboard, audioFactory = browserAudio }: { api?: SoundboardAPI; audioFactory?: AudioFactory }) {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null);
  const library = snapshot && snapshot.api === api ? snapshot.value : null;
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [loadState, setLoadState] = useState({ api, loading: true, error: "" });
  const loading = loadState.api !== api || loadState.loading;
  const loadError = loadState.api === api ? loadState.error : "";
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [newBoardName, setNewBoardName] = useState("");
  const [renameValue, setRenameValue] = useState<string | null>(null);
  const [recordingShortcutId, setRecordingShortcutId] = useState<string | null>(null);
  const confirm = useConfirm();
  const controls = useRef(new Map<string, TileControls>());
  const busyRef = useRef(false);
  const libraryRef = useRef<LibrarySnapshot | null>(null);
  const mutationSettled = useRef<Promise<void> | null>(null);
  const mutationLifetime = useRef<MutationLifetime | null>(null);
  const loadRequest = useRef(0);
  const activeBoardIdRef = useRef<string | null>(null);
  activeBoardIdRef.current = activeBoardId;
  const registerTile = useCallback((id: string, control: TileControls | null) => {
    if (control) controls.current.set(id, control);
    else controls.current.delete(id);
  }, []);

  const applyLibrary = useCallback((next: SoundLibrary) => {
    const nextSnapshot = { api, value: next };
    libraryRef.current = nextSnapshot;
    setSnapshot(nextSnapshot);
    setActiveBoardId((current) => next.boards.some((board) => board.id === current) ? current : next.boards[0]?.id ?? null);
  }, [api]);

  const stopBoardSounds = useCallback((boardId: string | null) => {
    if (!boardId) return;
    library?.boards.find((board) => board.id === boardId)?.sounds.forEach((sound) => {
      controls.current.get(sound.id)?.stop();
    });
  }, [library]);

  const load = useCallback(async () => {
    const request = ++loadRequest.current;
    setLoadState({ api, loading: true, error: "" });
    let loadError = "";
    try {
      if (!api) throw new Error("LumaSoundboard's desktop bridge is missing. Open the LumaSoundboard app window; this page cannot run in a browser tab or an outdated instance.");
      const next = await api.load();
      if (request !== loadRequest.current) return;
      applyLibrary(next);
    } catch (error) {
      loadError = friendlyError(error);
    } finally {
      if (request === loadRequest.current) setLoadState({ api, loading: false, error: loadError });
    }
  }, [api, applyLibrary]);

  useEffect(() => {
    const lifetime = { api, controller: new AbortController() };
    mutationLifetime.current = lifetime;
    libraryRef.current = null;
    setSnapshot(null);
    mutationSettled.current = null;
    busyRef.current = false;
    activeBoardIdRef.current = null;
    setBusy(false);
    setActiveBoardId(null);
    setRenameValue(null);
    setNewBoardName("");
    setRecordingShortcutId(null);
    setActionError("");
    void load();
    return () => { lifetime.controller.abort(); loadRequest.current++; };
  }, [load]);
  useEffect(() => () => {
    controls.current.forEach((control) => control.stop());
    controls.current.clear();
  }, []);

  const mutate = async (operation: () => Promise<SoundLibrary>, options: { after?: (next: SoundLibrary) => void; preserveError?: boolean } = {}): Promise<boolean> => {
    if (busyRef.current) return false;
    const lifetime = mutationLifetime.current;
    if (!lifetime || lifetime.api !== api || lifetime.controller.signal.aborted) return false;
    let release!: () => void;
    const settled = new Promise<void>((resolve) => { release = resolve; });
    mutationSettled.current = settled;
    busyRef.current = true;
    setBusy(true);
    if (!options.preserveError) setActionError("");
    try {
      const next = await operation();
      if (lifetime.controller.signal.aborted) return false;
      applyLibrary(next);
      options.after?.(next);
      return true;
    } catch (error) {
      if (!lifetime.controller.signal.aborted) setActionError(friendlyError(error));
      return false;
    } finally {
      if (mutationSettled.current === settled) {
        mutationSettled.current = null;
        busyRef.current = false;
        if (!lifetime.controller.signal.aborted) setBusy(false);
      }
      release();
    }
  };

  const activeBoard = library?.boards.find((board) => board.id === activeBoardId) ?? null;
  const boardSelection = useMultiSelection(library?.boards.map((board) => board.id) ?? [], "soundboard:boards");
  const soundSelection = useMultiSelection(activeBoard?.sounds.map((sound) => sound.id) ?? [], activeBoard ? `soundboard:sounds:${activeBoard.id}` : null);
  const boardSelectionKeys = useMultiSelectionKeyHandler({ selectedCount: boardSelection.selectedIds.size, selectAll: boardSelection.selectAll, clearSelection: boardSelection.clearSelection });
  const soundSelectionKeys = useMultiSelectionKeyHandler({ selectedCount: soundSelection.selectedIds.size, selectAll: soundSelection.selectAll, clearSelection: soundSelection.clearSelection });

  const handleBoardClick = (boardId: string, modifiers: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) => {
    const selectionOnly = Boolean(modifiers.shiftKey || modifiers.metaKey || modifiers.ctrlKey);
    if (selectionOnly) {
      boardSelection.select(boardId, modifiers);
      return true;
    }
    boardSelection.clearSelection();
    switchBoard(boardId);
    return false;
  };

  const handleBoardSelectionToggle = (boardId: string, checked: boolean) => {
    if (boardSelection.selectedIds.has(boardId) !== checked) boardSelection.select(boardId, { ctrlKey: true });
  };

  const handleSoundClick = (soundId: string, modifiers: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) => {
    soundSelection.select(soundId, modifiers);
  };

  const handleSoundSelectionToggle = (soundId: string, checked: boolean) => {
    if (soundSelection.selectedIds.has(soundId) !== checked) soundSelection.select(soundId, { ctrlKey: true });
  };

  const handleBoardContextMenuTarget = (boardId: string) => {
    if (!boardSelection.selectedIds.has(boardId)) boardSelection.select(boardId);
  };

  const handleSoundContextMenuTarget = (soundId: string) => {
    if (!soundSelection.selectedIds.has(soundId)) soundSelection.select(soundId);
  };

  const removeBoards = async (clickedId: string) => {
    const lifetime = mutationLifetime.current;
    const ids = boardSelection.actionIds(clickedId);
    const targets = ids.map((id) => library?.boards.find((board) => board.id === id)).filter((board): board is SoundBoard => Boolean(board));
    if (targets.length === 0 || busyRef.current || !lifetime || lifetime.api !== api || lifetime.controller.signal.aborted) return;
    const confirmed = await confirm({
      title: targets.length === 1 ? `Remove “${targets[0]!.name}”?` : `Remove ${targets.length} boards?`,
      description: targets.length === 1 ? "This also removes the sounds stored in this board." : "This also removes the sounds stored in these boards.",
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!confirmed || mutationLifetime.current !== lifetime || lifetime.controller.signal.aborted) return;
    for (const board of targets) {
      board.sounds.forEach((sound) => controls.current.get(sound.id)?.stop());
      if (!await mutate(() => api.removeBoard(board.id))) break;
    }
  };

  const removeSounds = async (clickedId: string) => {
    const lifetime = mutationLifetime.current;
    const boardId = activeBoard?.id;
    if (!boardId) return;
    const ids = soundSelection.actionIds(clickedId);
    const targets = ids.map((id) => activeBoard.sounds.find((sound) => sound.id === id)).filter((sound): sound is Sound => Boolean(sound));
    if (targets.length === 0 || busyRef.current || !lifetime || lifetime.api !== api || lifetime.controller.signal.aborted) return;
    const confirmed = await confirm({
      title: targets.length === 1 ? `Remove “${targets[0]!.name}”?` : `Remove ${targets.length} sounds?`,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!confirmed || mutationLifetime.current !== lifetime || lifetime.controller.signal.aborted) return;
    for (const sound of targets) {
      controls.current.get(sound.id)?.stop();
      if (!await mutate(() => api.removeSound(boardId, sound.id))) break;
    }
  };

  const onBoardCollectionKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    boardSelectionKeys(event);
    if (event.defaultPrevented || event.repeat || isTextEntryTarget(event.target) || (event.key !== "Delete" && event.key !== "Backspace")) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-board-id]") : null;
    if (!target?.dataset.boardId) return;
    event.preventDefault();
    event.stopPropagation();
    void removeBoards(target.dataset.boardId);
  };

  const onSoundCollectionKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    soundSelectionKeys(event);
    if (event.defaultPrevented || event.repeat || isTextEntryTarget(event.target) || (event.key !== "Delete" && event.key !== "Backspace")) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-sound-id]") : null;
    if (!target?.dataset.soundId) return;
    event.preventDefault();
    event.stopPropagation();
    void removeSounds(target.dataset.soundId);
  };

  const updateSound: SaveSoundSettings = async (soundId, intent, options) => {
    const boardId = activeBoard?.id;
    const lifetime = mutationLifetime.current;
    if (!boardId || !lifetime || lifetime.api !== api || lifetime.controller.signal.aborted) return "discarded";
    if (!options?.preserveError) setActionError("");
    while (mutationSettled.current) {
      await waitForMutation(mutationSettled.current, lifetime.controller.signal);
      if (lifetime.controller.signal.aborted) return "discarded";
    }
    if (activeBoardIdRef.current !== boardId) return "discarded";
    const current = libraryRef.current;
    if (current?.api !== api) return "discarded";
    const sound = current?.value.boards.find((board) => board.id === boardId)?.sounds.find((item) => item.id === soundId);
    if (!sound) return "discarded";
    const settings = { ...(sound.playback ?? defaultPlaybackSettings()), ...intent };
    const saved = await mutate(() => api.updateSound(boardId, soundId, settings), { preserveError: true });
    return lifetime.controller.signal.aborted ? "discarded" : saved ? "saved" : "failed";
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
    void mutate(() => api.createBoard(name), { after: (next) => {
      const created = next.boards.find((board) => !before.has(board.id));
      if (created) setActiveBoardId(created.id);
      setNewBoardName("");
      setRenameValue(null);
    } });
  };

  const renameBoard = (event: FormEvent) => {
    event.preventDefault();
    const name = renameValue?.trim() ?? "";
    if (!activeBoard || !name || busy) return;
    void mutate(() => api.renameBoard(activeBoard.id, name), { after: () => setRenameValue(null) });
  };

  const switchBoard = (boardId: string) => {
    if (busy || boardId === activeBoardIdRef.current) return;
    stopBoardSounds(activeBoardIdRef.current);
    activeBoardIdRef.current = boardId;
    setActiveBoardId(boardId);
    setRenameValue(null);
    setRecordingShortcutId(null);
    setActionError("");
  };

  const importSounds = () => {
    if (!activeBoard || busy) return;
    void mutate(() => api.importSounds(activeBoard.id));
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
          <Sidebar.Nav aria-label="Sound boards" data-shortcuts-scope="ignore" onKeyDown={onBoardCollectionKeyDown}>
            {library?.boards.map((board) => <SoundBoardRow key={board.id} board={board} busy={busy} active={board.id === activeBoardId} selected={boardSelection.selectedIds.has(board.id)} onClick={handleBoardClick} onSelectionToggle={handleBoardSelectionToggle} onContextMenuTarget={handleBoardContextMenuTarget} onRemove={removeBoards} />)}
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
          : activeBoard ? <BoardContent key={activeBoard.id} board={activeBoard} busy={busy} renameValue={renameValue} setRenameValue={setRenameValue} onRename={renameBoard} onImport={importSounds} onRemove={(sound) => { void removeSounds(sound.id); }} onUpdateSound={updateSound} recordingShortcutId={recordingShortcutId} setRecordingShortcutId={setRecordingShortcutId} audioFactory={audioFactory} register={registerTile} selectedSoundIds={soundSelection.selectedIds} onSoundSelectionClick={handleSoundClick} onSoundSelectionToggle={handleSoundSelectionToggle} onSoundContextMenuTarget={handleSoundContextMenuTarget} onSoundCollectionKeyDown={onSoundCollectionKeyDown} /> : <EmptyState.Root className="min-h-[calc(100vh-196px)]"><EmptyState.Icon><AudioLines size={32} /></EmptyState.Icon><EmptyState.Title>No board selected</EmptyState.Title></EmptyState.Root>}
        </div>
        </Panel.Body>
      </Panel>
    </div>
    <StatusBar label="Library status"><StatusBar.Start><StatusBar.Item tone="success" icon={<StatusDot tone="success" />}>Local library</StatusBar.Item></StatusBar.Start></StatusBar>
    </div>
  );
}

type SoundBoardRowProps = {
  board: SoundBoard; busy: boolean; active: boolean; selected: boolean;
  onClick: (id: string, modifiers: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) => boolean;
  onSelectionToggle: (id: string, checked: boolean) => void;
  onContextMenuTarget: (id: string) => void; onRemove: (id: string) => void;
};

function SoundBoardRow(props: SoundBoardRowProps) {
  return <ContextMenu.Root><SoundBoardRowBody {...props} /></ContextMenu.Root>;
}

function SoundBoardRowBody({ board, busy, active, selected, onClick, onSelectionToggle, onContextMenuTarget, onRemove }: SoundBoardRowProps) {
  const { ref, ...triggerHandlers } = useContextMenuTrigger();
  const selectionModifiers = (event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => ({ shiftKey: event.shiftKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey });
  return <div {...triggerHandlers} ref={ref} data-board-id={board.id} data-multi-selected={selected ? "true" : undefined} onContextMenuCapture={() => onContextMenuTarget(board.id)} onTouchStartCapture={() => onContextMenuTarget(board.id)} onClickCapture={(event) => {
    if (!(event.target instanceof Element) || !event.target.closest("[data-board-selection]")) return;
    if (!event.shiftKey && !event.metaKey && !event.ctrlKey) return;
    onClick(board.id, selectionModifiers(event));
    event.preventDefault();
    event.stopPropagation();
  }} onKeyDownCapture={(event) => {
      if (event.target instanceof Element && event.target.closest("[data-board-selection]") && (event.key === " " || event.key === "Enter") && (event.shiftKey || event.metaKey || event.ctrlKey)) {
        onClick(board.id, selectionModifiers(event));
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) onContextMenuTarget(board.id);
    }}>
      <ListRow as="button" selected={active} className={selected ? "outline outline-1 outline-brand" : undefined} disabled={busy} onClick={(event) => {
        const selectionOnly = onClick(board.id, { shiftKey: event.shiftKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey });
        if (selectionOnly) { event.preventDefault(); event.stopPropagation(); }
      }} aria-label={board.name}>
        <ListRow.Leading><Disc3 size={17} /></ListRow.Leading><ListRow.Label>{board.name}</ListRow.Label>
        <ListRow.Actions><input data-board-selection="" type="checkbox" className="size-4 accent-brand focus-visible:outline-2 focus-visible:outline-brand" aria-label={`Select board ${board.name}`} checked={selected} disabled={busy} onChange={(event) => onSelectionToggle(board.id, event.currentTarget.checked)} /></ListRow.Actions>
      </ListRow>
    <ContextMenu.Portal><ContextMenu.Menu aria-label={`Actions for ${board.name}`}>
      <ContextMenu.Item variant="destructive" onSelect={() => onRemove(board.id)}>{selected ? "Remove selected boards" : "Remove board"}</ContextMenu.Item>
    </ContextMenu.Menu></ContextMenu.Portal>
  </div>;
}

function BoardContent({ board, busy, renameValue, setRenameValue, onRename, onImport, onRemove, onUpdateSound, recordingShortcutId, setRecordingShortcutId, audioFactory, register, selectedSoundIds, onSoundSelectionClick, onSoundSelectionToggle, onSoundContextMenuTarget, onSoundCollectionKeyDown }: {
  board: SoundBoard; busy: boolean; renameValue: string | null; setRenameValue: (value: string | null) => void; onRename: (event: FormEvent) => void; onImport: () => void; onRemove: (sound: Sound) => void; onUpdateSound: SaveSoundSettings; recordingShortcutId: string | null; setRecordingShortcutId: (soundId: string | null) => void; audioFactory: AudioFactory; register: (id: string, controls: TileControls | null) => void; selectedSoundIds: ReadonlySet<string>; onSoundSelectionClick: (id: string, modifiers: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) => void; onSoundSelectionToggle: (id: string, checked: boolean) => void; onSoundContextMenuTarget: (id: string) => void; onSoundCollectionKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}) {
  return <>
      <div className="board-heading"><div><form className="title-form" onSubmit={onRename}><TextField label="Board name" labelPlacement="hidden" value={renameValue ?? board.name} onValueChange={setRenameValue} maxLength={48} disabled={busy} className="w-[min(100%,360px)]" /><Button variant="take" size="sm" label="Save" type="submit" disabled={busy || !renameValue?.trim() || renameValue.trim() === board.name}>Save</Button></form></div></div>
    {board.sounds.length === 0 ? <EmptyState.Root className="min-h-[375px] rounded-surface border border-dashed border-primary"><EmptyState.Icon><Volume2 size={22} /></EmptyState.Icon><EmptyState.Title>No sounds in this board</EmptyState.Title><EmptyState.Description>Add audio files to start building your collection.</EmptyState.Description><EmptyState.Action><Button variant="primary" size="xl" label="Add sounds" onClick={onImport} disabled={busy}><Plus size={16} /> Add sounds</Button></EmptyState.Action></EmptyState.Root>
      : <div className="sound-grid" data-shortcuts-scope="ignore" onKeyDown={onSoundCollectionKeyDown}>{board.sounds.map((sound, index) => <SoundTile key={sound.id} sound={sound} index={index} busy={busy} selected={selectedSoundIds.has(sound.id)} onSelectionClick={onSoundSelectionClick} onSelectionToggle={onSoundSelectionToggle} onContextMenuTarget={onSoundContextMenuTarget} onRemove={() => onRemove(sound)} onUpdate={onUpdateSound} recording={recordingShortcutId === sound.id} onRecordingChange={(isRecording) => setRecordingShortcutId(isRecording ? sound.id : null)} audioFactory={audioFactory} register={register} />)}</div>}
  </>;
}
