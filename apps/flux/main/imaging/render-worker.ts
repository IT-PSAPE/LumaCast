import { parentPort } from 'node:worker_threads';
import { configureRawDecoder, renderImage } from '@lumacast/photo-imaging';
import { resolveWorkerResources } from './paths';

// This file is built as a standalone worker bundle at
// out/main/imaging/render-worker.js and started by RenderPool, which the app
// passes the entry path to. It runs in a worker thread, not an Electron
// utility process, so it has no `process.resourcesPath` shortcut: the RAW
// decoder is resolved from this bundle's own location, exactly as the main
// process resolves it, and handed to the package's public configuration hook
// before any decode can start.
// This bundle's own directory is out/main/imaging, so the decoder is resolved
// from here and not from the main bundle's directory, which sits one level up.
configureRawDecoder(resolveWorkerResources(__dirname).rawDecoderEntry);

if (!parentPort) {
  throw new Error('render-worker must be run as a worker thread');
}

parentPort.on(
  'message',
  async (msg: { id: string; filePath: string; recipe: unknown; options: unknown }) => {
    try {
      const buf = await renderImage(msg.filePath, msg.recipe as never, (msg.options ?? {}) as never);
      parentPort!.postMessage({ id: msg.id, buf });
    } catch (err) {
      parentPort!.postMessage({ id: msg.id, error: (err as Error).message });
    }
  },
);

parentPort.postMessage({ type: 'ready' });
