const pendingPorts = new Map<string, MessagePort>();
const waiters = new Map<string, Array<(port: MessagePort) => void>>();
const cancelledSessions = new Set<string>();

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window || !event.data || typeof event.data !== 'object') return;
  const message = event.data as { source?: unknown; type?: unknown; sessionId?: unknown };
  if (message.source !== 'lumastream-main' || message.type !== 'zoom-media-port'
    || typeof message.sessionId !== 'string' || !event.ports[0]) return;
  const port = event.ports[0];
  if (cancelledSessions.has(message.sessionId)) {
    port.close();
    return;
  }
  const waiting = waiters.get(message.sessionId)?.shift();
  if (waiting) {
    if (waiters.get(message.sessionId)?.length === 0) waiters.delete(message.sessionId);
    waiting(port);
  } else {
    pendingPorts.get(message.sessionId)?.close();
    pendingPorts.set(message.sessionId, port);
  }
});

export function waitForZoomMediaPort(sessionId: string, timeoutMs = 10_000): Promise<MessagePort> {
  if (cancelledSessions.has(sessionId)) return Promise.reject(new Error('The Zoom output was cancelled.'));
  const port = pendingPorts.get(sessionId);
  if (port) {
    pendingPorts.delete(sessionId);
    return Promise.resolve(port);
  }
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      const listeners = waiters.get(sessionId)?.filter((listener) => listener !== receive);
      if (listeners?.length) waiters.set(sessionId, listeners);
      else waiters.delete(sessionId);
      reject(new Error('The Zoom media connection did not open.'));
    }, timeoutMs);
    const receive = (opened: MessagePort) => {
      window.clearTimeout(timer);
      resolve(opened);
    };
    const listeners = waiters.get(sessionId) ?? [];
    listeners.push(receive);
    waiters.set(sessionId, listeners);
  });
}

export function discardZoomMediaPort(sessionId: string): void {
  pendingPorts.get(sessionId)?.close();
  pendingPorts.delete(sessionId);
  cancelledSessions.add(sessionId);
  window.setTimeout(() => cancelledSessions.delete(sessionId), 60_000);
}
