import type { MessagePortMain } from 'electron';
import { NdiService, type NdiHostCommand, type NdiHostEvent } from '@lumacast/engine';
import {
  NDI_AUDIO_TRANSPORT_HANDSHAKE_TIMEOUT_MS,
  NDI_AUDIO_TRANSPORT_VERSION,
  NDI_FRAME_TRANSPORT_VERSION,
  NDI_FRAME_TRANSPORT_HANDSHAKE_TIMEOUT_MS,
  decodeNdiAudioTransportFrame,
  decodeNdiFrameTransportFrame,
  isNdiAudioTransportHandshake,
  isNdiFrameTransportAttemptId,
  isNdiFrameTransportHandshake,
  type NdiAudioTransportFallbackReason,
  type NdiFrameRelease,
  type NdiFrameTransportFallbackReason,
  type NdiOutputName,
} from '@lumacast/protocol';

const parentPort = process.parentPort;
if (!parentPort) {
  throw new Error('ndi-host must run as an Electron utility process (process.parentPort is null)');
}

let service: NdiService | null = null;
const framePorts = new Map<NdiOutputName, MessagePortMain>();
const directAttemptPorts = new Map<string, MessagePortMain>();
const framePortHandshakeTimers = new Map<MessagePortMain, ReturnType<typeof setTimeout>>();
const audioPorts = new Map<NdiOutputName, MessagePortMain>();
const audioPortHandshakeTimers = new Map<MessagePortMain, ReturnType<typeof setTimeout>>();

function clearFramePortHandshakeTimer(port: MessagePortMain): void {
  const timer = framePortHandshakeTimers.get(port);
  if (timer) clearTimeout(timer);
  framePortHandshakeTimers.delete(port);
}

function directAttemptKey(name: NdiOutputName, attemptId: string): string {
  return `${name}:${attemptId}`;
}

function removeDirectAttemptsForPort(port: MessagePortMain): void {
  for (const [key, candidate] of directAttemptPorts) {
    if (candidate === port) directAttemptPorts.delete(key);
  }
}

function closeFramePort(name: NdiOutputName, port: MessagePortMain): void {
  clearFramePortHandshakeTimer(port);
  if (framePorts.get(name) === port) framePorts.delete(name);
  removeDirectAttemptsForPort(port);
  try {
    port.close();
  } catch {
    // The peer may already have closed the channel.
  }
}

function postFallback(
  name: NdiOutputName,
  port: MessagePortMain,
  reason: NdiFrameTransportFallbackReason,
): void {
  try {
    port.postMessage({ type: 'fallback', name, reason });
  } catch {
    // The peer may have closed before it could receive the fallback notice.
  } finally {
    closeFramePort(name, port);
  }
}

function postInvalidFrameRelease(name: NdiOutputName, attemptId: string | undefined, port: MessagePortMain): void {
  const release: NdiFrameRelease = {
    name,
    ...(attemptId ? { attemptId } : {}),
    accepted: false,
    reason: 'invalidPayload',
    releasedAtMs: Date.now(),
  };
  try {
    port.postMessage({ type: 'released', release });
  } catch {
    closeFramePort(name, port);
  }
}

function attachFramePort(name: NdiOutputName, port: MessagePortMain): void {
  const previous = framePorts.get(name);
  if (previous) closeFramePort(name, previous);
  framePorts.set(name, port);
  let handshaken = false;
  const handshakeTimer = setTimeout(() => {
    if (!handshaken && framePorts.get(name) === port) {
      postFallback(name, port, 'invalidHandshake');
    }
  }, NDI_FRAME_TRANSPORT_HANDSHAKE_TIMEOUT_MS);
  framePortHandshakeTimers.set(port, handshakeTimer);

  port.on('message', (messageEvent) => {
    const message = messageEvent.data;
    if (!handshaken) {
      if (!isNdiFrameTransportHandshake(message, name)) {
        postFallback(name, port, 'invalidHandshake');
        return;
      }
      if (!service) {
        postFallback(name, port, 'hostUnavailable');
        return;
      }
      handshaken = true;
      clearFramePortHandshakeTimer(port);
      try {
        port.postMessage({ type: 'ready', version: NDI_FRAME_TRANSPORT_VERSION, name });
      } catch {
        closeFramePort(name, port);
      }
      return;
    }

    if (message && typeof message === 'object' && (message as { type?: unknown }).type === 'close') {
      closeFramePort(name, port);
      return;
    }

    const frame = decodeNdiFrameTransportFrame(message, name);
    if (!frame) {
      const attemptIdCandidate = message && typeof message === 'object'
        ? (message as { attemptId?: unknown }).attemptId
        : undefined;
      const attemptId = isNdiFrameTransportAttemptId(attemptIdCandidate)
        ? attemptIdCandidate
        : undefined;
      if (service && attemptId) {
        const key = directAttemptKey(name, attemptId);
        directAttemptPorts.set(key, port);
        try {
          service.receiveFrame(name, new Uint8Array(), 0, 0, {
            attemptId,
            captureDurationMs: 0,
            readbackDurationMs: 0,
            skippedCaptures: 0,
            framesDroppedBackpressure: 0,
            correctiveFrameRetries: 0,
          });
        } catch {
          directAttemptPorts.delete(key);
          postInvalidFrameRelease(name, attemptId, port);
        }
      } else {
        postInvalidFrameRelease(name, attemptId, port);
      }
      return;
    }
    if (!service) {
      postFallback(name, port, 'hostUnavailable');
      return;
    }

    const telemetry = frame.telemetry
      ? { ...frame.telemetry, attemptId: frame.attemptId, hostReceivedAtMs: Date.now() }
      : {
          attemptId: frame.attemptId,
          captureDurationMs: 0,
          readbackDurationMs: 0,
          skippedCaptures: 0,
          framesDroppedBackpressure: 0,
          correctiveFrameRetries: 0,
          hostReceivedAtMs: Date.now(),
        };
    const key = directAttemptKey(name, frame.attemptId);
    directAttemptPorts.set(key, port);
    try {
      service.receiveFrame(name, new Uint8Array(frame.buffer), frame.width, frame.height, telemetry);
    } catch {
      directAttemptPorts.delete(key);
      try {
        port.postMessage({
          type: 'released',
          release: {
            name,
            attemptId: frame.attemptId,
            accepted: false,
            reason: 'nativeSendFailed',
            releasedAtMs: Date.now(),
          } satisfies NdiFrameRelease,
        });
      } catch {
        closeFramePort(name, port);
      }
    }
  });
  port.on('close', () => {
    clearFramePortHandshakeTimer(port);
    if (framePorts.get(name) === port) framePorts.delete(name);
    removeDirectAttemptsForPort(port);
  });
  port.start();
}

function clearAudioPortHandshakeTimer(port: MessagePortMain): void {
  const timer = audioPortHandshakeTimers.get(port);
  if (timer) clearTimeout(timer);
  audioPortHandshakeTimers.delete(port);
}

function closeAudioPort(name: NdiOutputName, port: MessagePortMain): void {
  clearAudioPortHandshakeTimer(port);
  if (audioPorts.get(name) === port) audioPorts.delete(name);
  try {
    port.close();
  } catch {
    // The peer may already have closed the channel.
  }
}

function postAudioFallback(
  name: NdiOutputName,
  port: MessagePortMain,
  reason: NdiAudioTransportFallbackReason,
): void {
  try {
    port.postMessage({ type: 'fallback', name, reason });
  } catch {
    // The peer may have closed before it could receive the fallback notice.
  } finally {
    closeAudioPort(name, port);
  }
}

function attachAudioPort(name: NdiOutputName, port: MessagePortMain): void {
  const previous = audioPorts.get(name);
  if (previous) closeAudioPort(name, previous);
  audioPorts.set(name, port);
  let handshaken = false;
  const handshakeTimer = setTimeout(() => {
    if (!handshaken && audioPorts.get(name) === port) {
      postAudioFallback(name, port, 'invalidHandshake');
    }
  }, NDI_AUDIO_TRANSPORT_HANDSHAKE_TIMEOUT_MS);
  audioPortHandshakeTimers.set(port, handshakeTimer);

  port.on('message', (messageEvent) => {
    const message = messageEvent.data;
    if (!handshaken) {
      if (!isNdiAudioTransportHandshake(message, name)) {
        postAudioFallback(name, port, 'invalidHandshake');
        return;
      }
      if (!service) {
        postAudioFallback(name, port, 'hostUnavailable');
        return;
      }
      handshaken = true;
      clearAudioPortHandshakeTimer(port);
      try {
        port.postMessage({ type: 'ready', version: NDI_AUDIO_TRANSPORT_VERSION, name });
      } catch {
        closeAudioPort(name, port);
      }
      return;
    }

    if (message && typeof message === 'object' && (message as { type?: unknown }).type === 'close') {
      closeAudioPort(name, port);
      return;
    }

    const frame = decodeNdiAudioTransportFrame(message, name);
    if (!frame) {
      postAudioFallback(name, port, 'invalidPayload');
      return;
    }
    if (!service) {
      postAudioFallback(name, port, 'hostUnavailable');
      return;
    }

    try {
      service.receiveAudioFrame(
        name,
        new Float32Array(frame.buffer),
        frame.sampleRate,
        frame.channels,
        frame.samplesPerChannel,
      );
    } catch {
      // A rejected submission is a payload the host cannot send; the audio
      // transport has no asynchronously-releasable frame path, so the worker
      // gets the single fallback notice and the port dies.
      postAudioFallback(name, port, 'invalidPayload');
    }
  });
  port.on('close', () => {
    clearAudioPortHandshakeTimer(port);
    if (audioPorts.get(name) === port) audioPorts.delete(name);
  });
  port.start();
}

function routeFrameRelease(release: NdiFrameRelease): void {
  const port = release.attemptId
    ? directAttemptPorts.get(directAttemptKey(release.name, release.attemptId))
    : undefined;
  if (!port) {
    emit({ type: 'frameReleased', release });
    return;
  }
  directAttemptPorts.delete(directAttemptKey(release.name, release.attemptId!));
  try {
    port.postMessage({ type: 'released', release });
  } catch {
    closeFramePort(release.name, port);
  }
}

function emit(event: NdiHostEvent): void {
  parentPort!.postMessage(event);
}

parentPort.on('message', (event: { data: NdiHostCommand; ports?: MessagePortMain[] }) => {
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
    service.onFrameReleased(routeFrameRelease);
    emit({
      type: 'ready',
      outputState: service.getOutputState(),
      outputConfigs: service.getOutputConfigs(),
      diagnostics: service.getDiagnostics(),
    });
    return;
  }

  switch (cmd.type) {
    case 'attachFramePort': {
      const port = event.ports?.[0];
      if (port) attachFramePort(cmd.name, port);
      break;
    }
    case 'attachAudioPort': {
      const port = event.ports?.[0];
      if (port) attachAudioPort(cmd.name, port);
      break;
    }
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
      for (const [name, port] of framePorts) closeFramePort(name, port);
      for (const [name, port] of audioPorts) closeAudioPort(name, port);
      if (service) {
        service.destroy();
        service = null;
      }
      emit({ type: 'teardownComplete' });
      break;
  }
});
