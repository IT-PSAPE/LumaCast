import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  type IpcMainInvokeEvent,
} from 'electron';
import path from 'node:path';
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { imageExtensions } from '@lumacast/photo-model';
import { configureRawDecoder, RenderPool } from '@lumacast/photo-imaging';
import { Commands, LatestPreview, PhotoService } from '@lumacast/photo-library';
import { APP_IDENTITY } from './app-identity';
import { createMainWindow } from './window';
import { resolveUserData } from './user-data';
import { resolveImagingResources } from './imaging/paths';
import { CATALOG_CHANGE_CHANNEL, IPC_CHANNELS } from './ipc-channels';
import { startMcp } from './mcp/server';

// The `lumaflux:` scheme serves photo thumbnails to <img> elements. It is
// registered before `app.whenReady()` because privileges cannot be granted
// afterwards; `standard` keeps it same-origin with the renderer document and
// therefore covered by the renderer's `default-src 'self'` CSP.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'lumaflux',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

// User data must be pinned before anything reads it, and before the single
// instance lock, so a second launch is judged against the same directory.
const userData = resolveUserData({
  packaged: app.isPackaged,
  appData: app.getPath('appData'),
  override: process.env.LUMAFLUX_DATA_DIR,
});
app.setName(userData.name);
app.setPath('userData', userData.dir);

// Both worker entry points are resolved from this bundle's own __dirname, so a
// packaged build loads them from inside its own asar/out tree and never from a
// repository path.
const resources = resolveImagingResources(__dirname);
const RENDER_WORKER_ENTRY = resources.renderWorkerEntry;
const RAW_DECODER_ENTRY = resources.rawDecoderEntry;
const MCP_STDIO_ENTRY = resources.mcpStdioEntry;
// The RAW decoder spawns a disposable worker per decode; the main process
// never decodes itself, so the location is configured here as well as in the
// render worker (each process has its own module instance and its own copy of
// the configured path).
configureRawDecoder(RAW_DECODER_ENTRY);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let window: BrowserWindow | undefined;
  let pool: RenderPool;
  let commands: Commands | undefined;
  let quitting = false;
  let settingsTail: Promise<unknown> = Promise.resolve();
  let mcp: Awaited<ReturnType<typeof startMcp>> | undefined;
  let settings = { enabled: false, roots: [] as string[] };

  // 32 random bytes, generated per launch, never written anywhere but the
  // 0600 connection file inside user data. The loopback MCP endpoint requires
  // it as a bearer token, so another process on the machine cannot drive the
  // agent surface without reading this app's own private directory.
  const token = randomBytes(32).toString('hex');
  const dataDir = app.getPath('userData');
  const configPath = path.join(dataDir, 'mcp-connection.json');
  const settingsPath = path.join(dataDir, 'settings.json');

  const clientConfig = (): string =>
    JSON.stringify(
      {
        mcpServers: {
          lumaflux: {
            command: 'node',
            args: [
              app.isPackaged
                ? path.join(process.resourcesPath, 'mcp/stdio.mjs')
                : MCP_STDIO_ENTRY,
              configPath,
            ],
          },
        },
      },
      null,
      2,
    );

  const agentState = () => ({
    ...settings,
    endpoint: mcp?.url,
    configPath,
    clientConfig: clientConfig(),
  });

  app.on('second-instance', () => {
    window?.show();
    window?.focus();
  });

  app
    .whenReady()
    .then(async () => {
      if (process.platform === 'win32') {
        app.setAppUserModelId(APP_IDENTITY.id);
      }
      app.setAboutPanelOptions({
        applicationName: APP_IDENTITY.name,
        applicationVersion: app.getVersion(),
      });

      await mkdir(dataDir, { recursive: true });

      pool = new RenderPool(undefined, RENDER_WORKER_ENTRY);
      const service = await PhotoService.open(path.join(dataDir, 'catalog.json'));
      const activeCommands = new Commands(service, (p, r, o) => pool.render(p, r, o));
      commands = activeCommands;

      const configure = (roots: string[]) => {
        // Agent settings are applied strictly in order: two rapid folder
        // changes must not interleave their start/stop sequences.
        const update = settingsTail.then(async () => {
          if (quitting) throw new Error('Lumaflux is shutting down');
          const canonical = await Promise.all(
            roots.map(async (root) => {
              const resolved = await realpath(root);
              if (!(await stat(resolved)).isDirectory()) {
                throw new Error('Agent roots must be folders');
              }
              return resolved;
            }),
          );
          // Start the replacement before closing the current endpoint so a
          // failed folder update cannot leave agent access disabled.
          const nextMcp = await startMcp(activeCommands, { token, roots: canonical });
          const connectionTemp = `${configPath}.tmp`;
          try {
            await writeFile(
              connectionTemp,
              JSON.stringify({ url: nextMcp.url, token }),
              { mode: 0o600 },
            );
            await rename(connectionTemp, configPath);
          } catch (error) {
            await nextMcp.close();
            await unlink(connectionTemp).catch(() => {});
            throw error;
          }
          const previous = mcp;
          mcp = nextMcp;
          settings = { enabled: true, roots: canonical };
          await previous?.close();
          const tmp = `${settingsPath}.tmp`;
          await writeFile(tmp, JSON.stringify(settings), { mode: 0o600 });
          await rename(tmp, settingsPath);
          return agentState();
        });
        settingsTail = update.catch(() => {});
        return update;
      };

      let restoredRoots: string[] = [];
      try {
        const saved = z
          .object({ roots: z.array(z.string()).max(50) })
          .parse(JSON.parse(await readFile(settingsPath, 'utf8')));
        // A removed or unmounted folder must not prevent the MCP server from
        // starting; it simply grants no access.
        for (const root of saved.roots) {
          try {
            const canonical = await realpath(root);
            if ((await stat(canonical)).isDirectory()) restoredRoots.push(canonical);
          } catch {
            /* Unavailable roots grant no access. */
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error('Agent settings could not be restored:', (error as Error).message);
        }
      }
      await configure(restoredRoots);

      const thumbs = new Map<string, Buffer>();
      const pending = new Map<string, Promise<Buffer>>();
      protocol.handle('lumaflux', async (request) => {
        try {
          const url = new URL(request.url);
          if (url.hostname !== 'asset') return new Response(null, { status: 404 });
          const id = decodeURIComponent(url.pathname.slice(1));
          const photo = service.photo(id);
          // The cache key includes the revision and path, so an edit or a relink
          // can never serve a stale thumbnail.
          const key = `${id}:${photo.revision}:${photo.path}`;
          let bytes = thumbs.get(key);
          if (!bytes) {
            // One render per key even under concurrent <img> requests; the
            // others await the same promise.
            const work = pending.get(key) ?? activeCommands.preview(id, photo.recipe, 360);
            pending.set(key, work);
            try {
              const rendered: Buffer = await work;
              thumbs.set(key, rendered);
              // Bounded cache: the filmstrip can ask for hundreds of
              // thumbnails and a byte cache with no cap would grow without
              // limit over a long session.
              while (thumbs.size > 160) thumbs.delete(thumbs.keys().next().value!);
              bytes = rendered;
            } finally {
              pending.delete(key);
            }
          }
          if (!bytes) return new Response(null, { status: 404 });
          return new Response(new Uint8Array(bytes), {
            headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' },
          });
        } catch {
          return new Response(null, { status: 404 });
        }
      });

      // Every privileged channel is reachable only from this app's own window
      // and its main frame. A devtools extension, an embedded frame, or a
      // second renderer cannot invoke them.
      const handle = (name: string, fn: (...args: any[]) => unknown) => {
        ipcMain.handle(name, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
          if (
            event.sender !== window?.webContents ||
            event.senderFrame !== window?.webContents.mainFrame
          ) {
            throw new Error('Invalid IPC sender');
          }
          return fn(...args);
        });
      };

      handle(IPC_CHANNELS.command, (name, args) =>
        activeCommands.run(z.string().parse(name), args),
      );

      // Coalesce previews so dragging a slider renders the latest recipe only.
      const previewQueue = new LatestPreview(
        async ({ id, recipe, maxDimension }: { id: string; recipe: unknown; maxDimension?: number }) =>
          `data:image/jpeg;base64,${(await activeCommands.preview(id, recipe, maxDimension)).toString('base64')}`,
      );
      handle(IPC_CHANNELS.preview, (id, recipe, maxDimension) =>
        previewQueue.request({
          id: z.string().parse(id),
          recipe,
          maxDimension,
        }),
      );

      handle(IPC_CHANNELS.chooseImport, async (folder = false) =>
        (
          await dialog.showOpenDialog(window!, {
            properties: folder ? ['openDirectory'] : ['openFile', 'multiSelections'],
            filters: folder ? undefined : [{ name: 'Photos', extensions: imageExtensions }],
          })
        ).filePaths,
      );
      handle(IPC_CHANNELS.chooseDirectory, async () =>
        (
          await dialog.showOpenDialog(window!, {
            properties: ['openDirectory', 'createDirectory'],
          })
        ).filePaths[0] ?? null,
      );
      handle(IPC_CHANNELS.chooseRelink, async () =>
        (
          await dialog.showOpenDialog(window!, {
            properties: ['openFile'],
            filters: [{ name: 'Photos', extensions: imageExtensions }],
          })
        ).filePaths[0] ?? null,
      );
      handle(IPC_CHANNELS.agentSettings, () => agentState());
      handle(IPC_CHANNELS.updateAgentSettings, (enabled, roots) => {
        // The IPC signature is retained for older clients; access is always
        // enabled, so `enabled` is validated and otherwise ignored.
        z.boolean().parse(enabled);
        return configure(z.array(z.string()).max(50).parse(roots));
      });

      service.on('change', () => {
        if (window && !window.isDestroyed()) window.webContents.send(CATALOG_CHANGE_CHANNEL);
      });

      const openWindow = () => {
        window = createMainWindow();
        window.on('closed', () => {
          if (window !== null) window = undefined;
        });
      };
      openWindow();

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) openWindow();
      });
    })
    .catch((error: unknown) => {
      dialog.showErrorBox('Lumaflux could not start', (error as Error).stack ?? String(error));
      app.quit();
    });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // Quit is deferred once so in-flight work can drain: queued exports are
  // cancelled, the agent endpoint and image workers are closed, and the
  // connection file (which holds the live token) is removed from disk.
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void (async () => {
      try {
        for (const job of commands?.service.jobs ?? []) {
          if (job.status === 'queued' || job.status === 'running') commands?.exports.cancel(job.id);
        }
        await settingsTail;
        await mcp?.close();
        await pool?.close();
        await commands?.exports.idle();
        await commands?.service.idle();
        await unlink(configPath).catch(() => {});
      } finally {
        app.quit();
      }
    })();
  });
}
