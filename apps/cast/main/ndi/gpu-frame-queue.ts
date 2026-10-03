import { performance } from 'node:perf_hooks';
import { NDI_OUTPUT_HEIGHT, NDI_OUTPUT_WIDTH } from '@lumacast/protocol';

export interface GpuFrameResult {
  conversionDurationMs: number;
  sendDurationMs: number;
  frameBytes: number;
}

interface FrameLease { release(): void }
interface TextureMetadata {
  widgetType: string;
  pixelFormat: string;
  codedSize: { width: number; height: number };
  visibleRect: { x: number; y: number; width: number; height: number };
  sharedTextureHandle?: Buffer;
  planes?: Array<{ fd: number; stride: number; offset: number; size: number }>;
}

/** Only trusted Electron paint events may supply a same-process native pointer. */
export function isFullGpuFrame(info: TextureMetadata, platform: string = 'darwin'): boolean {
  return info.widgetType === 'frame'
    && (info.pixelFormat === 'bgra' || info.pixelFormat === 'rgba')
    && info.codedSize.width === NDI_OUTPUT_WIDTH && info.codedSize.height === NDI_OUTPUT_HEIGHT
    && info.visibleRect.x === 0 && info.visibleRect.y === 0
    && info.visibleRect.width === NDI_OUTPUT_WIDTH && info.visibleRect.height === NDI_OUTPUT_HEIGHT
    && (platform === 'linux'
      ? !!info.planes && info.planes.length > 0 && info.planes.length <= 4 && info.planes.every((plane) => Number.isInteger(plane.fd) && plane.fd >= 0 && plane.stride > 0 && plane.size > plane.offset)
      : Buffer.isBuffer(info.sharedTextureHandle) && info.sharedTextureHandle.length === 8);
}

function p95(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1]!;
}

/** At most one native submission and one newest pending texture are retained. */
export class GpuFrameQueue<T extends FrameLease> {
  private pending: T | null = null;
  private draining: Promise<void> | null = null;
  private stopped = false;
  private received = 0;
  private sent = 0;
  private replaced = 0;
  private failed = 0;
  private lastError: string | null = null;
  private measuredFrames = 0;
  private firstMeasuredAt = 0;
  private lastMeasuredAt = 0;
  private frameBytes = 0;
  private readonly conversionSamples: number[] = [];
  private readonly sendSamples: number[] = [];
  private readonly totalSamples: number[] = [];
  private readonly intervalSamples: number[] = [];

  constructor(private readonly submit: (frame: T) => Promise<GpuFrameResult>, private readonly warmupFrames = 30) {}

  offer(frame: T): void {
    if (this.stopped) { frame.release(); return; }
    this.received += 1;
    if (this.pending) { this.pending.release(); this.replaced += 1; }
    this.pending = frame;
    if (!this.draining) this.startDrain();
  }

  private startDrain(): void {
    this.draining = this.drain().finally(() => {
      this.draining = null;
      if (this.pending && !this.stopped) this.startDrain();
    });
  }

  async flush(): Promise<void> { while (this.draining) await this.draining; }

  async stop(): Promise<void> {
    this.stopped = true;
    this.pending?.release();
    this.pending = null;
    await this.flush();
  }

  report() {
    const span = this.lastMeasuredAt - this.firstMeasuredAt;
    return {
      received: this.received, sent: this.sent, replaced: this.replaced, failed: this.failed,
      lastError: this.lastError, measuredFrames: this.measuredFrames,
      freshFps: span > 0 ? (this.measuredFrames - 1) * 1000 / span : 0,
      conversionP95Ms: p95(this.conversionSamples), sendP95Ms: p95(this.sendSamples),
      totalP95Ms: p95(this.totalSamples), intervalP95Ms: p95(this.intervalSamples), frameBytes: this.frameBytes,
    };
  }

  private async drain(): Promise<void> {
    while (this.pending && !this.stopped) {
      const frame = this.pending;
      this.pending = null;
      const startedAt = performance.now();
      try {
        const result = await this.submit(frame);
        const completedAt = performance.now();
        this.sent += 1;
        this.frameBytes = result.frameBytes;
        if (this.sent > this.warmupFrames) {
          if (this.measuredFrames === 0) this.firstMeasuredAt = completedAt;
          else this.sample(this.intervalSamples, completedAt - this.lastMeasuredAt);
          this.lastMeasuredAt = completedAt;
          this.measuredFrames += 1;
          this.sample(this.conversionSamples, result.conversionDurationMs);
          this.sample(this.sendSamples, result.sendDurationMs);
          this.sample(this.totalSamples, completedAt - startedAt);
        }
      } catch (error) {
        this.failed += 1;
        this.lastError = error instanceof Error ? error.message : String(error);
      } finally {
        frame.release();
      }
    }
  }

  private sample(samples: number[], value: number): void {
    samples.push(value);
    if (samples.length > 512) samples.shift();
  }
}
