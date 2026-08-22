import type { SystemMetricsSnapshot } from '@lumacast/protocol';

const EVENT_LOOP_LAG_INTERVAL_MS = 250;
const EVENT_LOOP_LAG_WINDOW = 120;

interface EventLoopLagSnapshot {
  lastMs: number;
  p95Ms: number;
  maxMs: number;
  count: number;
}

interface EventLoopLagSamplerClock {
  nowNs(): bigint;
  setTimeout(callback: () => void, delayMs: number): NodeJS.Timeout;
  clearTimeout(handle: NodeJS.Timeout): void;
}

export interface EventLoopLagSampler {
  ensureStarted(): void;
  snapshot(): EventLoopLagSnapshot;
}

class RingBuffer {
  private readonly values: number[] = [];
  private writeIndex = 0;

  constructor(private readonly capacity: number) {}

  push(value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    if (this.values.length < this.capacity) {
      this.values.push(value);
      return;
    }
    this.values[this.writeIndex] = value;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
  }

  snapshot(): number[] {
    return this.values.slice();
  }

  get size(): number {
    return this.values.length;
  }
}

export function createEventLoopLagSampler(
  clock: EventLoopLagSamplerClock = {
    nowNs: () => process.hrtime.bigint(),
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (handle) => clearTimeout(handle),
  },
): EventLoopLagSampler {
  const samples = new RingBuffer(EVENT_LOOP_LAG_WINDOW);
  let timer: NodeJS.Timeout | null = null;
  let expectedAtNs: bigint | null = null;
  let lastLagMs = 0;

  const scheduleNext = () => {
    timer = clock.setTimeout(() => {
      const nowNs = clock.nowNs();
      const expectedNs = expectedAtNs ?? nowNs;
      const lagNs = nowNs - expectedNs;
      lastLagMs = Math.max(0, Number(lagNs) / 1_000_000);
      samples.push(lastLagMs);
      expectedAtNs = nowNs + BigInt(EVENT_LOOP_LAG_INTERVAL_MS) * 1_000_000n;
      scheduleNext();
    }, EVENT_LOOP_LAG_INTERVAL_MS);
    timer.unref?.();
  };

  return {
    ensureStarted() {
      if (timer) return;
      expectedAtNs = clock.nowNs() + BigInt(EVENT_LOOP_LAG_INTERVAL_MS) * 1_000_000n;
      scheduleNext();
    },
    snapshot() {
      const sorted = samples.snapshot().sort((left, right) => left - right);
      const p95Index = sorted.length === 0
        ? 0
        : Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
      const maxMs = sorted.length === 0 ? 0 : sorted[sorted.length - 1];
      return {
        lastMs: lastLagMs,
        p95Ms: sorted[p95Index] ?? 0,
        maxMs,
        count: samples.size,
      };
    },
  };
}

// Returns a snapshot of the main process's memory + CPU usage.
//
// CPU: derived by sampling `process.cpuUsage` against the monotonic delta
// since the previous sample. The very first call returns 0 because we have
// no baseline yet. Callers should poll on a fixed interval.
let lastCpuUsage: NodeJS.CpuUsage | null = null;
let lastSampleHrtimeNs: bigint | null = null;
const eventLoopLagSampler = createEventLoopLagSampler();

export function sampleSystemMetrics(): SystemMetricsSnapshot {
  eventLoopLagSampler.ensureStarted();
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage();
  const nowNs = process.hrtime.bigint();

  let cpuPercent = 0;
  if (lastCpuUsage && lastSampleHrtimeNs !== null) {
    const elapsedMicros = Number((nowNs - lastSampleHrtimeNs) / 1000n);
    if (elapsedMicros > 0) {
      const userDeltaMicros = cpu.user - lastCpuUsage.user;
      const systemDeltaMicros = cpu.system - lastCpuUsage.system;
      cpuPercent = ((userDeltaMicros + systemDeltaMicros) / elapsedMicros) * 100;
    }
  }
  lastCpuUsage = cpu;
  lastSampleHrtimeNs = nowNs;
  const eventLoopLag = eventLoopLagSampler.snapshot();

  return {
    capturedAtMs: Date.now(),
    uptimeSeconds: process.uptime(),
    main: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      cpuPercent: Math.max(0, cpuPercent),
      eventLoopLag,
    },
  };
}
