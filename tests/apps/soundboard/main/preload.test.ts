import { describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "../../../../apps/soundboard/main/ipc-channels";

const exposeInMainWorld = vi.fn();
const invoke = vi.fn();
vi.mock("electron", () => ({ contextBridge: { exposeInMainWorld }, ipcRenderer: { invoke } }));

describe("preload", () => {
  it("exposes the full SoundboardAPI as window.soundboard and routes calls over IPC", async () => {
    await import("../../../../apps/soundboard/main/preload");
    expect(exposeInMainWorld).toHaveBeenCalledWith("soundboard", expect.any(Object));
    const api = exposeInMainWorld.mock.calls[0][1];
    expect(Object.keys(api).sort()).toEqual(["createBoard", "importSounds", "load", "removeSound", "renameBoard", "updateSound"]);
    api.load();
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.load);
  });
});
