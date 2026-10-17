import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function apiFor(initial: SoundLibrary): SoundboardAPI & { snapshot: () => SoundLibrary } {
  let value = initial;
  const clone = () => structuredClone(value);
  return {
    snapshot: clone,
    load: vi.fn(async () => clone()),
    createBoard: vi.fn(async (name) => { value.boards.push(board(`board-${value.boards.length + 1}`, name)); return clone(); }),
    renameBoard: vi.fn(async (id, name) => { const item = value.boards.find((candidate) => candidate.id === id); if (item) item.name = name; return clone(); }),
    importSounds: vi.fn(async (id) => { const item = value.boards.find((candidate) => candidate.id === id); item?.sounds.push(sound(`${id}-sound`, "Imported cue")); return clone(); }),
    removeSound: vi.fn(async (boardId, soundId) => { const item = value.boards.find((candidate) => candidate.id === boardId); if (item) item.sounds = item.sounds.filter((itemSound) => itemSound.id !== soundId); return clone(); }),
    updateSound: vi.fn(async (boardId, soundId, playback: SoundPlaybackSettings) => { const item = value.boards.find((candidate) => candidate.id === boardId)?.sounds.find((candidate) => candidate.id === soundId); if (item) item.playback = structuredClone(playback); return clone(); }),
  };
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

describe("soundboard renderer", () => {
  it("creates boards, renames the selected board, imports sounds, and removes them", async () => {
    const api = apiFor(library());
    render(<App api={api} />);

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
    fireEvent.click(screen.getByRole("button", { name: "Remove Imported cue" }));
    expect(await screen.findByText("No sounds in this board")).toBeInTheDocument();
    expect(api.removeSound).toHaveBeenCalledWith("board-1", "board-1-sound");
  });

  it("supports concurrent playback, pause, resume, stop, and natural end", async () => {
    const elements: FakeAudio[] = [];
    const api = apiFor(library(board("one", "Effects", [sound("rain", "Rain"), sound("bell", "Bell")])));
    render(<App api={api} audioFactory={audioFactoryFor(elements)} />);
    await screen.findByText("Rain");

    fireEvent.click(screen.getByRole("button", { name: "Play Rain" }));
    fireEvent.click(screen.getByRole("button", { name: "Play Bell" }));
    await waitFor(() => expect(screen.getAllByText("PLAYING")).toHaveLength(2));
    expect(elements[0]!.play).toHaveBeenCalledOnce();
    expect(elements[1]!.play).toHaveBeenCalledOnce();

    act(() => { elements[0]!.currentTime = 7; elements[0]!.dispatch("timeupdate"); });
    fireEvent.click(screen.getByRole("button", { name: "Pause Rain" }).closest(".play-button")!);
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
    render(<App api={api} audioFactory={audioFactoryFor(elements)} />);
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
    render(<App api={api} audioFactory={audioFactoryFor(elements)} />);
    fireEvent.click(await screen.findByRole("button", { name: /First/ }));
    fireEvent.click(screen.getByRole("button", { name: "Play Cue" }));
    await waitFor(() => expect(screen.getByText("PLAYING")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Second/ }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Board name" })).toHaveValue("Second"));
    expect(elements[0]!.currentTime).toBe(0);
    expect(elements[0]!.pause).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /First/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove Cue" }));
    await screen.findByText("No sounds in this board");
    expect(elements[0]!.src).toBe("");
    expect(elements.at(-1)!.src).toBe("");
    expect(elements.at(-1)!.load).toHaveBeenCalled();
  });

  it("shows media errors and ignores a play promise that resolves after pause", async () => {
    const elements: FakeAudio[] = [];
    const api = apiFor(library(board("one", "Board", [sound("cue", "Cue")])));
    render(<App api={api} audioFactory={audioFactoryFor(elements)} />);
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
    expect(screen.queryByText("PLAYING")).not.toBeInTheDocument();

    elements[0]!.pendingPlay = Promise.reject(new DOMException("blocked", "NotAllowedError"));
    fireEvent.click(screen.getByRole("button", { name: "Play Cue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Playback was blocked. Try again.");

    act(() => elements[0]!.dispatch("error"));
    expect(screen.getByRole("alert")).toHaveTextContent("This audio file couldn’t be loaded.");
  });

  it("keeps the loaded library visible when a mutation fails", async () => {
    const api = apiFor(library(board("one", "Board")));
    vi.mocked(api.importSounds).mockRejectedValue(new Error("Import failed"));
    render(<App api={api} />);
    expect(await screen.findByRole("textbox", { name: "Board name" })).toHaveValue("Board");
    fireEvent.click(screen.getAllByRole("button", { name: "Add sounds" })[0]!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Import failed");
    expect(screen.getByRole("textbox", { name: "Board name" })).toHaveValue("Board");
  });

  it("retries a failed initial library load", async () => {
    const api = apiFor(library(board("one", "Recovered")));
    vi.mocked(api.load).mockRejectedValueOnce(new Error("Library is unavailable"));
    render(<App api={api} />);
    expect(await screen.findByText("Couldn’t open your boards")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Board name" })).toHaveValue("Recovered"));
    expect(api.load).toHaveBeenCalledTimes(2);
  });

  it("does not overlap duplicate import requests", async () => {
    const api = apiFor(library(board("one", "Board")));
    let finishImport!: (result: SoundLibrary) => void;
    vi.mocked(api.importSounds).mockImplementation(() => new Promise((resolve) => { finishImport = resolve; }));
    render(<App api={api} />);
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

  it("loads fractional timestamps, seeks inside the segment, and saves parsed values", async () => {
    const playback = { startTime: 1.5, endTime: 8.5, loop: false, shortcut: null };
    const elements: FakeAudio[] = [];
    const api = apiFor(library(board("one", "Board", [sound("tone", "Tone", playback)])));
    render(<App api={api} audioFactory={audioFactoryFor(elements)} />);
    await screen.findByText("Tone");

    const start = screen.getByRole("textbox", { name: "Start time for Tone" });
    const end = screen.getByRole("textbox", { name: "End time for Tone" });
    expect(start).toHaveValue("0:01.5");
    expect(end).toHaveValue("0:08.5");
    const slider = screen.getByRole("slider", { name: "Seek Tone" });
    expect(slider).toHaveAttribute("min", "1.5");
    expect(slider).toHaveAttribute("max", "8.5");
    fireEvent.change(slider, { target: { value: "4.125" } });
    expect(elements[0]!.currentTime).toBe(4.125);

    fireEvent.change(start, { target: { value: "00:02.125" } });
    fireEvent.change(end, { target: { value: "00:07.75" } });
    fireEvent.click(screen.getByRole("button", { name: "Save range for Tone" }));
    await waitFor(() => expect(api.updateSound).toHaveBeenCalledWith("one", "tone", {
      ...playback,
      startTime: 2.125,
      endTime: 7.75,
    }));
  });

  it("persists loop toggles and shortcut clearing without rebuilding the player", async () => {
    const elements: FakeAudio[] = [];
    const playback = { startTime: 0, endTime: null, loop: false, shortcut: { code: "KeyK", ctrl: true, alt: false, shift: false, meta: false } };
    const api = apiFor(library(board("one", "Board", [sound("cue", "Cue", playback)])));
    render(<App api={api} audioFactory={audioFactoryFor(elements)} />);
    await screen.findByText("Cue");

    const loopSwitch = screen.getByRole("switch", { name: "Loop Cue" });
    fireEvent.click(loopSwitch);
    await waitFor(() => expect(api.updateSound).toHaveBeenLastCalledWith("one", "cue", { ...playback, loop: true }));
    expect(elements[0]!.loop).toBe(true);
    fireEvent.click(loopSwitch);
    await waitFor(() => expect(api.updateSound).toHaveBeenLastCalledWith("one", "cue", playback));
    expect(elements[0]!.loop).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Clear shortcut for Cue" }));
    await waitFor(() => expect(api.updateSound).toHaveBeenLastCalledWith("one", "cue", { ...playback, shortcut: null }));
    expect(elements).toHaveLength(1);
  });

  it("applies saved range and loop changes to an active player", async () => {
    const elements: FakeAudio[] = [];
    const playback = { startTime: 0, endTime: null, loop: false, shortcut: null };
    const api = apiFor(library(board("one", "Board", [sound("cue", "Cue", playback)])));
    render(<App api={api} audioFactory={audioFactoryFor(elements)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Play Cue" }));
    await waitFor(() => expect(elements[0]!.paused).toBe(false));
    act(() => { elements[0]!.currentTime = 5; elements[0]!.dispatch("timeupdate"); });

    fireEvent.click(screen.getByRole("switch", { name: "Loop Cue" }));
    await waitFor(() => expect(elements[0]!.loop).toBe(true));
    expect(elements[0]!.paused).toBe(false);

    vi.useFakeTimers();
    const start = screen.getByRole("textbox", { name: "Start time for Cue" });
    const end = screen.getByRole("textbox", { name: "End time for Cue" });
    const save = screen.getByRole("button", { name: "Save range for Cue" });
    fireEvent.change(start, { target: { value: "2" } });
    fireEvent.change(end, { target: { value: "8" } });
    await act(async () => { fireEvent.click(save); await Promise.resolve(); await Promise.resolve(); });
    expect(api.snapshot().boards[0]!.sounds[0]!.playback).toEqual({ ...playback, startTime: 2, endTime: 8, loop: true });
    expect(elements[0]!.currentTime).toBe(5);
    expect(elements[0]!.paused).toBe(false);
    expect(vi.getTimerCount()).toBe(1);

    fireEvent.change(start, { target: { value: "6" } });
    fireEvent.change(end, { target: { value: "9" } });
    await act(async () => { fireEvent.click(save); await Promise.resolve(); await Promise.resolve(); });
    expect(api.snapshot().boards[0]!.sounds[0]!.playback).toEqual({ ...playback, startTime: 6, endTime: 9, loop: true });
    expect(elements[0]!.currentTime).toBe(6);
    expect(elements[0]!.paused).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    expect(elements).toHaveLength(1);
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("rejects invalid time ranges without sending them to the API", async () => {
    const playback = { startTime: 1, endTime: 5, loop: false, shortcut: null };
    const api = apiFor(library(board("one", "Board", [sound("tone", "Tone", playback)])));
    render(<App api={api} audioFactory={audioFactoryFor([])} />);
    await screen.findByText("Tone");
    const start = screen.getByRole("textbox", { name: "Start time for Tone" });
    const end = screen.getByRole("textbox", { name: "End time for Tone" });
    const save = screen.getByRole("button", { name: "Save range for Tone" });

    fireEvent.change(end, { target: { value: "0:00.5" } });
    fireEvent.click(save);
    expect(await screen.findByRole("alert")).toHaveTextContent("End time must be after start time.");
    expect(api.updateSound).not.toHaveBeenCalled();

    fireEvent.change(end, { target: { value: "18.01" } });
    fireEvent.click(save);
    expect(await screen.findByRole("alert")).toHaveTextContent("End time can’t exceed the audio duration.");
    fireEvent.change(end, { target: { value: "1:" } });
    fireEvent.click(save);
    expect(await screen.findByRole("alert")).toHaveTextContent("End time must be after start time.");
    fireEvent.change(end, { target: { value: "1:0x10" } });
    fireEvent.click(save);
    expect(await screen.findByRole("alert")).toHaveTextContent("End time must be after start time.");
    fireEvent.change(end, { target: { value: "" } });
    fireEvent.change(start, { target: { value: "18" } });
    fireEvent.click(save);
    expect(await screen.findByRole("alert")).toHaveTextContent("Start time must be before the audio ends.");
    expect(api.updateSound).not.toHaveBeenCalled();
  });

  it("loops a partial segment and the full default range", async () => {
    const partialAudio: FakeAudio[] = [];
    const partial = apiFor(library(board("one", "Board", [sound("partial", "Partial", { startTime: 2, endTime: 5, loop: true, shortcut: null })])));
    render(<App api={partial} audioFactory={audioFactoryFor(partialAudio)} />);
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
    render(<App api={full} audioFactory={audioFactoryFor(fullAudio)} />);
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
    render(<App api={api} audioFactory={audioFactoryFor(elements)} />);
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
    render(<App api={api} audioFactory={factory} />);
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
    render(<App api={api} audioFactory={audioFactoryFor(elements)} />);
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
    render(<App api={api} audioFactory={audioFactoryFor(elements)} />);
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
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Start time for Alpha" }), { key: "a", code: "KeyA", ctrlKey: true });
    expect(elements[0]!.play).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Second" }));
    await screen.findByText("Beta");
    sendShortcut();
    expect(elements[1]!.play).toHaveBeenCalledTimes(1);
  });

  it("records a shortcut and cancels recording when the window loses focus", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const api = apiFor(library(board("one", "Board", [sound("cue", "Cue")])));
    render(<App api={api} audioFactory={audioFactoryFor([])} />);
    await screen.findByText("Cue");
    fireEvent.click(screen.getByRole("button", { name: "Record shortcut for Cue" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Record shortcut for Cue" }));
    act(() => { window.dispatchEvent(new Event("blur")); });
    expect(screen.getByRole("button", { name: "Record shortcut for Cue" })).toBeInTheDocument();
    const late = new KeyboardEvent("keydown", { key: "x", code: "KeyX", ctrlKey: true, bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(late); });
    expect(api.updateSound).toHaveBeenCalledTimes(1);
  });
});
