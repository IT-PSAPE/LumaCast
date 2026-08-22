import { NdiService, type NdiHostCommand, type NdiHostEvent } from '@lumacast/engine';

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
    service.onFrameReleased((release) => {
      emit({ type: 'frameReleased', release });
    });
    emit({
      type: 'ready',
      outputState: service.getOutputState(),
      outputConfigs: service.getOutputConfigs(),
      diagnostics: service.getDiagnostics(),
    });
    return;
  }

  switch (cmd.type) {
    case 'setOutputEnabled':
      if (!service) return;
      service.setOutputEnabled(cmd.name, cmd.enabled);
      break;
    case 'updateOutputConfig':
      if (!service) return;
      service.updateOutputConfig(cmd.name, cmd.config);
      break;
    case 'frame': {
      if (!service) return;
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
      if (!service) return;
      service.receiveAudioFrame(
        cmd.name,
        new Float32Array(cmd.buffer),
        cmd.sampleRate,
        cmd.channels,
        cmd.samplesPerChannel,
      );
      break;
    case 'flushBlackout': {
      if (!service) return;
      const { target, ...rest } = cmd.options ?? {};
      service.flushBlackoutAndDestroy(target, rest);
      break;
    }
    case 'destroy':
      if (service) {
        service.destroy();
        service = null;
      }
      emit({ type: 'teardownComplete' });
      break;
  }
});
