import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSoundRange } from "../../../../apps/soundboard/renderer/use-sound-range";
import type { SaveSoundSettings } from "../../../../apps/soundboard/renderer/sound-ports";
import type { SoundPlaybackSettings } from "../../../../apps/soundboard/shared/desktop-api";

afterEach(cleanup);
const settings: SoundPlaybackSettings = { startTime: 0, endTime: null, loop: false, shortcut: null };

describe("sound range owner", () => {
  it.each([
    { first: "in", firstHead: 0.4, second: "out", secondHead: 1.2, firstResult: "saved", expected: { startTime: 0.4, endTime: 1.2 } },
    { first: "out", firstHead: 8, second: "in", secondHead: 3, firstResult: "saved", expected: { startTime: 3, endTime: 8 } },
    { first: "in", firstHead: 0.4, second: "out", secondHead: 1.2, firstResult: "failed", expected: { startTime: 0.4, endTime: 1.2 } },
    { first: "out", firstHead: 8, second: "in", secondHead: 3, firstResult: "failed", expected: { startTime: 3, endTime: 8 } },
  ] as const)("composes rapid $first then $second commands when the first write is $firstResult", async ({ first, firstHead, secondHead, firstResult, expected }) => {
    let finish!: (result: "saved" | "failed") => void;
    let playhead: number = firstHead;
    const save = vi.fn<SaveSoundSettings>().mockResolvedValue("saved");
    save.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = renderHook(() => useSoundRange({ soundId: "cue", settings: { ...settings, startTime: 0.01 }, duration: 18, readPlayhead: () => playhead, save }));
    act(() => {
      if (first === "in") view.result.current.markIn();
      else view.result.current.markOut();
      playhead = secondHead;
      if (first === "in") view.result.current.markOut();
      else view.result.current.markIn();
    });
    expect(save).toHaveBeenCalledOnce();
    await act(async () => { finish(firstResult); });
    expect(save).toHaveBeenLastCalledWith("cue", expected, { preserveError: true });
  });

  it("keeps submitted bounds through the promise-to-render gap and rebases after canonical acknowledgement", async () => {
    let playhead = 0.4;
    const save = vi.fn<SaveSoundSettings>().mockResolvedValue("saved");
    const view = renderHook(({ saved }) => useSoundRange({ soundId: "cue", settings: saved, duration: 18, readPlayhead: () => playhead, save }), { initialProps: { saved: settings } });
    await act(async () => { view.result.current.markIn(); });
    playhead = 1.2;
    await act(async () => { view.result.current.markOut(); });
    expect(save).toHaveBeenLastCalledWith("cue", { startTime: 0.4, endTime: 1.2 });
    view.rerender({ saved: { ...settings, startTime: 0.4, endTime: 1.2 } });
    view.rerender({ saved: { ...settings, startTime: 2, endTime: 6 } });
    playhead = 4;
    await act(async () => { view.result.current.markOut(); });
    expect(save).toHaveBeenLastCalledWith("cue", { startTime: 2, endTime: 4 });
  });

  it("keeps a newer submitted range when canonical props acknowledge an older write", async () => {
    let finish!: (result: "saved") => void;
    let playhead = 0.4;
    const save = vi.fn<SaveSoundSettings>().mockResolvedValue("saved");
    save.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = renderHook(({ saved }) => useSoundRange({ soundId: "cue", settings: saved, duration: 18, readPlayhead: () => playhead, save }), { initialProps: { saved: settings } });
    act(() => {
      view.result.current.markIn();
      playhead = 1.2;
      view.result.current.markOut();
    });
    view.rerender({ saved: { ...settings, startTime: 0.4 } });
    playhead = 0.8;
    act(() => { view.result.current.markIn(); });
    await act(async () => { finish("saved"); });
    expect(save).toHaveBeenLastCalledWith("cue", { startTime: 0.8, endTime: 1.2 }, { preserveError: true });
  });

  it("keeps pointer-only previews separate from submitted command bounds", async () => {
    const save = vi.fn<SaveSoundSettings>().mockResolvedValue("saved");
    const view = renderHook(() => useSoundRange({ soundId: "cue", settings, duration: 18, readPlayhead: () => 5, save }));
    await act(async () => {
      view.result.current.change([2, 8]);
      view.result.current.markOut();
    });
    expect(save).toHaveBeenLastCalledWith("cue", { startTime: 0, endTime: 5 });
  });

  it("preserves a newer pointer-only preview when an older submitted range is acknowledged", async () => {
    let finish!: (result: "saved") => void;
    const save = vi.fn<SaveSoundSettings>(() => new Promise((resolve) => { finish = resolve; }));
    const view = renderHook(({ saved }) => useSoundRange({ soundId: "cue", settings: saved, duration: 18, readPlayhead: () => 5, save }), { initialProps: { saved: settings } });
    act(() => {
      view.result.current.change([1, 8]);
      void view.result.current.commit([1, 8]);
      view.result.current.change([2, 9]);
    });
    await act(async () => { finish("saved"); });
    view.rerender({ saved: { ...settings, startTime: 1, endTime: 8 } });
    expect(view.result.current.range).toEqual([2, 9]);
    expect(save).toHaveBeenCalledOnce();
  });

  it("cancels only the pointer preview while preserving submitted writes and command bounds", async () => {
    let finish!: (result: "saved") => void;
    const save = vi.fn<SaveSoundSettings>().mockResolvedValue("saved");
    save.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = renderHook(() => useSoundRange({ soundId: "cue", settings, duration: 18, readPlayhead: () => 5, save }));
    act(() => {
      void view.result.current.commit([2, 8]);
      view.result.current.change([3, 9]);
      view.result.current.cancelPreview();
    });
    expect(view.result.current.range).toEqual([0, 18]);
    expect(save).toHaveBeenCalledOnce();
    act(() => { view.result.current.markOut(); });
    await act(async () => { finish("saved"); });
    expect(save).toHaveBeenLastCalledWith("cue", { startTime: 2, endTime: 5 }, { preserveError: true });
  });

  it("drops unsent coalesced work when its tile unmounts", async () => {
    let finish!: (result: "saved") => void;
    const save = vi.fn<SaveSoundSettings>(() => new Promise((resolve) => { finish = resolve; }));
    const view = renderHook(() => useSoundRange({ soundId: "cue", settings, duration: 18, readPlayhead: () => 5, save }));
    act(() => {
      void view.result.current.commit([1, 8]);
      void view.result.current.commit([2, 9]);
      void view.result.current.commit([3, 10]);
    });
    expect(save).toHaveBeenCalledOnce();
    view.unmount();
    await act(async () => { finish("saved"); });
    expect(save).toHaveBeenCalledOnce();
  });

  it("returns failed edits to saved handles without retrying the rejected write", async () => {
    const save = vi.fn<SaveSoundSettings>().mockResolvedValue("failed");
    const view = renderHook(() => useSoundRange({ soundId: "cue", settings, duration: 18, readPlayhead: () => 5, save }));
    await act(async () => {
      view.result.current.change([2, 8]);
      await view.result.current.commit([2, 8]);
    });
    expect(save).toHaveBeenCalledExactlyOnceWith("cue", { startTime: 2, endTime: 8 });
    expect(view.result.current.range).toEqual([0, 18]);
    await act(async () => { view.result.current.markOut(); });
    expect(save).toHaveBeenLastCalledWith("cue", { startTime: 0, endTime: 5 });
  });
});
