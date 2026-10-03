import { BrowserWindow, ipcMain, type OffscreenSharedTexture } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as NdiNative from '@lumacast/ndi-native';
function nativeModule(): typeof NdiNative { return require('@lumacast/ndi-native') as typeof NdiNative; }
import { NDI_GPU_SCENE_CHANNEL, NDI_GPU_SCENE_READY_CHANNEL, NDI_OUTPUT_HEIGHT, NDI_OUTPUT_WIDTH, type NdiGpuSceneSnapshot, type NdiOutputName } from '@lumacast/protocol';
import { NdiServiceProxy } from './ndi-service-proxy';
import { GpuFrameQueue, isFullGpuFrame } from './gpu-frame-queue';
import { GpuFrameRefresh } from './gpu-frame-refresh';

interface Lease { texture: OffscreenSharedTexture; snapshot: NdiGpuSceneSnapshot; refreshId: number; release(): void }
interface Output { window: BrowserWindow; refresh: GpuFrameRefresh; queue: GpuFrameQueue<Lease>; snapshot: NdiGpuSceneSnapshot; committed: NdiGpuSceneSnapshot | null; ready: boolean }

/** Electron owns texture leases; the utility host owns imported native surfaces. */
export class NdiGpuOutput {
  private outputs = new Map<NdiOutputName, Output>();
  private stopped = false;
  private stopPromise: Promise<void> | null = null;
  private nextAttempt = 0;
  private unsubscribe: () => void;
  private readonly onReady = (event: Electron.IpcMainEvent, revisionId?: string) => {
    for (const output of this.outputs.values()) {
      if (output.window.webContents !== event.sender) continue;
      output.ready = true;
      if (!revisionId) { this.sendScene(output); return; }
      if (revisionId !== output.snapshot.revisionId) return;
      output.committed = output.snapshot;
      if (this.service.getOutputState()[output.snapshot.name]) {
        this.requestFrame(output);
      }
    }
  };

  constructor(private readonly service: NdiServiceProxy, private readonly mainDirectory: string) {
    ipcMain.on(NDI_GPU_SCENE_READY_CHANNEL, this.onReady);
    this.unsubscribe = service.onOutputStateChanged((state) => {
      for (const [name, output] of this.outputs) {
        if (state[name] && output.committed) { this.requestFrame(output); }
        else { output.refresh.accept(output.refresh.id); output.window.webContents.stopPainting(); }
      }
    });
  }

  publish(snapshot: NdiGpuSceneSnapshot): void {
    if (this.stopped || !this.service.getOutputState()[snapshot.name]) return;
    let output = this.outputs.get(snapshot.name);
    if (!output) {
      output = this.create(snapshot);
      this.outputs.set(snapshot.name, output);
    } else {
      if (output.snapshot.revisionId !== snapshot.revisionId) {
        output.committed = null;
        output.refresh.accept(output.refresh.id);
        output.window.webContents.stopPainting();
      }
      output.snapshot = snapshot;
      if (output.committed?.revisionId === snapshot.revisionId) {
        output.committed = snapshot;
        if (snapshot.telemetry?.takeSequenceId !== undefined) this.requestFrame(output);
      }
      if (output.ready) this.sendScene(output);
    }
  }

  invalidate(): void {
    for (const output of this.outputs.values()) {
      if (!output.window.isDestroyed() && this.service.getOutputState()[output.snapshot.name]) this.requestFrame(output);
    }
  }

  stop(): Promise<void> { return this.stopPromise ??= this.stopImpl(); }

  private async stopImpl(): Promise<void> {
    this.stopped = true;
    this.unsubscribe();
    ipcMain.removeListener(NDI_GPU_SCENE_READY_CHANNEL, this.onReady);
    const outputs = [...this.outputs.values()];
    for (const output of outputs) { output.refresh.stop(); if (!output.window.isDestroyed()) output.window.webContents.stopPainting(); }
    await Promise.all(outputs.map((output) => output.queue.stop()));
    for (const output of outputs) if (!output.window.isDestroyed()) output.window.destroy();
    this.outputs.clear();
  }

  private requestFrame(output: Output): void {
    // Electron 35 invalidate() composites only the bitmap backing. Restarting
    // its video capturer requests a fresh shared texture even for a static scene.
    output.refresh.request();
  }

  private sendScene(output: Output): void {
    output.window.webContents.send(NDI_GPU_SCENE_CHANNEL, output.snapshot);
  }

  private create(snapshot: NdiGpuSceneSnapshot): Output {
    const window = new BrowserWindow({
      width: NDI_OUTPUT_WIDTH, height: NDI_OUTPUT_HEIGHT, show: false, transparent: true,
      useContentSize: true, frame: false, backgroundColor: '#00000000',
      webPreferences: {
        offscreen: { useSharedTexture: true },
        preload: path.join(this.mainDirectory, '../preload/ndi-gpu-preload.js'),
        sandbox: true, contextIsolation: true, nodeIntegration: false,
        backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required',
      },
    });
    window.webContents.setZoomFactor(1);
    window.webContents.setFrameRate(30);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    let reportedReplacements = 0;
    const queue = new GpuFrameQueue<Lease>(async (lease) => {
      if (this.stopped || !this.service.getOutputState()[snapshot.name]) throw new Error('NDI output stopped');
      const transport = this.service.getGpuTransport();
      if (!transport?.supported) {
        this.service.reportGpuSourceError('Native GPU output unavailable');
        throw new Error('Native GPU output unavailable');
      }
      let handle;
      try { handle = nativeModule().exportSharedTexture(lease.texture.textureInfo, transport.pid, transport.receiverEndpoint); }
      catch (error) {
        this.service.reportGpuSourceError(error instanceof Error ? error.message : String(error));
        throw error;
      }
      let handedOff = false;
      try {
        const replacements = queue.report().replaced;
        const drops = replacements - reportedReplacements;
        reportedReplacements = replacements;
        const telemetry = {
          captureDurationMs: 0, readbackDurationMs: 0, skippedCaptures: 0,
          correctiveFrameRetries: 0,
          ...lease.snapshot.telemetry,
          framesDroppedBackpressure: drops,
          dropReasons: { backpressure: drops },
          attemptId: `${lease.snapshot.revisionId}:${++this.nextAttempt}`,
          captureStartedAtMs: Date.now(), mainReceivedAtMs: Date.now(),
        };
        const promise = this.service.submitGpuFrame(snapshot.name, handle, lease.texture.textureInfo.pixelFormat, telemetry);
        handedOff = true;
        const result = await promise;
        output.refresh.accept(lease.refreshId);
        return result;
      } finally { if (!handedOff) nativeModule().discardSharedTexture(handle); }
    });
    const refresh = new GpuFrameRefresh(() => {
      if (this.stopped || window.isDestroyed() || !this.service.getOutputState()[snapshot.name]) return;
      window.webContents.stopPainting();
      window.webContents.startPainting();
    }, () => this.service.reportGpuSourceError(`NDI ${snapshot.name} did not produce a shared texture`));
    const output: Output = { window, queue, refresh, snapshot, committed: null, ready: false };
    window.webContents.on('paint', (event) => {
      const texture = event.texture;
      if (!texture) return;
      const info = texture.textureInfo;
      if (info.widgetType === 'frame' && (info.codedSize.width !== NDI_OUTPUT_WIDTH || info.codedSize.height !== NDI_OUTPUT_HEIGHT)) {
        const [contentWidth] = window.getContentSize();
        const factor = info.codedSize.width / contentWidth;
        if (factor > 0 && Number.isFinite(factor)) window.setContentSize(Math.round(NDI_OUTPUT_WIDTH / factor), Math.round(NDI_OUTPUT_HEIGHT / factor));
        texture.release(); return;
      }
      if (!output.committed || !this.service.getOutputState()[snapshot.name] || !isFullGpuFrame(texture.textureInfo, process.platform)) { texture.release(); return; }
      queue.offer({ texture, snapshot: output.committed, refreshId: refresh.id, release: () => texture.release() });
    });
    window.webContents.on('render-process-gone', () => {
      refresh.stop();
      void queue.stop().finally(() => {
        if (!window.isDestroyed()) window.destroy();
        this.outputs.delete(snapshot.name);
        this.service.reportGpuSourceError(`NDI ${snapshot.name} renderer exited unexpectedly`);
        this.service.setOutputEnabled(snapshot.name, false);
      });
    });
    window.webContents.on('did-fail-load', (_event, _code, description) => this.service.reportGpuSourceError(`NDI ${snapshot.name} renderer failed: ${description}`));
    window.webContents.on('preload-error', (_event, _path, error) => this.service.reportGpuSourceError(`NDI ${snapshot.name} preload failed: ${error.message}`));
    window.webContents.on('console-message', (event) => console.log(`[ndi-gpu:${snapshot.name}] ${event.message}`));
    const url = process.env.ELECTRON_RENDERER_URL
      ? new URL(process.env.ELECTRON_RENDERER_URL)
      : pathToFileURL(path.join(this.mainDirectory, '../renderer/index.html'));
    url.searchParams.set('view', 'ndi-output');
    url.searchParams.set('output', snapshot.name);
    void window.loadURL(url.toString());
    return output;
  }
}
