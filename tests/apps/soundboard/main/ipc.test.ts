import { describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron';
import type { SoundLibrary } from '../../../../apps/soundboard/shared/desktop-api';
import { isTrustedInvocation, registerSoundboardIpc } from '../../../../apps/soundboard/main/ipc';
import { IPC_CHANNELS } from '../../../../apps/soundboard/main/ipc-channels';

const electronMock = vi.hoisted(() => ({ handle: vi.fn(), removeHandler: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: electronMock }));

const BOARD_ID = '26a00123-1234-4234-8234-123456789013';
const SOUND_ID = '26a00123-1234-4234-8234-123456789012';
const library: SoundLibrary = { version: 2, boards: [{ id: BOARD_ID, name: 'Board', sounds: [] }] };

function makeHarness(boards: SoundLibrary = library) {
  const frame = { url: 'file:///app/renderer/index.html' } as WebFrameMain;
  const contents = { mainFrame: frame } as WebContents;
  const store = {
    load: vi.fn().mockResolvedValue(boards),
    createBoard: vi.fn().mockResolvedValue(boards),
    renameBoard: vi.fn().mockResolvedValue(boards),
    removeBoard: vi.fn().mockResolvedValue(boards),
    importSounds: vi.fn().mockResolvedValue(boards),
    removeSound: vi.fn().mockResolvedValue(boards),
    updateSound: vi.fn().mockResolvedValue(boards),
  };
  const dialogs = { chooseAudioFiles: vi.fn().mockResolvedValue(null) };
  electronMock.handle.mockClear();
  electronMock.removeHandler.mockClear();
  registerSoundboardIpc(store as never, dialogs, () => contents, (url) => url === frame.url);
  const handlers = new Map(electronMock.handle.mock.calls.map(([channel, handler]) => [channel, handler]));
  const event = { sender: contents, senderFrame: frame } as IpcMainInvokeEvent;
  const untrustedEvent = { sender: contents, senderFrame: { url: 'https://attacker.invalid' } as WebFrameMain } as IpcMainInvokeEvent;
  return { store, dialogs, handlers, event, untrustedEvent };
}

describe('soundboard IPC trust boundary', () => {
  it('requires the owning webContents and its trusted main frame', () => {
    const frame = { url: 'file:///app/renderer/index.html' } as WebFrameMain;
    const otherFrame = { url: 'file:///app/renderer/index.html' } as WebFrameMain;
    const contents = { mainFrame: frame } as WebContents;
    const event = { sender: contents, senderFrame: frame } as IpcMainInvokeEvent;
    const trusted = (url: string) => url === frame.url;

    expect(isTrustedInvocation(event, contents, trusted)).toBe(true);
    expect(isTrustedInvocation({ ...event, senderFrame: otherFrame }, contents, trusted)).toBe(false);
    expect(isTrustedInvocation({ ...event, senderFrame: { url: 'https://attacker.invalid' } as WebFrameMain }, contents, trusted)).toBe(false);
    expect(isTrustedInvocation({ ...event, sender: {} as WebContents }, contents, trusted)).toBe(false);
  });

  it('rejects every untrusted invocation before calling storage or dialogs', async () => {
    const { store, dialogs, handlers, untrustedEvent } = makeHarness();
    for (const handler of handlers.values()) {
      await expect(handler(untrustedEvent)).rejects.toThrow(/Untrusted renderer/);
    }
    expect(store.load).not.toHaveBeenCalled();
    expect(store.createBoard).not.toHaveBeenCalled();
    expect(store.renameBoard).not.toHaveBeenCalled();
    expect(store.removeBoard).not.toHaveBeenCalled();
    expect(store.importSounds).not.toHaveBeenCalled();
    expect(store.removeSound).not.toHaveBeenCalled();
    expect(store.updateSound).not.toHaveBeenCalled();
    expect(dialogs.chooseAudioFiles).not.toHaveBeenCalled();
  });

  it('delegates trusted load, create, rename, and remove calls', async () => {
    const { store, handlers, event } = makeHarness();
    await handlers.get(IPC_CHANNELS.load)!(event);
    await handlers.get(IPC_CHANNELS.createBoard)!(event, 'New board');
    await handlers.get(IPC_CHANNELS.renameBoard)!(event, BOARD_ID, 'Renamed');
    await handlers.get(IPC_CHANNELS.removeBoard)!(event, BOARD_ID);
    await handlers.get(IPC_CHANNELS.removeSound)!(event, BOARD_ID, SOUND_ID);
    const playback = { startTime: 1, endTime: 3, loop: true, shortcut: null };
    await handlers.get(IPC_CHANNELS.updateSound)!(event, BOARD_ID, SOUND_ID, playback);
    expect(store.load).toHaveBeenCalledOnce();
    expect(store.createBoard).toHaveBeenCalledWith('New board');
    expect(store.renameBoard).toHaveBeenCalledWith(BOARD_ID, 'Renamed');
    expect(store.removeBoard).toHaveBeenCalledWith(BOARD_ID);
    expect(store.removeSound).toHaveBeenCalledWith(BOARD_ID, SOUND_ID);
    expect(store.updateSound).toHaveBeenCalledWith(BOARD_ID, SOUND_ID, playback);
  });

  it('returns the unchanged library when audio import is cancelled', async () => {
    const { store, dialogs, handlers, event } = makeHarness();
    dialogs.chooseAudioFiles.mockResolvedValueOnce(null);
    await expect(handlers.get(IPC_CHANNELS.importSounds)!(event, BOARD_ID)).resolves.toBe(library);
    expect(store.load).toHaveBeenCalledOnce();
    expect(dialogs.chooseAudioFiles).toHaveBeenCalledOnce();
    expect(store.importSounds).not.toHaveBeenCalled();
  });

  it('does not open the chooser for a missing board and delegates selected paths', async () => {
    const emptyLibrary: SoundLibrary = { version: 2, boards: [] };
    const missing = makeHarness(emptyLibrary);
    await expect(missing.handlers.get(IPC_CHANNELS.importSounds)!(missing.event, BOARD_ID)).rejects.toThrow(/Board was not found/);
    expect(missing.dialogs.chooseAudioFiles).not.toHaveBeenCalled();

    const valid = makeHarness();
    valid.dialogs.chooseAudioFiles.mockResolvedValueOnce(['/audio/click.wav', '/audio/chime.mp3']);
    await valid.handlers.get(IPC_CHANNELS.importSounds)!(valid.event, BOARD_ID);
    expect(valid.store.importSounds).toHaveBeenCalledWith(BOARD_ID, ['/audio/click.wav', '/audio/chime.mp3']);
  });
});
