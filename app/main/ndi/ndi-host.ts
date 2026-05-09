import { NdiService } from './ndi-service';
import type { NdiHostCommand, NdiHostEvent } from './ndi-protocol';

const parentPort = process.parentPort;
if (!parentPort) {
  throw new Error('ndi-host must run as an Electron utility process (process.parentPort is null)');
}

let service: NdiService | null = null;

function emit(event: NdiHostEvent): void {
  parentPort!.postMessage(event);
}

parentPort.on('message', (event: { data: NdiHostCommand }) => {
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

  if (!service) return;

  switch (cmd.type) {
    case 'setOutputEnabled':
      service.setOutputEnabled(cmd.name, cmd.enabled);
      break;
    case 'updateOutputConfig':
      service.updateOutputConfig(cmd.name, cmd.config);
      break;
    case 'frame': {
      const stampedTelemetry = cmd.telemetry
        ? { ...cmd.telemetry, hostReceivedAtMs: Date.now() }
        : undefined;
      service.receiveFrame(
        cmd.name,
        new Uint8Array(cmd.buffer),
        cmd.width,
        cmd.height,
        stampedTelemetry,
      );
      break;
    }
    case 'audio':
      service.receiveAudioFrame(
        cmd.name,
        new Float32Array(cmd.buffer),
        cmd.sampleRate,
        cmd.channels,
        cmd.samplesPerChannel,
      );
      break;
    case 'flushBlackout': {
      const { target, ...rest } = cmd.options ?? {};
      service.flushBlackoutAndDestroy(target, rest);
      break;
    }
    case 'destroy':
      service.destroy();
      service = null;
      break;
  }
});
