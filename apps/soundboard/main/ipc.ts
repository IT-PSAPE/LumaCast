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
  const handlers: Array<[string, (_event: IpcMainInvokeEvent, ...args: any[]) => unknown]> = [
    [IPC_CHANNELS.load, (event) => {
      if (!getContents() || !isTrustedInvocation(event, getContents()!, isTrustedUrl)) throw new Error('Untrusted renderer invocation.');
      return store.load();
    }],
    [IPC_CHANNELS.createBoard, (event, name) => {
      if (!getContents() || !isTrustedInvocation(event, getContents()!, isTrustedUrl)) throw new Error('Untrusted renderer invocation.');
      return store.createBoard(name);
    }],
    [IPC_CHANNELS.renameBoard, (event, boardId, name) => {
      if (!getContents() || !isTrustedInvocation(event, getContents()!, isTrustedUrl)) throw new Error('Untrusted renderer invocation.');
      return store.renameBoard(boardId, name);
    }],
    [IPC_CHANNELS.importSounds, async (event, boardId) => {
      const contents = getContents();
      if (!contents || !isTrustedInvocation(event, contents, isTrustedUrl)) throw new Error('Untrusted renderer invocation.');
      const library = await store.load();
      if (!library.boards.some((board) => board.id === boardId)) throw new Error('Board was not found.');
      const paths = await dialogs.chooseAudioFiles();
      return paths === null || paths.length === 0 ? library : store.importSounds(boardId, paths);
    }],
    [IPC_CHANNELS.removeSound, (event, boardId, soundId) => {
      if (!getContents() || !isTrustedInvocation(event, getContents()!, isTrustedUrl)) throw new Error('Untrusted renderer invocation.');
      return store.removeSound(boardId, soundId);
    }],
    [IPC_CHANNELS.updateSound, (event, boardId, soundId, settings) => {
      if (!getContents() || !isTrustedInvocation(event, getContents()!, isTrustedUrl)) throw new Error('Untrusted renderer invocation.');
      return store.updateSound(boardId, soundId, settings);
    }],
  ];
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler);
  return () => { for (const [channel] of handlers) ipcMain.removeHandler(channel); };
}

export function audioDialogExtensions(): string[] { return [...AUDIO_EXTENSIONS]; }
