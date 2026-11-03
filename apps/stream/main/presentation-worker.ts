import { parentPort, workerData } from 'node:worker_threads';
import { renderPresentation, type PresentationRenderRequest } from './presentation-render';

if (!parentPort) throw new Error('Presentation conversion must run in a worker.');

void renderPresentation(workerData as PresentationRenderRequest).then(
  (slides) => parentPort!.postMessage({ ok: true, slides }),
  (error: unknown) => parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : 'The presentation could not be rendered.' }),
).finally(() => parentPort!.close());
