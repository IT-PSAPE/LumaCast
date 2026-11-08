import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ConfirmProvider } from "@lumacast/ui";
import { App } from "../../../../apps/soundboard/renderer/App";
import type { Sound, SoundLibrary, SoundboardAPI, SoundPlaybackSettings } from "../../../../apps/soundboard/shared/desktop-api";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const sound = (id: string, name = `Sound ${id}`, playback?: SoundPlaybackSettings): Sound => ({ id, name, fileName: `${id}.managed`, playback });
const board = (id: string, name: string, sounds: Sound[] = []) => ({ id, name, sounds });
const library = (...boards: SoundLibrary["boards"]): SoundLibrary => ({ version: 2, boards });

function apiFor(initial: SoundLibrary) {
  let value = initial;
  const clone = () => structuredClone(value);
  // `satisfies`, not a return annotation: an annotation widens each vi.fn()
  // back to a plain function and loses `.mock`.
  return {
    snapshot: clone,
    load: vi.fn(async () => clone()),
    createBoard: vi.fn(async (name) => { value.boards.push(board(`board-${value.boards.length + 1}`, name)); return clone(); }),
    renameBoard: vi.fn(async (id, name) => { const item = value.boards.find((candidate) => candidate.id === id); if (item) item.name = name; return clone(); }),
    removeBoard: vi.fn(async (id) => { value.boards = value.boards.filter((candidate) => candidate.id !== id); return clone(); }),
    importSounds: vi.fn(async (id) => { const item = value.boards.find((candidate) => candidate.id === id); item?.sounds.push(sound(`${id}-sound`, "Imported cue")); return clone(); }),
    removeSound: vi.fn(async (boardId, soundId) => { const item = value.boards.find((candidate) => candidate.id === boardId); if (item) item.sounds = item.sounds.filter((itemSound) => itemSound.id !== soundId); return clone(); }),
    updateSound: vi.fn(async (boardId: string, soundId: string, playback: SoundPlaybackSettings) => { const item = value.boards.find((candidate) => candidate.id === boardId)?.sounds.find((candidate) => candidate.id === soundId); if (item) item.playback = structuredClone(playback); return clone(); }),
  } satisfies SoundboardAPI & { snapshot: () => SoundLibrary };
}

function renderApp(element: Parameters<typeof render>[0]) {
  return render(<ConfirmProvider>{element}</ConfirmProvider>);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

class FakeAudio {
  currentTime = 0;
  duration = 18;
  paused = true;
  loop = false;
  src = "";
  listeners = new Map<string, Set<EventListener>>();
  pendingPlay: Promise<void> | null = null;
  load = vi.fn();
  play = vi.fn(() => {
    const wasPaused = this.paused;
    this.paused = false;
    if (wasPaused) this.dispatch("play");
    return this.pendingPlay ?? Promise.resolve();
  });
  pause = vi.fn(() => { this.paused = true; this.dispatch("pause"); });
  addEventListener = (type: string, listener: EventListener) => {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  };
  removeEventListener = (type: string, listener: EventListener) => { this.listeners.get(type)?.delete(listener); };
  dispatch(type: string) { for (const listener of this.listeners.get(type) ?? []) listener(new Event(type)); }
}

function audioFactoryFor(elements: FakeAudio[]) {
  return (item: Sound) => {
    const element = new FakeAudio();
    element.src = item.id;
    elements.push(element);
    return element;
  };
}

async function chooseFromMenu(soundName: string, item: string | RegExp) {
  fireEvent.click(screen.getByRole("button", { name: `More actions for ${soundName}` }));
  const entry = await screen.findByRole(typeof item === "string" && item === "Loop range" ? "menuitemcheckbox" : "menuitem", { name: item });
  fireEvent.click(entry);
}

async function confirmRemoval() {
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
}

describe("soundboard renderer", () => {
  it("creates boards, renames the selected board, imports sounds, and removes them", async () => {
    const api = apiFor(library());
    renderApp(<App api={api} />);

    const nameInput = await screen.findByLabelText("New board name");
    fireEvent.change(nameInput, { target: { value: "Studio cues" } });
    fireEvent.click(within(nameInput.closest("form")!).getByRole("button", { name: "Create board" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Board name" })).toHaveValue("Studio cues"));

    const renameInput = screen.getByRole("textbox", { name: "Board name" });
    fireEvent.focus(renameInput);
    fireEvent.change(renameInput, { target: { value: "Draft name" } });
    fireEvent.blur(renameInput);
    fireEvent.focus(renameInput);
    expect(renameInput).toHaveValue("Draft name");
    fireEvent.change(renameInput, { target: { value: "" } });
    expect(renameInput).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(renameInput, { target: { value: "Live cues" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Board name" })).toHaveValue("Live cues"));
    expect(api.renameBoard).toHaveBeenCalledWith("board-1", "Live cues");

    fireEvent.click(screen.getAllByRole("button", { name: "Add sounds" })[0]!);
    expect(await screen.findByText("Imported cue")).toBeInTheDocument();
    await chooseFromMenu("Imported cue", "Remove sound");
    await confirmRemoval();
    expect(await screen.findByText("No sounds in this board")).toBeInTheDocument();
    expect(api.removeSound).toHaveBeenCalledWith("board-1", "board-1-sound");
  });

  it("selects board ranges without switching boards and removes the selected group with one confirmation", async () => {
    const api = apiFor(library(board("one", "First"), board("two", "Second"), board("three", "Third")));
    renderApp(<App api={api} />);
    const first = await screen.findByRole("button", { name: "First" });
    const second = screen.getByRole("button", { name: "Second" });
    const third = screen.getByRole("button", { name: "Third" });

    fireEvent.click(first, { ctrlKey: true });
    fireEvent.click(third, { shiftKey: true });
    expect(screen.getByRole("textbox", { name: "Board name" })).toHaveValue("First");
    expect(first.closest("[data-board-id]")).toHaveAttribute("data-multi-selected", "true");
    expect(second.closest("[data-board-id]")).toHaveAttribute("data-multi-selected", "true");
    expect(third.closest("[data-board-id]")).toHaveAttribute("data-multi-selected", "true");
    expect(screen.getByRole("checkbox", { name: "Select board First" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select board Second" })).toBeChecked();

    fireEvent.contextMenu(third.closest("[data-board-id]")!);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove selected boards" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Remove 3 boards?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(api.removeBoard).toHaveBeenCalledTimes(3));
    expect(api.removeBoard.mock.calls.map(([id]) => id)).toEqual(["one", "two", "three"]);
    expect(await screen.findByText("Your soundboard begins here")).toBeInTheDocument();
  });

  it("toggles discontiguous board selection and keeps select-all and Escape inside the board collection", async () => {
    const api = apiFor(library(board("one", "First"), board("two", "Second"), board("three", "Third")));
    renderApp(<App api={api} />);
    const first = await screen.findByRole("button", { name: "First" });
    const second = screen.getByRole("button", { name: "Second" });
    const third = screen.getByRole("button", { name: "Third" });
    fireEvent.click(first, { ctrlKey: true });
    fireEvent.click(third, { ctrlKey: true });
    expect(first.closest("[data-board-id]")).toHaveAttribute("data-multi-selected", "true");
    expect(second.closest("[data-board-id]")).not.toHaveAttribute("data-multi-selected");
    expect(third.closest("[data-board-id]")).toHaveAttribute("data-multi-selected", "true");
    expect(screen.getByRole("checkbox", { name: "Select board First" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select board Second" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select board Third" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Board name" })).toHaveValue("First");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select board Second" }));
    expect(screen.getByRole("checkbox", { name: "Select board Second" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Board name" })).toHaveValue("First");

    fireEvent.keyDown(third, { key: "a", code: "KeyA", ctrlKey: true });
    expect(first.closest("[data-board-id]")).toHaveAttribute("data-multi-selected", "true");
    expect(second.closest("[data-board-id]")).toHaveAttribute("data-multi-selected", "true");
    expect(third.closest("[data-board-id]")).toHaveAttribute("data-multi-selected", "true");
    expect(screen.getByRole("checkbox", { name: "Select board Second" })).toBeChecked();
    fireEvent.keyDown(third, { key: "Escape", code: "Escape" });
    expect(first.closest("[data-board-id]")).not.toHaveAttribute("data-multi-selected");
    expect(third.closest("[data-board-id]")).not.toHaveAttribute("data-multi-selected");
    expect(screen.getByRole("checkbox", { name: "Select board Second" })).not.toBeChecked();
    expect(screen.getByRole("textbox", { name: "Board name" })).toHaveValue("First");
  });

  it("stops board removal after the first failure and keeps the unprocessed board selected", async () => {
    const api = apiFor(library(board("one", "First"), board("two", "Second"), board("three", "Third")));
    const removeBoard = api.removeBoard.getMockImplementation()!;
    api.removeBoard.mockImplementation(async (id) => {
      if (id === "three") throw new Error("The board could not be removed.");
      return removeBoard(id);
    });
    renderApp(<App api={api} />);
    const first = await screen.findByRole("button", { name: "First" });
    const third = screen.getByRole("button", { name: "Third" });
    fireEvent.click(first, { ctrlKey: true });
    fireEvent.click(third, { ctrlKey: true });
    fireEvent.contextMenu(third.closest("[data-board-id]")!);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove selected boards" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await screen.findByText("The board could not be removed.");
    expect(api.removeBoard.mock.calls.map(([id]) => id)).toEqual(["one", "three"]);
    expect(screen.queryByRole("button", { name: "First" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Third" }).closest("[data-board-id]")).toHaveAttribute("data-multi-selected", "true");
    expect(screen.getByRole("button", { name: "Second" })).toBeInTheDocument();
  });

  it("uses modifier clicks to select sounds without playing, and removes a range as one action", async () => {
    const elements: FakeAudio[] = [];
    const api = apiFor(library(board("one", "Effects", [sound("a", "Alpha"), sound("b", "Bravo"), sound("c", "Charlie"), sound("d", "Delta"), sound("e", "Echo"), sound("f", "Foxtrot")])));
    renderApp(<App api={api} audioFactory={audioFactoryFor(elements)} />);
    await screen.findByText("Alpha");
    const alpha = screen.getByText("Alpha").closest("article")!;
    const echo = screen.getByText("Echo").closest("article")!;

    fireEvent.click(alpha, { ctrlKey: true });
    fireEvent.click(echo, { shiftKey: true });
    expect(alpha).toHaveAttribute("data-multi-selected", "true");
    expect(screen.getByText("Bravo").closest("article")).toHaveAttribute("data-multi-selected", "true");
    expect(screen.getByText("Charlie").closest("article")).toHaveAttribute("data-multi-selected", "true");
    expect(screen.getByText("Delta").closest("article")).toHaveAttribute("data-multi-selected", "true");
    expect(echo).toHaveAttribute("data-multi-selected", "true");
    expect(screen.getByRole("checkbox", { name: "Select sound Alpha" })).toBeChecked();
    expect(screen.getByRole("group", { name: "Sound Alpha, selected for group actions" })).toBeInTheDocument();
    expect(elements.every((element) => element.play.mock.calls.length === 0)).toBe(true);

    const foxtrotCheckbox = screen.getByRole("checkbox", { name: "Select sound Foxtrot" });
    fireEvent.click(foxtrotCheckbox);
    expect(foxtrotCheckbox).toBeChecked();
    fireEvent.click(foxtrotCheckbox);
    expect(foxtrotCheckbox).not.toBeChecked();
    expect(elements.every((element) => element.play.mock.calls.length === 0)).toBe(true);

    await chooseFromMenu("Echo", "Remove selected sounds");
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Remove 5 sounds?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(api.removeSound).toHaveBeenCalledTimes(5));
    expect(api.removeSound.mock.calls.map(([, id]) => id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(await screen.findByText("Foxtrot")).toBeInTheDocument();
  });

  it("keeps Ctrl+A and Escape in the sound collection from triggering matching playback shortcuts", async () => {
    const elements: FakeAudio[] = [];
    const alpha = sound("a", "Alpha", { startTime: 0, endTime: null, loop: false, shortcut: { code: "KeyA", ctrl: true, alt: false, shift: false, meta: false } });
    const api = apiFor(library(board("one", "Effects", [alpha, sound("b", "Bravo")])));
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    renderApp(<App api={api} audioFactory={audioFactoryFor(elements)} />);
    await screen.findByText("Alpha");
    const alphaCard = screen.getByText("Alpha").closest("article")!;

    fireEvent.keyDown(alphaCard, { key: "a", code: "KeyA", ctrlKey: true });
    expect(alphaCard).toHaveAttribute("data-multi-selected", "true");
    expect(screen.getByText("Bravo").closest("article")).toHaveAttribute("data-multi-selected", "true");
    expect(screen.getByRole("checkbox", { name: "Select sound Alpha" })).toBeChecked();
    expect(elements[0]!.play).not.toHaveBeenCalled();

    fireEvent.keyDown(alphaCard, { key: "Escape", code: "Escape" });
    expect(alphaCard).not.toHaveAttribute("data-multi-selected");
    expect(screen.getByText("Bravo").closest("article")).not.toHaveAttribute("data-multi-selected");
    expect(screen.getByRole("checkbox", { name: "Select sound Alpha" })).not.toBeChecked();
    expect(elements[0]!.play).not.toHaveBeenCalled();
  });

  it("stops a selected sound removal batch on failure and leaves unprocessed items selected", async () => {
    const api = apiFor(library(board("one", "Effects", [sound("a", "Alpha"), sound("b", "Bravo"), sound("c", "Charlie")])));
    const removeSound = api.removeSound.getMockImplementation()!;
    api.removeSound.mockImplementation(async (boardId, soundId) => {
      if (soundId === "b") throw new Error("The audio file could not be removed.");
      return removeSound(boardId, soundId);
    });
    renderApp(<App api={api} audioFactory={audioFactoryFor([])} />);
    await screen.findByText("Alpha");
    fireEvent.click(screen.getByText("Alpha").closest("article")!, { ctrlKey: true });
    fireEvent.click(screen.getByText("Charlie").closest("article")!, { shiftKey: true });
    await chooseFromMenu("Charlie", "Remove selected sounds");
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await screen.findByText("The audio file could not be removed.");
    expect(api.removeSound.mock.calls.map(([, id]) => id)).toEqual(["a", "b"]);
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.getByText("Bravo").closest("article")).toHaveAttribute("data-multi-selected", "true");
    expect(screen.getByText("Charlie").closest("article")).toHaveAttribute("data-multi-selected", "true");
  });

  it("supports concurrent playback, pause, resume, stop, and natural end", async () => {
    const elements: FakeAudio[] = [];
    const api = apiFor(library(board("one", "Effects", [sound("rain", "Rain"), sound("bell", "Bell")])));
    renderApp(<App api={api} audioFactory={audioFactoryFor(elements)} />);
    await screen.findByText("Rain");

    fireEvent.click(screen.getByRole("button", { name: "Play Rain" }));
    fireEvent.click(screen.getByRole("button", { name: "Play Bell" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Pause / })).toHaveLength(2));
    expect(elements[0]!.play).toHaveBeenCalledOnce();
    expect(elements[1]!.play).toHaveBeenCalledOnce();

    act(() => { elements[0]!.currentTime = 7; elements[0]!.dispatch("timeupdate"); });
    fireEvent.click(screen.getByRole("button", { name: "Pause Rain" }));
    expect(await screen.findByRole("button", { name: "Resume Rain" })).toBeInTheDocument();
    expect(elements[0]!.pause).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Stop Rain" }));
    expect(elements[0]!.currentTime).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Play Rain" }));
    act(() => { elements[0]!.pause(); elements[0]!.dispatch("ended"); });
    expect(await screen.findByRole("button", { name: "Play Rain" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Play Rain" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop all" }));
    expect(elements[0]!.currentTime).toBe(0);
    expect(elements[1]!.currentTime).toBe(0);
  });

  it("preserves existing players when cloned library responses arrive", async () => {
    const elements: FakeAudio[] = [];
    const api = apiFor(library(board("one", "Board", [sound("cue", "Cue")])));
    renderApp(<App api={api} audioFactory={audioFactoryFor(elements)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Play Cue" }));
    await waitFor(() => expect(elements[0]!.paused).toBe(false));
    fireEvent.click(screen.getAllByRole("button", { name: "Add sounds" })[0]!);
    await screen.findByText("Imported cue");
    expect(elements).toHaveLength(2);
    expect(elements[0]!.paused).toBe(false);

    fireEvent.focus(screen.getByRole("textbox", { name: "Board name" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Board name" }), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Board name" })).toHaveValue("Renamed"));
    expect(elements).toHaveLength(2);
    expect(elements[0]!.paused).toBe(false);
  });

  it("stops playback when switching boards and releases audio on removal", async () => {
    const elements: FakeAudio[] = [];
    const api = apiFor(library(board("one", "First", [sound("cue", "Cue")]), board("two", "Second", [])));
    renderApp(<App api={api} audioFactory={audioFactoryFor(elements)} />);
    fireEvent.click(await screen.findByRole("button", { name: /First/ }));
    fireEvent.click(screen.getByRole("button", { name: "Play Cue" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Pause Cue" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Second/ }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Board name" })).toHaveValue("Second"));
    expect(elements[0]!.currentTime).toBe(0);
    expect(elements[0]!.pause).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /First/ }));
    await screen.findByRole("button", { name: "Play Cue" });
    await chooseFromMenu("Cue", "Remove sound");
    await confirmRemoval();
    await screen.findByText("No sounds in this board");
    expect(elements[0]!.src).toBe("");
    expect(elements.at(-1)!.src).toBe("");
    expect(elements.at(-1)!.load).toHaveBeenCalled();
  });

  it("shows media errors and ignores a play promise that resolves after pause", async () => {
    const elements: FakeAudio[] = [];
    const api = apiFor(library(board("one", "Board", [sound("cue", "Cue")])));
    renderApp(<App api={api} audioFactory={audioFactoryFor(elements)} />);
    await screen.findByText("Cue");
    let resolvePlay!: () => void;
    elements[0]!.pendingPlay = new Promise<void>((resolve) => { resolvePlay = resolve; });
    fireEvent.click(screen.getByRole("button", { name: "Play Cue" }));
    act(() => { elements[0]!.currentTime = 2; elements[0]!.dispatch("timeupdate"); });
    fireEvent.click(await screen.findByRole("button", { name: "Pause Cue" }));
    await act(async () => { resolvePlay(); await Promise.resolve(); });
    expect(screen.getByRole("button", { name: "Resume Cue" })).toBeInTheDocument();

    let resolveEndedPlay!: () => void;
    elements[0]!.pendingPlay = new Promise<void>((resolve) => { resolveEndedPlay = resolve; });
    fireEvent.click(screen.getByRole("button", { name: "Resume Cue" }));
    act(() => { elements[0]!.pause(); elements[0]!.dispatch("ended"); });
    await act(async () => { resolveEndedPlay(); await Promise.resolve(); });
    expect(screen.getByRole("button", { name: "Play Cue" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Pause / })).not.toBeInTheDocument();

    elements[0]!.pendingPlay = Promise.reject(new DOMException("blocked", "NotAllowedError"));
    fireEvent.click(screen.getByRole("button", { name: "Play Cue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Playback was blocked. Try again.");

    act(() => elements[0]!.dispatch("error"));
    expect(screen.getByRole("alert")).toHaveTextContent("This audio file couldn’t be loaded.");
  });

  it.each(["resolve", "reject"] as const)("releases media listeners and timers before a late play promise can %s", async (outcome) => {
    const elements: FakeAudio[] = [];
    const api = apiFor(library(
      board("one", "First", [sound("cue", "Cue", { startTime: 2, endTime: 4, loop: true, shortcut: null })]),
      board("two", "Second"),
    ));
    renderApp(<App api={api} audioFactory={audioFactoryFor(elements)} />);
    await screen.findByText("Cue");
    let resolvePlay!: () => void;
    let rejectPlay!: (reason: Error) => void;
    elements[0]!.pendingPlay = new Promise<void>((resolve, reject) => { resolvePlay = resolve; rejectPlay = reject; });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Play Cue" }));
    expect(vi.getTimerCount()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Second" }));
    expect(elements[0]!.paused).toBe(true);
    expect(elements[0]!.src).toBe("");
    expect(elements[0]!.load).toHaveBeenCalledOnce();
    expect([...elements[0]!.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
    await act(async () => {
      if (outcome === "resolve") resolvePlay();
      else rejectPlay(new Error("late media failure"));
      await Promise.resolve();
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Cue")).not.toBeInTheDocument();
  });

  it("keeps the loaded library visible when a mutation fails", async () => {
    const api = apiFor(library(board("one", "Board")));
    vi.mocked(api.importSounds).mockRejectedValue(new Error("Import failed"));
    renderApp(<App api={api} />);
    expect(await screen.findByRole("textbox", { name: "Board name" })).toHaveValue("Board");
    fireEvent.click(screen.getAllByRole("button", { name: "Add sounds" })[0]!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Import failed");
    expect(screen.getByRole("textbox", { name: "Board name" })).toHaveValue("Board");
  });

  it("retries a failed initial library load", async () => {
    const api = apiFor(library(board("one", "Recovered")));
    vi.mocked(api.load).mockRejectedValueOnce(new Error("Library is unavailable"));
    renderApp(<App api={api} />);
    expect(await screen.findByText("Couldn’t open your boards")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Board name" })).toHaveValue("Recovered"));
    expect(api.load).toHaveBeenCalledTimes(2);
  });

  it("does not overlap duplicate import requests", async () => {
    const api = apiFor(library(board("one", "Board")));
    let finishImport!: (result: SoundLibrary) => void;
    vi.mocked(api.importSounds).mockImplementation(() => new Promise((resolve) => { finishImport = resolve; }));
    renderApp(<App api={api} />);
    await screen.findByRole("textbox", { name: "Board name" });
    const importButton = screen.getAllByRole("button", { name: "Add sounds" })[0]!;
    act(() => {
      fireEvent.click(importButton);
      fireEvent.click(importButton);
    });
    expect(api.importSounds).toHaveBeenCalledTimes(1);
    await act(async () => { finishImport(library(board("one", "Board", [sound("one-cue", "Cue")]))) });
    expect(await screen.findByText("Cue")).toBeInTheDocument();
  });

  it("shows the saved range on the handles, seeks inside it, and saves handle moves immediately", async () => {
    const playback = { startTime: 1.5, endTime: 8.5, loop: false, shortcut: null };
    const elements: FakeAudio[] = [];
    const api = apiFor(library(board("one", "Board", [sound("tone", "Tone", playback)])));
    renderApp(<App api={api} audioFactory={audioFactoryFor(elements)} />);
    await screen.findByText("Tone");

    const start = screen.getByRole("slider", { name: "Start of Tone" });
    const end = screen.getByRole("slider", { name: "End of Tone" });
    expect(start).toHaveAttribute("aria-valuenow", "1.5");
    expect(end).toHaveAttribute("aria-valuenow", "8.5");
    expect(screen.queryByRole("textbox", { name: /time for Tone/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Save range/ })).toBeNull();

    act(() => { elements[0]!.currentTime = 3; elements[0]!.dispatch("timeupdate"); });
    fireEvent.keyDown(screen.getByRole("button", { name: /^(Play|Resume) Tone$/ }), { key: "ArrowRight", code: "ArrowRight" });
    expect(elements[0]!.currentTime).toBe(4);
    fireEvent.keyDown(screen.getByRole("button", { name: /^(Play|Resume) Tone$/ }), { key: "ArrowRight", code: "ArrowRight", shiftKey: true });
    expect(elements[0]!.currentTime).toBe(8.5);

    fireEvent.keyDown(start, { key: "ArrowRight" });
    fireEvent.keyUp(start, { key: "ArrowRight" });
    await waitFor(() => expect(api.updateSound).toHaveBeenLastCalledWith("one", "tone", { ...playback, startTime: 1.51 }));
    fireEvent.keyDown(end, { key: "ArrowLeft", shiftKey: true });
    fireEvent.keyUp(end, { key: "ArrowLeft", shiftKey: true });
    await waitFor(() => expect(api.updateSound).toHaveBeenLastCalledWith("one", "tone", { ...playback, startTime: 1.51, endTime: 6.7 }));
  });

  it("discards a canceled filled-range preview without saving or changing the canonical player", async () => {
    const playback = { startTime: 2, endTime: 8, loop: false, shortcut: null };
    const api = apiFor(library(board("one", "Board", [sound("cue", "Cue", playback)])));
    const elements: FakeAudio[] = [];
    renderApp(<App api={api} audioFactory={audioFactoryFor(elements)} />);
    const start = await screen.findByRole("slider", { name: "Start of Cue" });
    const track = start.parentElement!.parentElement!;
    track.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 4, width: 200, height: 4, toJSON: () => ({}) });
    const fill = track.querySelector<HTMLDivElement>("[data-range-drag]")!;
    const captured = new Set<number>();
    const control = track.parentElement!;
    control.setPointerCapture = (id) => { captured.add(id); };
    control.hasPointerCapture = (id) => captured.has(id);
    control.releasePointerCapture = (id) => { captured.delete(id); };
    const pointer = { button: 0, buttons: 1, pointerId: 1, isPrimary: true, clientX: 55 };
    fireEvent.pointerDown(fill, pointer);
    fireEvent.pointerMove(fill, { ...pointer, clientX: 75 });
    expect(start).toHaveValue("3.8");
    expect(elements[0]!.currentTime).toBe(2);
    fireEvent.pointerCancel(fill, pointer);
    fireEvent.pointerUp(fill, { ...pointer, buttons: 0 });
    expect(start).toHaveValue("2");
    expect(api.updateSound).not.toHaveBeenCalled();
    expect(elements[0]!.currentTime).toBe(2);
    expect(elements).toHaveLength(1);
  });

  it.each([
    { rangeId: "first", rangeName: "First", savedLoop: true },
    { rangeId: "second", rangeName: "Second", savedLoop: false },
  ])("retains a $rangeName range edit while another settings save is pending", async ({ rangeId, rangeName, savedLoop }) => {
    const initial = { startTime: 0, endTime: null, loop: false, shortcut: null };
    const api = apiFor(library(board("one", "Board", [sound("first", "First", initial), sound("second", "Second", initial)])));
    const save = api.updateSound.getMockImplementation()!;
    let finishFirst!: () => void;
    api.updateSound.mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => { finishFirst = resolve; });
      return save(...args);
    });
    renderApp(<App api={api} audioFactory={audioFactoryFor([])} />);
    await screen.findByText("First");

    fireEvent.click(screen.getByRole("button", { name: "Loop First" }));
    await waitFor(() => expect(api.updateSound).toHaveBeenCalledTimes(1));
    const start = screen.getByRole("slider", { name: `Start of ${rangeName}` });
    expect(start).not.toBeDisabled();
    fireEvent.keyDown(start, { key: "ArrowRight" });
    fireEvent.keyUp(start, { key: "ArrowRight" });
    await act(async () => { finishFirst(); });

    await waitFor(() => expect(api.updateSound).toHaveBeenLastCalledWith("one", rangeId, { ...initial, startTime: 0.01, loop: savedLoop }));
    expect(api.snapshot().boards[0]!.sounds[0]!.playback?.loop).toBe(true);
    expect(api.snapshot().boards[0]!.sounds.find((item) => item.id === rangeId)?.playback?.startTime).toBe(0.01);
  });

  it("serializes waiting sound edits and coalesces repeated range edits without overwriting saved fields", async () => {
    const initial = { startTime: 0, endTime: null, loop: false, shortcut: null };
    const api = apiFor(library(board("one", "Board", [sound("first", "First", initial), sound("second", "Second", initial), sound("third", "Third", initial)])));
    const save = api.updateSound.getMockImplementation()!;
    const first = deferred<void>();
    api.updateSound.mockImplementationOnce(async (...args) => { await first.promise; return save(...args); });
    renderApp(<App api={api} audioFactory={audioFactoryFor([])} />);
    await screen.findByText("First");
    fireEvent.click(screen.getByRole("button", { name: "Loop First" }));
    for (const name of ["First", "Second", "Third", "First", "First"]) {
      const start = screen.getByRole("slider", { name: `Start of ${name}` });
      fireEvent.keyDown(start, { key: "ArrowRight" });
      fireEvent.keyUp(start, { key: "ArrowRight" });
    }
    expect(api.updateSound).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve(); });
    await waitFor(() => expect(api.updateSound).toHaveBeenCalledTimes(5));
    expect(api.snapshot().boards[0]!.sounds.map((item) => item.playback)).toEqual([
      { ...initial, loop: true, startTime: 0.03 },
      { ...initial, startTime: 0.01 },
      { ...initial, startTime: 0.01 },
    ]);
  });

  it("releases a failed settings write for another sound and keeps its error visible", async () => {
    const api = apiFor(library(board("one", "Board", [sound("first", "First"), sound("second", "Second")])));
    const first = deferred<SoundLibrary>();
    api.updateSound.mockImplementationOnce(() => first.promise);
    renderApp(<App api={api} audioFactory={audioFactoryFor([])} />);
    await screen.findByText("First");
    fireEvent.click(screen.getByRole("button", { name: "Loop First" }));
    const start = screen.getByRole("slider", { name: "Start of Second" });
    fireEvent.keyDown(start, { key: "ArrowRight" });
    fireEvent.keyUp(start, { key: "ArrowRight" });
    await act(async () => { first.reject(new Error("The first cue could not be saved.")); });
    await waitFor(() => expect(api.updateSound).toHaveBeenCalledTimes(2));
    expect(api.snapshot().boards[0]!.sounds[1]!.playback?.startTime).toBe(0.01);
    expect(screen.getByRole("alert")).toHaveTextContent("The first cue could not be saved.");
  });

  it("discards waiting settings for a sound removed by the active mutation", async () => {
    const api = apiFor(library(board("one", "Board", [sound("cue", "Cue")])));
    const remove = api.removeSound.getMockImplementation()!;
    const removal = deferred<void>();
    api.removeSound.mockImplementationOnce(async (...args) => { await removal.promise; return remove(...args); });
    renderApp(<App api={api} audioFactory={audioFactoryFor([])} />);
    await screen.findByText("Cue");
    await chooseFromMenu("Cue", "Remove sound");
    await confirmRemoval();
    const start = screen.getByRole("slider", { name: "Start of Cue" });
    fireEvent.keyDown(start, { key: "ArrowRight" });
    fireEvent.keyUp(start, { key: "ArrowRight" });
    await act(async () => { removal.resolve(); });
    await screen.findByText("No sounds in this board");
    expect(api.updateSound).not.toHaveBeenCalled();
  });

  it("discards waiting settings when the app unmounts", async () => {
    const api = apiFor(library(board("one", "Board", [sound("first", "First"), sound("second", "Second")])));
    const first = deferred<SoundLibrary>();
    api.updateSound.mockImplementationOnce(() => first.promise);
    const view = renderApp(<App api={api} audioFactory={audioFactoryFor([])} />);
    await screen.findByText("First");
    fireEvent.click(screen.getByRole("button", { name: "Loop First" }));
    const start = screen.getByRole("slider", { name: "Start of Second" });
    fireEvent.keyDown(start, { key: "ArrowRight" });
    fireEvent.keyUp(start, { key: "ArrowRight" });
    view.unmount();
    await act(async () => { first.resolve(api.snapshot()); });
    expect(api.updateSound).toHaveBeenCalledTimes(1);
  });

  it("isolates replacement API writes from old in-flight results and waiting settings", async () => {
    const oldApi = apiFor(library(board("one", "Old board", [sound("first", "Old first"), sound("second", "Old second")])));
    const newApi = apiFor(library(board("one", "New board", [sound("first", "New first"), sound("second", "New second")])));
    const oldWrite = deferred<SoundLibrary>();
    const newWrite = deferred<void>();
    oldApi.updateSound.mockImplementationOnce(() => oldWrite.promise);
    const saveNew = newApi.updateSound.getMockImplementation()!;
    newApi.updateSound.mockImplementationOnce(async (...args) => { await newWrite.promise; return saveNew(...args); });
    const factory = audioFactoryFor([]);
    const view = renderApp(<App api={oldApi} audioFactory={factory} />);
    await screen.findByText("Old first");
    fireEvent.click(screen.getByRole("button", { name: "Loop Old first" }));
    const oldStart = screen.getByRole("slider", { name: "Start of Old second" });
    fireEvent.keyDown(oldStart, { key: "ArrowRight" });
    fireEvent.keyUp(oldStart, { key: "ArrowRight" });
    view.rerender(<ConfirmProvider><App api={newApi} audioFactory={factory} /></ConfirmProvider>);
    await screen.findByText("New first");
    fireEvent.click(screen.getByRole("button", { name: "Loop New first" }));
    const newStart = screen.getByRole("slider", { name: "Start of New second" });
    fireEvent.keyDown(newStart, { key: "ArrowRight" });
    fireEvent.keyUp(newStart, { key: "ArrowRight" });
    await act(async () => { oldWrite.resolve(oldApi.snapshot()); });
    expect(screen.getByRole("textbox", { name: "Board name" })).toHaveValue("New board");
    expect(screen.getByRole("button", { name: "Add sounds" })).toBeDisabled();
    expect(oldApi.updateSound).toHaveBeenCalledTimes(1);
    expect(newApi.updateSound).toHaveBeenCalledTimes(1);
    await act(async () => { newWrite.resolve(); });
    await waitFor(() => expect(newApi.updateSound).toHaveBeenCalledTimes(2));
    expect(newApi.snapshot().boards[0]!.sounds[0]!.playback?.loop).toBe(true);
    expect(newApi.snapshot().boards[0]!.sounds[1]!.playback?.startTime).toBe(0.01);
  });

  it("hides the previous library while a replacement API loads and never writes its settings into the new API", async () => {
    const oldSettings = { startTime: 1, endTime: 8, loop: true, shortcut: null };
    const newSettings = { startTime: 3, endTime: 7, loop: false, shortcut: null };
    const oldApi = apiFor(library(board("one", "Old", [sound("cue", "Old cue", oldSettings)])));
    const newApi = apiFor(library(board("one", "New", [sound("cue", "New cue", newSettings)])));
    const loading = deferred<SoundLibrary>();
    newApi.load.mockImplementationOnce(() => loading.promise);
    const elements: FakeAudio[] = [];
    const factory = audioFactoryFor(elements);
    const view = renderApp(<App api={oldApi} audioFactory={factory} />);
    await screen.findByText("Old cue");
    const oldStart = screen.getByRole("slider", { name: "Start of Old cue" });
    view.rerender(<ConfirmProvider><App api={newApi} audioFactory={factory} /></ConfirmProvider>);
    expect(screen.getByText("Loading your sound library")).toBeInTheDocument();
    expect(screen.queryByText("Old cue")).not.toBeInTheDocument();
    expect(elements[0]!.src).toBe("");
    fireEvent.keyDown(oldStart, { key: "ArrowRight" });
    fireEvent.keyUp(oldStart, { key: "ArrowRight" });
    expect(newApi.updateSound).not.toHaveBeenCalled();
    await act(async () => { loading.resolve(newApi.snapshot()); });
    expect(await screen.findByRole("slider", { name: "Start of New cue" })).toHaveValue("3");
    expect(elements).toHaveLength(2);
    expect(newApi.snapshot().boards[0]!.sounds[0]!.playback).toEqual(newSettings);
  });

  it("retains new-session range edits when an old same-ID range write finishes", async () => {
    const oldApi = apiFor(library(board("one", "Old", [sound("cue", "Old cue")])));
    const newApi = apiFor(library(board("one", "New", [sound("cue", "New cue")])));
    const oldWrite = deferred<SoundLibrary>();
    oldApi.updateSound.mockImplementationOnce(() => oldWrite.promise);
    const factory = audioFactoryFor([]);
    const view = renderApp(<App api={oldApi} audioFactory={factory} />);
    await screen.findByText("Old cue");
    const oldStart = screen.getByRole("slider", { name: "Start of Old cue" });
    fireEvent.keyDown(oldStart, { key: "ArrowRight" });
    fireEvent.keyUp(oldStart, { key: "ArrowRight" });
    view.rerender(<ConfirmProvider><App api={newApi} audioFactory={factory} /></ConfirmProvider>);
    const newStart = await screen.findByRole("slider", { name: "Start of New cue" });
    fireEvent.keyDown(newStart, { key: "ArrowRight" });
    fireEvent.keyUp(newStart, { key: "ArrowRight" });
    await act(async () => { oldWrite.resolve(oldApi.snapshot()); });
    expect(newApi.updateSound).toHaveBeenCalledOnce();
    expect(newApi.snapshot().boards[0]!.sounds[0]!.playback?.startTime).toBe(0.01);
  });

  it("resets active board, rename drafts, errors and shortcut recording for a replacement API session", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const oldApi = apiFor(library(board("one", "Old first"), board("two", "Old second", [sound("cue", "Old cue")])));
    const newApi = apiFor(library(board("one", "New first", [sound("cue", "New cue")]), board("two", "New second")));
    oldApi.importSounds.mockRejectedValueOnce(new Error("Old session import failed."));
    const factory = audioFactoryFor([]);
    const view = renderApp(<App api={oldApi} audioFactory={factory} />);
    fireEvent.click(await screen.findByRole("button", { name: "Old second" }));
    const rename = screen.getByRole("textbox", { name: "Board name" });
    fireEvent.change(rename, { target: { value: "Old unfinished name" } });
    fireEvent.click(screen.getByRole("button", { name: "Add sounds" }));
    await screen.findByText("Old session import failed.");
    await chooseFromMenu("Old cue", "Record shortcut");
    view.rerender(<ConfirmProvider><App api={newApi} audioFactory={factory} /></ConfirmProvider>);
    await screen.findByText("New cue");
    expect(screen.getByRole("textbox", { name: "Board name" })).toHaveValue("New first");
    expect(screen.queryByText("Old session import failed.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel shortcut recording for New cue" })).not.toBeInTheDocument();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true, bubbles: true, cancelable: true })); });
    expect(newApi.updateSound).not.toHaveBeenCalled();
  });

  it.each([
    { target: "sound", returnToOriginal: false },
    { target: "sound", returnToOriginal: true },
    { target: "board", returnToOriginal: false },
    { target: "board", returnToOriginal: true },
  ])("discards a $target removal confirmation owned by an ended API session (return to original API: $returnToOriginal)", async ({ target, returnToOriginal }) => {
    const oldApi = apiFor(library(board("one", "Old", [sound("cue", "Old cue")])));
    const newApi = apiFor(library(board("one", "New", [sound("cue", "New cue")])));
    const factory = audioFactoryFor([]);
    const view = renderApp(<App api={oldApi} audioFactory={factory} />);
    await screen.findByText("Old cue");
    if (target === "sound") await chooseFromMenu("Old cue", "Remove sound");
    else {
      fireEvent.contextMenu(screen.getByRole("button", { name: "Old" }).closest("[data-board-id]")!);
      fireEvent.click(await screen.findByRole("menuitem", { name: /Remove (selected )?board/ }));
    }
    const dialog = await screen.findByRole("alertdialog");
    view.rerender(<ConfirmProvider><App api={newApi} audioFactory={factory} /></ConfirmProvider>);
    await screen.findByText("New cue");
    if (returnToOriginal) {
      view.rerender(<ConfirmProvider><App api={oldApi} audioFactory={factory} /></ConfirmProvider>);
      await screen.findByText("Old cue");
    }
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Remove" })); });
    expect(oldApi.removeSound).not.toHaveBeenCalled();
    expect(newApi.removeSound).not.toHaveBeenCalled();
    expect(oldApi.removeBoard).not.toHaveBeenCalled();
    expect(newApi.removeBoard).not.toHaveBeenCalled();
    expect(screen.getByText(returnToOriginal ? "Old cue" : "New cue")).toBeInTheDocument();
  });

  it("recovers a replacement API load without exposing the prior session", async () => {
    const oldApi = apiFor(library(board("one", "Old", [sound("cue", "Old cue")])));
    const newApi = apiFor(library(board("one", "New", [sound("cue", "New cue")])));
    newApi.load.mockRejectedValueOnce(new Error("The replacement library could not be opened."));
    const factory = audioFactoryFor([]);
    const view = renderApp(<App api={oldApi} audioFactory={factory} />);
    await screen.findByText("Old cue");
    view.rerender(<ConfirmProvider><App api={newApi} audioFactory={factory} /></ConfirmProvider>);
    await screen.findByText("The replacement library could not be opened.");
    expect(screen.queryByText("Old cue")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("New cue")).toBeInTheDocument();
    expect(newApi.load).toHaveBeenCalledTimes(2);
  });

  it("does not reuse an ended session snapshot when returning to its API during a pending replacement load", async () => {
    const oldApi = apiFor(library(board("one", "Old", [sound("cue", "Old cue")])));
    const newApi = apiFor(library(board("one", "New", [sound("cue", "New cue")])));
    const newLoad = deferred<SoundLibrary>();
    const returnedLoad = deferred<SoundLibrary>();
    newApi.load.mockImplementationOnce(() => newLoad.promise);
    const factory = audioFactoryFor([]);
    const view = renderApp(<App api={oldApi} audioFactory={factory} />);
    await screen.findByText("Old cue");
    oldApi.load.mockImplementationOnce(() => returnedLoad.promise);
    view.rerender(<ConfirmProvider><App api={newApi} audioFactory={factory} /></ConfirmProvider>);
    view.rerender(<ConfirmProvider><App api={oldApi} audioFactory={factory} /></ConfirmProvider>);
    expect(screen.getByText("Loading your sound library")).toBeInTheDocument();
    expect(screen.queryByText("Old cue")).not.toBeInTheDocument();
    await act(async () => { newLoad.resolve(newApi.snapshot()); });
    expect(screen.getByText("Loading your sound library")).toBeInTheDocument();
    await act(async () => { returnedLoad.resolve(oldApi.snapshot()); });
    expect(await screen.findByText("Old cue")).toBeInTheDocument();
    expect(screen.queryByText("New cue")).not.toBeInTheDocument();
  });

  it("sets in and out at the playhead from the I and O keys, the buttons and the menu", async () => {
    const playback = { startTime: 0, endTime: null, loop: false, shortcut: null };
    const elements: FakeAudio[] = [];
    const api = apiFor(library(board("one", "Board", [sound("cue", "Cue", playback)])));
    renderApp(<App api={api} audioFactory={audioFactoryFor(elements)} />);
    await screen.findByText("Cue");
    const play = screen.getByRole("button", { name: "Play Cue" });

    act(() => { elements[0]!.currentTime = 4; });
    fireEvent.keyDown(play, { key: "i", code: "KeyI" });
    await waitFor(() => expect(api.updateSound).toHaveBeenLastCalledWith("one", "cue", { ...playback, startTime: 4 }));

    act(() => { elements[0]!.currentTime = 9; });
    fireEvent.keyDown(screen.getByRole("slider", { name: "End of Cue" }), { key: "o", code: "KeyO" });
    await waitFor(() => expect(api.updateSound).toHaveBeenLastCalledWith("one", "cue", { ...playback, startTime: 4, endTime: 9 }));

    // Modified keys and text entry are ignored.
    const calls = api.updateSound.mock.calls.length;
    fireEvent.keyDown(play, { key: "i", code: "KeyI", metaKey: true });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Board name" }), { key: "i", code: "KeyI" });
    expect(api.updateSound.mock.calls.length).toBe(calls);

    // The out point cannot be placed at or before the in point: it is held one minimum range after it.
    act(() => { elements[0]!.currentTime = 1; });
    fireEvent.click(screen.getByRole("button", { name: "Set out for Cue" }));
    await waitFor(() => expect(api.updateSound).toHaveBeenLastCalledWith("one", "cue", { ...playback, startTime: 4, endTime: 4.1 }));

    act(() => { elements[0]!.currentTime = 6; });
    await chooseFromMenu("Cue", /^Set in at playhead/);
    await waitFor(() => expect(api.updateSound).toHaveBeenLastCalledWith("one", "cue", { ...playback, startTime: 4, endTime: 4.1 }));
    await chooseFromMenu("Cue", "Reset range");
    await waitFor(() => expect(api.updateSound).toHaveBeenLastCalledWith("one", "cue", playback));
  });

  it.each([
    { firstKey: "KeyI", firstHead: 0.4, secondKey: "KeyO", secondHead: 1.2, failFirst: false, expected: { startTime: 0.4, endTime: 1.2 } },
    { firstKey: "KeyO", firstHead: 8, secondKey: "KeyI", secondHead: 3, failFirst: false, expected: { startTime: 3, endTime: 8 } },
    { firstKey: "KeyI", firstHead: 0.4, secondKey: "KeyO", secondHead: 1.2, failFirst: true, expected: { startTime: 0.4, endTime: 1.2 } },
    { firstKey: "KeyO", firstHead: 8, secondKey: "KeyI", secondHead: 3, failFirst: true, expected: { startTime: 3, endTime: 8 } },
  ])("preserves rapid $firstKey then $secondKey range marks while saving (first fails: $failFirst)", async ({ firstKey, firstHead, secondKey, secondHead, failFirst, expected }) => {
    const playback = { startTime: 0.01, endTime: null, loop: false, shortcut: null };
    const api = apiFor(library(board("one", "Board", [sound("cue", "Cue", playback)])));
    const save = api.updateSound.getMockImplementation()!;
    const first = deferred<void>();
    api.updateSound.mockImplementationOnce(async (...args) => { await first.promise; return save(...args); });
    const elements: FakeAudio[] = [];
    renderApp(<App api={api} audioFactory={audioFactoryFor(elements)} />);
    const play = await screen.findByRole("button", { name: "Play Cue" });
    act(() => { elements[0]!.currentTime = firstHead; });
    fireEvent.keyDown(play, { code: firstKey });
    act(() => { elements[0]!.currentTime = secondHead; });
    fireEvent.keyDown(screen.getByRole("slider", { name: "Start of Cue" }), { code: secondKey });
    expect(api.updateSound).toHaveBeenCalledOnce();
    await act(async () => {
      if (failFirst) first.reject(new Error("The first range could not be saved."));
      else first.resolve();
    });
    await waitFor(() => expect(api.updateSound).toHaveBeenCalledTimes(2));
    expect(api.snapshot().boards[0]!.sounds[0]!.playback).toEqual({ ...playback, ...expected });
    expect(elements).toHaveLength(1);
    if (failFirst) expect(screen.getByRole("alert")).toHaveTextContent("The first range could not be saved.");
  });

  it("persists loop toggles and shortcut clearing without rebuilding the player", async () => {
    const elements: FakeAudio[] = [];
    const playback = { startTime: 0, endTime: null, loop: false, shortcut: { code: "KeyK", ctrl: true, alt: false, shift: false, meta: false } };
    const api = apiFor(library(board("one", "Board", [sound("cue", "Cue", playback)])));
    renderApp(<App api={api} audioFactory={audioFactoryFor(elements)} />);
    await screen.findByText("Cue");

    const loopSwitch = screen.getByRole("button", { name: "Loop Cue" });
    expect(loopSwitch).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(loopSwitch);
    await waitFor(() => expect(api.updateSound).toHaveBeenLastCalledWith("one", "cue", { ...playback, loop: true }));
    await waitFor(() => expect(elements[0]!.loop).toBe(true));
    fireEvent.click(loopSwitch);
    await waitFor(() => expect(api.updateSound).toHaveBeenLastCalledWith("one", "cue", playback));
    await waitFor(() => expect(elements[0]!.loop).toBe(false));

    expect(screen.getByText("Ctrl + K")).toBeInTheDocument();
    await chooseFromMenu("Cue", "Clear shortcut");
    await waitFor(() => expect(api.updateSound).toHaveBeenLastCalledWith("one", "cue", { ...playback, shortcut: null }));
    expect(elements).toHaveLength(1);
  });

  it("applies saved range and loop changes to an active player", async () => {
    const elements: FakeAudio[] = [];
    const playback = { startTime: 0, endTime: null, loop: false, shortcut: null };
    const api = apiFor(library(board("one", "Board", [sound("cue", "Cue", playback)])));
    renderApp(<App api={api} audioFactory={audioFactoryFor(elements)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Play Cue" }));
    await waitFor(() => expect(elements[0]!.paused).toBe(false));
    act(() => { elements[0]!.currentTime = 5; elements[0]!.dispatch("timeupdate"); });

    fireEvent.click(screen.getByRole("button", { name: "Loop Cue" }));
    await waitFor(() => expect(elements[0]!.loop).toBe(true));
    expect(elements[0]!.paused).toBe(false);

    vi.useFakeTimers();
    const start = screen.getByRole("slider", { name: "Start of Cue" });
    const end = screen.getByRole("slider", { name: "End of Cue" });
    fireEvent.keyDown(start, { key: "Home" });
    fireEvent.keyDown(end, { key: "End" });
    act(() => { elements[0]!.currentTime = 5; });
    await act(async () => { fireEvent.keyDown(screen.getByRole("button", { name: /Pause Cue/ }), { key: "i", code: "KeyI" }); await Promise.resolve(); await Promise.resolve(); });
    expect(api.snapshot().boards[0]!.sounds[0]!.playback).toEqual({ ...playback, startTime: 5, loop: true });
    expect(elements[0]!.currentTime).toBe(5);
    expect(elements[0]!.paused).toBe(false);
    expect(vi.getTimerCount()).toBe(1);

    act(() => { elements[0]!.currentTime = 7; });
    await act(async () => { fireEvent.keyDown(screen.getByRole("button", { name: /Pause Cue/ }), { key: "o", code: "KeyO" }); await Promise.resolve(); await Promise.resolve(); });
    expect(api.snapshot().boards[0]!.sounds[0]!.playback).toEqual({ ...playback, startTime: 5, endTime: 7, loop: true });
    expect(elements[0]!.paused).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    expect(elements).toHaveLength(1);
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("explains a missing desktop bridge instead of throwing on undefined", async () => {
    vi.stubGlobal("soundboard", undefined);
    renderApp(<App />);
    expect(await screen.findByText(/desktop bridge is missing/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("makes an invalid range unreachable: handles cannot cross or collapse, so nothing invalid is sent", async () => {
    const playback = { startTime: 1, endTime: 5, loop: false, shortcut: null };
    const api = apiFor(library(board("one", "Board", [sound("tone", "Tone", playback)])));
    renderApp(<App api={api} audioFactory={audioFactoryFor([])} />);
    await screen.findByText("Tone");
    const start = screen.getByRole("slider", { name: "Start of Tone" });
    const end = screen.getByRole("slider", { name: "End of Tone" });

    fireEvent.keyDown(start, { key: "End" });
    fireEvent.keyUp(start, { key: "End" });
    await waitFor(() => expect(api.updateSound).toHaveBeenLastCalledWith("one", "tone", { ...playback, startTime: 4.9 }));
    fireEvent.keyDown(end, { key: "Home" });
    fireEvent.keyUp(end, { key: "Home" });
    await waitFor(() => expect(api.updateSound).toHaveBeenLastCalledWith("one", "tone", { ...playback, startTime: 4.9, endTime: 5 }));
    for (const [, , settings] of api.updateSound.mock.calls) {
      expect(settings.endTime === null || settings.endTime - settings.startTime >= 0.099).toBe(true);
      expect(settings.startTime).toBeGreaterThanOrEqual(0);
    }
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("loops a partial segment and the full default range", async () => {
    const partialAudio: FakeAudio[] = [];
    const partial = apiFor(library(board("one", "Board", [sound("partial", "Partial", { startTime: 2, endTime: 5, loop: true, shortcut: null })])));
    renderApp(<App api={partial} audioFactory={audioFactoryFor(partialAudio)} />);
    await screen.findByRole("button", { name: "Play Partial" });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Play Partial" }));
    expect(vi.getTimerCount()).toBe(1);
    act(() => { partialAudio[0]!.currentTime = 5; partialAudio[0]!.dispatch("timeupdate"); });
    await act(async () => { await Promise.resolve(); });
    expect(partialAudio[0]!.currentTime).toBe(2);
    expect(partialAudio[0]!.paused).toBe(false);
    expect(partialAudio[0]!.play).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
    act(() => { partialAudio[0]!.currentTime = 5; });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(partialAudio[0]!.currentTime).toBe(2);
    expect(partialAudio[0]!.play).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Stop Partial" }));
    expect(vi.getTimerCount()).toBe(0);
    cleanup();
    vi.useRealTimers();

    const fullAudio: FakeAudio[] = [];
    const full = apiFor(library(board("two", "Full", [sound("full", "Full clip", { startTime: 0, endTime: null, loop: true, shortcut: null })])));
    renderApp(<App api={full} audioFactory={audioFactoryFor(fullAudio)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Play Full clip" }));
    expect(fullAudio[0]!.loop).toBe(true);
    act(() => { fullAudio[0]!.pause(); fullAudio[0]!.dispatch("ended"); });
    expect(fullAudio[0]!.paused).toBe(false);
    expect(fullAudio[0]!.play).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Stop Full clip" }));
    act(() => { fullAudio[0]!.paused = true; fullAudio[0]!.dispatch("ended"); });
    expect(fullAudio[0]!.play).toHaveBeenCalledTimes(2);
  });

  it("stops a segment at its boundary and clears its timer on pause", async () => {
    const elements: FakeAudio[] = [];
    const api = apiFor(library(board("one", "Board", [sound("clip", "Clip", { startTime: 2, endTime: 4, loop: false, shortcut: null })])));
    renderApp(<App api={api} audioFactory={audioFactoryFor(elements)} />);
    await screen.findByRole("button", { name: "Play Clip" });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Play Clip" }));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Pause Clip" }));
    expect(vi.getTimerCount()).toBe(0);
    expect(elements[0]!.currentTime).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Play Clip" }));
    act(() => { elements[0]!.currentTime = 4; });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(elements[0]!.paused).toBe(true);
    expect(elements[0]!.currentTime).toBe(2);
  });

  it("waits for metadata and disables playback for invalid persisted ranges", async () => {
    const elements: FakeAudio[] = [];
    const api = apiFor(library(board("one", "Board", [sound("late", "Late metadata", { startTime: 3, endTime: 6, loop: false, shortcut: null })])));
    const factory = (item: Sound) => {
      const element = new FakeAudio();
      element.duration = Number.NaN;
      element.src = item.id;
      elements.push(element);
      return element;
    };
    renderApp(<App api={api} audioFactory={factory} />);
    await screen.findByText("Late metadata");
    expect(screen.getByRole("button", { name: "Play Late metadata" })).toBeDisabled();
    act(() => { elements[0]!.duration = 4; elements[0]!.dispatch("loadedmetadata"); });
    expect(await screen.findByRole("alert")).toHaveTextContent("The saved time range is outside this audio file.");
    expect(screen.getByRole("button", { name: "Play Late metadata" })).toBeDisabled();
    expect(elements[0]!.play).not.toHaveBeenCalled();
  });

  it("revalidates stored ranges when the file duration changes", async () => {
    const elements: FakeAudio[] = [];
    const api = apiFor(library(board("one", "Board", [sound("clip", "Clip", { startTime: 2, endTime: 10, loop: false, shortcut: null })])));
    renderApp(<App api={api} audioFactory={audioFactoryFor(elements)} />);
    await screen.findByRole("button", { name: "Play Clip" });
    fireEvent.click(screen.getByRole("button", { name: "Play Clip" }));
    act(() => { elements[0]!.duration = 8; elements[0]!.dispatch("durationchange"); });
    expect(await screen.findByRole("alert")).toHaveTextContent("The saved time range is outside this audio file.");
    expect(elements[0]!.paused).toBe(true);
    expect(screen.getByRole("button", { name: "Play Clip" })).toBeDisabled();
  });

  it("captures shortcuts and ignores repeats, unfocused windows, and editable targets", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const elements: FakeAudio[] = [];
    const shortcut = { code: "KeyA", ctrl: true, alt: false, shift: false, meta: false };
    const api = apiFor(library(
      board("one", "First", [sound("a", "Alpha", { startTime: 0, endTime: null, loop: false, shortcut })]),
      board("two", "Second", [sound("b", "Beta", { startTime: 0, endTime: null, loop: false, shortcut })]),
    ));
    renderApp(<App api={api} audioFactory={audioFactoryFor(elements)} />);
    await screen.findByText("Alpha");
    const sendShortcut = (overrides: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent("keydown", { key: "a", code: "KeyA", ctrlKey: true, bubbles: true, cancelable: true, ...overrides });
      act(() => { window.dispatchEvent(event); });
      return event;
    };
    expect(sendShortcut().defaultPrevented).toBe(true);
    expect(elements[0]!.play).toHaveBeenCalledTimes(1);
    sendShortcut({ repeat: true });
    expect(elements[0]!.play).toHaveBeenCalledTimes(1);
    vi.mocked(document.hasFocus).mockReturnValue(false);
    sendShortcut();
    expect(elements[0]!.play).toHaveBeenCalledTimes(1);

    vi.mocked(document.hasFocus).mockReturnValue(true);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Board name" }), { key: "a", code: "KeyA", ctrlKey: true });
    expect(elements[0]!.play).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Second" }));
    await screen.findByText("Beta");
    sendShortcut();
    expect(elements[1]!.play).toHaveBeenCalledTimes(1);
  });

  it("records a shortcut and cancels recording when the window loses focus", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const api = apiFor(library(board("one", "Board", [sound("cue", "Cue")])));
    renderApp(<App api={api} audioFactory={audioFactoryFor([])} />);
    await screen.findByText("Cue");
    await chooseFromMenu("Cue", "Record shortcut");
    vi.mocked(document.hasFocus).mockReturnValue(false);
    const unfocused = new KeyboardEvent("keydown", { key: "u", code: "KeyU", ctrlKey: true, bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(unfocused); });
    expect(api.updateSound).not.toHaveBeenCalled();
    vi.mocked(document.hasFocus).mockReturnValue(true);
    const repeated = new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true, repeat: true, bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(repeated); });
    const composing = new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true, isComposing: true, bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(composing); });
    expect(api.updateSound).not.toHaveBeenCalled();
    const event = new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(screen.getByText("Ctrl + Shift + K")).toBeInTheDocument());
    expect(api.updateSound).toHaveBeenCalledWith("one", "cue", {
      startTime: 0,
      endTime: null,
      loop: false,
      shortcut: { code: "KeyK", ctrl: true, alt: false, shift: true, meta: false },
    });

    await chooseFromMenu("Cue", /^Change shortcut/);
    expect(screen.getByRole("button", { name: "Cancel shortcut recording for Cue" })).toBeInTheDocument();
    act(() => { window.dispatchEvent(new Event("blur")); });
    expect(screen.queryByRole("button", { name: "Cancel shortcut recording for Cue" })).toBeNull();
    const late = new KeyboardEvent("keydown", { key: "x", code: "KeyX", ctrlKey: true, bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(late); });
    expect(api.updateSound).toHaveBeenCalledTimes(1);
  });
});
