import type { IpcMain, IpcMainEvent, WebContents } from 'electron';
import { IPC_CHANNELS } from './ipc-channels';

/** Keeps the renderer alive while its debounced project revision reaches disk. */
export class WorkspaceShutdown {
  private requestId = 0;
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly ipc: Pick<IpcMain, 'on' | 'removeListener'>,
    private readonly getContents: () => WebContents | null,
    private readonly isTrustedUrl: (url: string) => boolean,
    private readonly drainStore: () => Promise<void>,
    private readonly timeoutMs = 10_000,
  ) {}

  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushRenderer().then(() => this.drainStore()).catch((error) => {
      this.resume();
      throw error;
    }).finally(() => { this.flushing = null; });
    return this.flushing;
  }

  resume(): void {
    const contents = this.getContents();
    if (contents && !contents.isDestroyed()) contents.send(IPC_CHANNELS.flushProject, this.requestId, false);
  }

  private flushRenderer(): Promise<void> {
    const contents = this.getContents();
    if (!contents || contents.isDestroyed() || contents.isCrashed() || !this.isTrustedUrl(contents.mainFrame.url)) return Promise.resolve();
    const requestId = ++this.requestId;
    return new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        this.ipc.removeListener(IPC_CHANNELS.projectFlushed, acknowledge);
        contents.removeListener('destroyed', destroyed);
        contents.removeListener('render-process-gone', destroyed);
        if (error) reject(error); else resolve();
      };
      const acknowledge = (event: IpcMainEvent, receivedId: unknown, saved: unknown) => {
        if (receivedId !== requestId || event.sender !== contents || event.senderFrame !== contents.mainFrame
          || !this.isTrustedUrl(event.senderFrame.url)) return;
        finish(saved === true ? undefined : new Error('Project settings could not be saved. Try closing Stream again after resolving the save error.'));
      };
      // A crashed renderer has no pending state we can recover; accepted main
      // process operations still drain before shutdown.
      const destroyed = () => finish();
      const timer = setTimeout(() => finish(new Error('Stream did not respond while saving project settings. Try closing it again.')), this.timeoutMs);
      this.ipc.on(IPC_CHANNELS.projectFlushed, acknowledge);
      contents.once('destroyed', destroyed);
      contents.once('render-process-gone', destroyed);
      try { contents.send(IPC_CHANNELS.flushProject, requestId); }
      catch (error) { finish(error instanceof Error ? error : new Error('Project settings could not be saved.')); }
    });
  }
}
