import type { NdiHostCommand, NdiHostReply } from './ndi-host-protocol';
import { createNdiHostRuntime, loadNdiNative } from './ndi-host-runtime';

const parentPort = process.parentPort;
if (!parentPort) throw new Error('ndi-host must run as an Electron utility process.');

const runtime = createNdiHostRuntime(loadNdiNative);
parentPort.on('message', (event: { data: NdiHostCommand }) => {
  const command = event.data;
  void runtime.handle(command).then(
    (value) => {
      const reply: NdiHostReply = { requestId: command.requestId, ok: true, value };
      try { parentPort!.postMessage(reply); } catch { /* Main process may already have exited. */ }
    },
    (error: unknown) => {
      const reply: NdiHostReply = {
        requestId: command.requestId,
        ok: false,
        error: error instanceof Error ? error.message.slice(0, 1024) : 'NDI operation failed.',
      };
      try { parentPort!.postMessage(reply); } catch { /* Main process may already have exited. */ }
    },
  );
});
