import { NdiService } from './ndi-service';
import type {
  NdiFramePortMessage,
  NdiFramePortReply,
  NdiHostCommand,
  NdiHostEvent,
} from './ndi-protocol';

const parentPort = process.parentPort;
if (!parentPort) {
  throw new Error('ndi-host must run as an Electron utility process (process.parentPort is null)');
}

let service: NdiService | null = null;
// Active renderer↔host frame port (zero-copy transfer path). Replaced when
// the renderer reloads and a new port is attached.
let framePort: Electron.MessagePortMain | null = null;

function emit(event: NdiHostEvent): void {
  parentPort!.postMessage(event);
}

function attachFramePort(port: Electron.MessagePortMain): void {
  if (framePort) {
    try { framePort.close(); } catch { /* ignore */ }
  }
  framePort = port;

  port.on('message', (event: { data: NdiFramePortMessage }) => {
    if (!service) return;
    const data = event.data;
    if (!data || data.type !== 'frame') return;
    const ackName = data.name;
    try {
      service.receiveFrame(
        data.name,
        new Uint8Array(data.buffer),
        data.width,
        data.height,
        data.telemetry,
      );
    } catch (error) {
      console.error('[ndi-host] receiveFrame failed:', error);
    } finally {
      const reply: NdiFramePortReply = { type: 'ack', name: ackName };
      try { port.postMessage(reply); } catch { /* ignore */ }
    }
  });
  port.start();
}

parentPort.on('message', (event: { data: NdiHostCommand; ports?: Electron.MessagePortMain[] }) => {
  const cmd = event.data;

  if (cmd.type === 'init') {
    if (service) return;
    service = new NdiService({
      outputConfigs: cmd.outputConfigs,
      onOutputConfigsChanged: (outputConfigs) => {
        emit({ type: 'outputConfigsChanged', outputConfigs });
      },
    });
    service.onOutputStateChanged((outputState) => {
      emit({ type: 'outputStateChanged', outputState });
    });
    service.onDiagnosticsChanged((diagnostics) => {
      emit({ type: 'diagnosticsChanged', diagnostics });
    });
    emit({
      type: 'ready',
      outputState: service.getOutputState(),
      outputConfigs: service.getOutputConfigs(),
      diagnostics: service.getDiagnostics(),
    });
    return;
  }

  if (cmd.type === 'attach-frame-port') {
    const port = event.ports?.[0];
    if (!port) {
      console.error('[ndi-host] attach-frame-port received without a port');
      return;
    }
    attachFramePort(port);
    return;
  }

  if (!service) return;

  switch (cmd.type) {
    case 'setOutputEnabled':
      service.setOutputEnabled(cmd.name, cmd.enabled);
      break;
    case 'updateOutputConfig':
      service.updateOutputConfig(cmd.name, cmd.config);
      break;
    case 'frame':
      service.receiveFrame(
        cmd.name,
        new Uint8Array(cmd.buffer),
        cmd.width,
        cmd.height,
        cmd.telemetry,
      );
      break;
    case 'destroy':
      if (framePort) {
        try { framePort.close(); } catch { /* ignore */ }
        framePort = null;
      }
      service.destroy();
      service = null;
      break;
  }
});
