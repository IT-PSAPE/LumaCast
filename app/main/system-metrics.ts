import type { SystemMetricsSnapshot } from '@core/types';

// Returns a snapshot of the main process's memory + CPU usage.
//
// CPU: derived by sampling `process.cpuUsage` against the wall-clock delta
// since the previous sample. The very first call returns 0 because we have
// no baseline yet. Callers should poll on a fixed interval.
let lastCpuUsage: NodeJS.CpuUsage | null = null;
let lastSampleHrtimeNs: bigint | null = null;

export function sampleSystemMetrics(): SystemMetricsSnapshot {
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

  return {
    capturedAtMs: Date.now(),
    uptimeSeconds: process.uptime(),
    main: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      cpuPercent: Math.max(0, cpuPercent),
    },
  };
}
