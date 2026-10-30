import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { LibraryStore, AUDIO_EXTENSIONS } from './library-store';
import { IPC_CHANNELS } from './ipc-channels';

export interface IpcDialogs {
  chooseAudioFiles(): Promise<string[] | null>;
}

export function isTrustedInvocation(event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>, contents: WebContents, isTrustedUrl: (url: string) => boolean): boolean {
  return event.sender === contents && event.senderFrame !== null && event.senderFrame === contents.mainFrame && isTrustedUrl(event.senderFrame.url);
}

export function registerSoundboardIpc(store: LibraryStore, dialogs: IpcDialogs, getContents: () => WebContents | null, isTrustedUrl: (url: string) => boolean): () => void {
  // Handlers are async so a refused invocation is always a rejected promise, never a synchronous throw,
  // and the check runs before any store or dialog access.
  const assertTrusted = (event: IpcMainInvokeEvent): void => {
    const contents = getContents();
    if (!contents || !isTrustedInvocation(event, contents, isTrustedUrl)) throw new Error('Untrusted renderer invocation.');
  };
  const handlers: Array<[string, (_event: IpcMainInvokeEvent, ...args: any[]) => unknown]> = [
    [IPC_CHANNELS.load, async (event) => {
      assertTrusted(event);
      return store.load();
    }],
    [IPC_CHANNELS.createBoard, async (event, name) => {
      assertTrusted(event);
      return store.createBoard(name);
    }],
    [IPC_CHANNELS.renameBoard, async (event, boardId, name) => {
      assertTrusted(event);
      return store.renameBoard(boardId, name);
    }],
    [IPC_CHANNELS.removeBoard, async (event, boardId) => {
      assertTrusted(event);
      return store.removeBoard(boardId);
    }],
    [IPC_CHANNELS.importSounds, async (event, boardId) => {
      assertTrusted(event);
      const library = await store.load();
      if (!library.boards.some((board) => board.id === boardId)) throw new Error('Board was not found.');
      const paths = await dialogs.chooseAudioFiles();
      return paths === null || paths.length === 0 ? library : store.importSounds(boardId, paths);
    }],
    [IPC_CHANNELS.removeSound, async (event, boardId, soundId) => {
      assertTrusted(event);
      return store.removeSound(boardId, soundId);
    }],
    [IPC_CHANNELS.updateSound, async (event, boardId, soundId, settings) => {
      assertTrusted(event);
      return store.updateSound(boardId, soundId, settings);
    }],
  ];
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler);
  return () => { for (const [channel] of handlers) ipcMain.removeHandler(channel); };
}

export function audioDialogExtensions(): string[] { return [...AUDIO_EXTENSIONS]; }
