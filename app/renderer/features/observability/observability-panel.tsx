import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LogReadResult, LogSessionSummary, NdiActiveSenderDiagnostics, NdiOutputName } from '@core/types';
import { useNdi } from '../../contexts/app-context';
import { useImageCacheStats } from '../canvas/use-image-cache-stats';
import {
  useAudioHealthCollector,
  useCanvasRenderCollector,
  useRendererMemoryCollector,
  useSystemMetricsCollector,
  useVideoQualityCollector,
} from './observability-collectors';
import {
  useMetricsStore,
  useShallow,
  type ObsEvent,
  type ObsEventCategory,
  type ObsEventLevel,
} from './metrics-store';

const OUTPUT_TITLES: Record<NdiOutputName, string> = {
  audience: 'Audience',
  stage: 'Stage',
};

export function ObservabilityPanel() {
  // Mount the live collectors only while this panel is open. They're
  // cheap, but no point sampling memory/audio when the user isn't looking.
  useSystemMetricsCollector(true);
  useRendererMemoryCollector(true);
  useVideoQualityCollector(true);
  useAudioHealthCollector(true);
  useCanvasRenderCollector(true);

  return (
    <div className="flex flex-col gap-8">
      <NdiOutputsSection />
      <SourcePlaybackSection />
      <AudioHealthSection />
      <CanvasRenderSection />
      <MemorySection />
      <ImageCacheSection />
      <EventTimelineSection />
      <LogViewerSection />
    </div>
  );
}

// ─── NDI outputs ────────────────────────────────────────────────────

function NdiOutputsSection() {
  const { state: { diagnostics } } = useNdi();
  if (!diagnostics) {
    return <SectionShell title="NDI outputs"><p className="text-sm text-tertiary">Waiting for NDI diagnostics.</p></SectionShell>;
  }
  return (
    <SectionShell title="NDI outputs" subtitle={`Runtime: ${diagnostics.runtimeLoaded ? (diagnostics.runtimePath ?? 'Loaded') : 'Not loaded'} · Source: ${diagnostics.sourceStatus}`}>
      <div className="flex flex-col gap-4">
        <SenderCard name="audience" sender={diagnostics.senders.audience} />
        <SenderCard name="stage" sender={diagnostics.senders.stage} />
        {diagnostics.lastError ? (
          <div className="rounded border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-300">{diagnostics.lastError}</div>
        ) : null}
      </div>
    </SectionShell>
  );
}

function SenderCard({ name, sender }: { name: NdiOutputName; sender: NdiActiveSenderDiagnostics | null }) {
  if (!sender) {
    return (
      <div className="rounded border border-secondary px-3 py-2 text-sm text-tertiary">
        {OUTPUT_TITLES[name]} sender: inactive
      </div>
    );
  }
  const performance = sender.performance;
  const audio = sender.audio;
  const uptimeMs = Date.now() - sender.startedAtMs;
  const dropRate = performance.framesCaptured > 0
    ? ((performance.framesDroppedBackpressure / performance.framesCaptured) * 100)
    : 0;
  return (
    <div className="rounded border border-secondary px-3 py-3">
      <div className="flex items-center justify-between gap-3 pb-2">
        <h3 className="text-sm font-semibold text-primary">{OUTPUT_TITLES[name]} · {sender.senderName}</h3>
        <span className="text-xs text-tertiary">
          {sender.width}×{sender.height} · {sender.withAlpha ? 'BGRA' : 'BGRX'} · {sender.asyncVideoSend ? 'async' : 'sync'} · up {formatDuration(uptimeMs)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-secondary md:grid-cols-3">
        <Stat label="Connections" value={sender.connectionCount ?? 'unknown'} />
        <Stat label="Frames sent" value={formatNumber(performance.framesSent)} />
        <Stat label="Captured" value={formatNumber(performance.framesCaptured)} />
        <Stat label="Replayed" value={formatNumber(performance.framesReplayed)} />
        <Stat label="Backpressure drops" value={`${formatNumber(performance.framesDroppedBackpressure)} (${dropRate.toFixed(1)}%)`} highlight={dropRate > 1} />
        <Stat label="Skipped captures" value={formatNumber(performance.skippedCaptures)} />
        <Stat label="Rejected" value={formatNumber(performance.framesRejected)} highlight={performance.framesRejected > 0} />
        <Stat label="Blackout sent" value={formatNumber(performance.blackoutFramesSent)} />
        <Stat label="Bytes received" value={formatBytes(performance.bytesReceived)} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-secondary md:grid-cols-3">
        <Stat label="Capture avg" value={`${performance.avgCaptureDurationMs.toFixed(2)} ms`} />
        <Stat label="Readback avg" value={`${performance.avgReadbackDurationMs.toFixed(2)} ms`} />
        <Stat label="Send avg" value={`${performance.avgSendDurationMs.toFixed(2)} ms`} />
        <Stat label="Send p50" value={`${performance.p50SendDurationMs.toFixed(2)} ms`} />
        <Stat label="Send p95" value={`${performance.p95SendDurationMs.toFixed(2)} ms`} highlight={performance.p95SendDurationMs > 16} />
        <Stat label="Send p99" value={`${performance.p99SendDurationMs.toFixed(2)} ms`} highlight={performance.p99SendDurationMs > 33} />
        <Stat label="Send jitter (σ)" value={`${performance.sendIntervalJitterMs.toFixed(2)} ms`} highlight={performance.sendIntervalJitterMs > 5} />
        <Stat label="Frame size last" value={formatBytes(performance.lastFrameBytes)} />
        <Stat
          label="Frame size range"
          value={performance.minFrameBytes > 0
            ? `${formatBytes(performance.minFrameBytes)} – ${formatBytes(performance.maxFrameBytes)}`
            : '—'}
        />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-secondary md:grid-cols-3">
        <Stat label="Audio frames in" value={formatNumber(audio.audioFramesReceived)} />
        <Stat label="Audio frames sent" value={formatNumber(audio.audioFramesSent)} />
        <Stat label="Audio samples sent" value={formatNumber(audio.audioSamplesSent)} />
        <Stat label="Silence frames" value={formatNumber(audio.audioSilenceFramesSent)} />
        <Stat label="Audio rejected" value={formatNumber(audio.audioFramesRejected)} highlight={audio.audioFramesRejected > 0} />
        <Stat label="Audio format" value={audio.lastSampleRate > 0 ? `${audio.lastSampleRate} Hz × ${audio.lastChannels}ch` : 'inactive'} />
      </div>
    </div>
  );
}

// ─── Source playback (HTMLVideoElement quality) ────────────────────

function SourcePlaybackSection() {
  const samples = useMetricsStore((s) => s.videoQualities);
  const list = useMemo(() => Object.values(samples), [samples]);
  return (
    <SectionShell title="Source playback" subtitle="Per-video drop counts and decoded fps from HTMLVideoElement.getVideoPlaybackQuality().">
      {list.length === 0 ? (
        <p className="text-sm text-tertiary">No video elements in the DOM.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((video) => {
            const dropRate = video.totalVideoFrames > 0
              ? (video.droppedVideoFrames / video.totalVideoFrames) * 100
              : 0;
            return (
              <div key={video.src} className="rounded border border-secondary px-3 py-2">
                <div className="flex items-center justify-between gap-3 pb-1">
                  <span className="truncate text-sm font-medium text-primary">{video.label}</span>
                  <span className="text-xs text-tertiary">{video.isPlaying ? 'playing' : 'paused'}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-secondary md:grid-cols-4">
                  <Stat label="Decoded fps" value={video.decodedFps.toFixed(1)} highlight={video.isPlaying && video.decodedFps < 24} />
                  <Stat label="Total frames" value={formatNumber(video.totalVideoFrames)} />
                  <Stat label="Dropped" value={`${formatNumber(video.droppedVideoFrames)} (${dropRate.toFixed(2)}%)`} highlight={dropRate > 1} />
                  <Stat label="Position" value={`${video.currentTimeSeconds.toFixed(1)} / ${video.durationSeconds.toFixed(1)} s`} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionShell>
  );
}

// ─── Audio health ──────────────────────────────────────────────────

function AudioHealthSection() {
  const audio = useMetricsStore((s) => s.audioHealth);
  return (
    <SectionShell title="Audio health" subtitle="Sampled from the same AudioContext that feeds NDI audio.">
      {!audio ? (
        <p className="text-sm text-tertiary">Audio capture not initialized — start playing audio or video to wake it up.</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-secondary md:grid-cols-4">
          <Stat label="Context" value={audio.contextState ?? 'n/a'} highlight={audio.contextState !== 'running'} />
          <Stat label="Sample rate" value={`${audio.sampleRate} Hz`} />
          <Stat label="Base latency" value={`${audio.baseLatencyMs.toFixed(1)} ms`} />
          <Stat label="Output latency" value={`${audio.outputLatencyMs.toFixed(1)} ms`} />
          <Stat label="Peak" value={audio.peakLevel.toFixed(3)} highlight={audio.peakLevel >= 0.99} />
          <Stat label="RMS" value={audio.rmsLevel.toFixed(3)} />
          <Stat label="Clipping" value={audio.clippingDetected ? 'yes' : 'no'} highlight={audio.clippingDetected} />
          <Stat label="Underruns" value={formatNumber(audio.underrunCount)} highlight={audio.underrunCount > 0} />
        </div>
      )}
    </SectionShell>
  );
}

// ─── Canvas render ─────────────────────────────────────────────────

function CanvasRenderSection() {
  const render = useMetricsStore((s) => s.canvasRender);
  return (
    <SectionShell title="Canvas / render" subtitle="rAF cadence in the renderer — proxy for UI smoothness.">
      {!render ? (
        <p className="text-sm text-tertiary">Sampling…</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-secondary md:grid-cols-4">
          <Stat label="Frame interval p50" value={`${render.p50FrameIntervalMs.toFixed(2)} ms`} />
          <Stat label="Frame interval p95" value={`${render.p95FrameIntervalMs.toFixed(2)} ms`} highlight={render.p95FrameIntervalMs > 25} />
          <Stat label="Last interval" value={`${render.lastFrameIntervalMs.toFixed(2)} ms`} />
          <Stat label="Canvases mounted" value={formatNumber(render.layerCount)} />
        </div>
      )}
    </SectionShell>
  );
}

// ─── Memory & process ──────────────────────────────────────────────

function MemorySection() {
  const renderer = useMetricsStore((s) => s.rendererMemory);
  const system = useMetricsStore((s) => s.systemMetrics);
  return (
    <SectionShell title="Memory & CPU" subtitle="Renderer JS heap and main-process metrics, sampled while this page is open.">
      <div className="flex flex-col gap-3">
        <div>
          <div className="pb-1 text-xs font-semibold uppercase tracking-wide text-tertiary">Renderer</div>
          {!renderer ? (
            <p className="text-sm text-tertiary">performance.memory unavailable in this context.</p>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-secondary md:grid-cols-3">
              <Stat label="JS heap used" value={formatBytes(renderer.jsHeapSizeBytes)} />
              <Stat label="JS heap total" value={formatBytes(renderer.totalJSHeapSizeBytes)} />
              <Stat label="JS heap limit" value={formatBytes(renderer.jsHeapLimitBytes)} />
            </div>
          )}
        </div>
        <div>
          <div className="pb-1 text-xs font-semibold uppercase tracking-wide text-tertiary">Main process</div>
          {!system ? (
            <p className="text-sm text-tertiary">Sampling…</p>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-secondary md:grid-cols-3">
              <Stat label="RSS" value={formatBytes(system.main.rssBytes)} />
              <Stat label="Heap used" value={formatBytes(system.main.heapUsedBytes)} />
              <Stat label="Heap total" value={formatBytes(system.main.heapTotalBytes)} />
              <Stat label="External" value={formatBytes(system.main.externalBytes)} />
              <Stat label="CPU" value={`${system.main.cpuPercent.toFixed(1)}%`} highlight={system.main.cpuPercent > 60} />
              <Stat label="Uptime" value={formatDuration(system.uptimeSeconds * 1000)} />
            </div>
          )}
        </div>
      </div>
    </SectionShell>
  );
}

// ─── Image cache (kept from old Output panel) ──────────────────────

function ImageCacheSection() {
  const stats = useImageCacheStats();
  return (
    <SectionShell title="Image cache" subtitle="In-memory image entries kept hot for the canvas.">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-secondary md:grid-cols-3">
        <Stat label="Entries" value={formatNumber(stats.entryCount)} />
        <Stat label="Estimated memory" value={formatBytes(stats.totalEstimatedBytes)} />
        <Stat label="Loaded" value={formatNumber(stats.loadedCount)} />
        <Stat label="Loading" value={formatNumber(stats.loadingCount)} />
        <Stat label="Errors" value={formatNumber(stats.errorCount)} highlight={stats.errorCount > 0} />
      </div>
    </SectionShell>
  );
}

// ─── Event timeline ────────────────────────────────────────────────

const CATEGORY_FILTERS: Array<{ id: 'all' | ObsEventCategory; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'ndi', label: 'NDI' },
  { id: 'layer', label: 'Layers' },
  { id: 'overlay', label: 'Overlays' },
  { id: 'slide', label: 'Slides' },
  { id: 'playback', label: 'Playback' },
  { id: 'system', label: 'System' },
  { id: 'error', label: 'Errors' },
];

function EventTimelineSection() {
  const { events, clearEvents } = useMetricsStore(
    useShallow((s) => ({ events: s.events, clearEvents: s.clearEvents })),
  );
  const [filter, setFilter] = useState<'all' | ObsEventCategory>('all');
  const visible = useMemo(() => {
    const base = filter === 'all' ? events : events.filter((event) => event.category === filter);
    return base.slice().reverse();
  }, [events, filter]);
  return (
    <SectionShell
      title="Event timeline"
      subtitle="Recent in-app events, newest first. Cleared on app restart — for permanent history use the log viewer below."
      headerExtra={(
        <div className="flex items-center gap-2">
          <FilterChips
            value={filter}
            options={CATEGORY_FILTERS}
            onChange={(next) => setFilter(next)}
          />
          <button
            type="button"
            className="rounded border border-secondary px-2 py-0.5 text-xs text-secondary hover:bg-tertiary/40"
            onClick={clearEvents}
          >
            Clear
          </button>
        </div>
      )}
    >
      {visible.length === 0 ? (
        <p className="text-sm text-tertiary">No events yet.</p>
      ) : (
        <div className="max-h-72 overflow-y-auto rounded border border-secondary">
          <table className="w-full text-left text-xs">
            <tbody>
              {visible.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionShell>
  );
}

function EventRow({ event }: { event: ObsEvent }) {
  const time = new Date(event.capturedAtMs).toLocaleTimeString();
  const color = colorForLevel(event.level);
  return (
    <tr className="border-b border-secondary/40 last:border-b-0">
      <td className="w-24 px-2 py-1 align-top font-mono text-tertiary">{time}</td>
      <td className="w-20 px-2 py-1 align-top text-tertiary">{event.category}</td>
      <td className={`px-2 py-1 align-top ${color}`}>
        <div>{event.message}</div>
        {event.details ? (
          <div className="font-mono text-[10px] text-tertiary">{JSON.stringify(event.details)}</div>
        ) : null}
      </td>
    </tr>
  );
}

function colorForLevel(level: ObsEventLevel): string {
  switch (level) {
    case 'error': return 'text-red-400';
    case 'warn': return 'text-amber-400';
    default: return 'text-secondary';
  }
}

// ─── Log viewer ────────────────────────────────────────────────────

const LEVEL_FILTERS: Array<{ id: 'all' | 'INFO' | 'WARN' | 'ERROR'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'INFO', label: 'Info' },
  { id: 'WARN', label: 'Warn' },
  { id: 'ERROR', label: 'Error' },
];

function LogViewerSection() {
  const [sessions, setSessions] = useState<LogSessionSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [tailOffset, setTailOffset] = useState(0);
  const [levelFilter, setLevelFilter] = useState<'all' | 'INFO' | 'WARN' | 'ERROR'>('all');
  const [loading, setLoading] = useState(false);
  const lineContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  const refreshSessions = useCallback(async () => {
    try {
      const next = await window.castApi.obsListLogSessions();
      setSessions(next);
      if (!selected && next.length > 0) {
        const current = next.find((session) => session.isCurrent) ?? next[0];
        setSelected(current.path);
      }
    } catch (error) {
      console.error('[obs] failed to list log sessions', error);
    }
  }, [selected]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  // Initial load + tail of selected session.
  useEffect(() => {
    if (!selected) return undefined;
    let cancelled = false;
    let intervalId: number | undefined;

    async function loadInitial() {
      setLoading(true);
      try {
        const result: LogReadResult = await window.castApi.obsReadLogSession(selected!, -1, 2000);
        if (cancelled) return;
        setLines(result.lines);
        setTailOffset(result.nextOffset);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadInitial();

    const session = sessions.find((entry) => entry.path === selected);
    if (session?.isCurrent) {
      intervalId = window.setInterval(async () => {
        try {
          const result = await window.castApi.obsReadLogSession(selected!, tailOffset, 1000);
          if (cancelled) return;
          if (result.lines.length > 0) {
            setLines((prev) => prev.concat(result.lines).slice(-5000));
          }
          setTailOffset(result.nextOffset);
        } catch (error) {
          console.error('[obs] log tail failed', error);
        }
      }, 1500);
    }

    return () => {
      cancelled = true;
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
    // tailOffset intentionally excluded — we update it inside the polled
    // closure and re-running the effect on every offset change would break
    // the live tail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, sessions]);

  // Auto-scroll to bottom on new lines unless the user has scrolled away.
  useEffect(() => {
    const container = lineContainerRef.current;
    if (!container) return;
    if (userScrolledRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, [lines]);

  const filteredLines = useMemo(() => {
    if (levelFilter === 'all') return lines;
    return lines.filter((line) => line.includes(` ${levelFilter} `));
  }, [lines, levelFilter]);

  function handleScroll() {
    const container = lineContainerRef.current;
    if (!container) return;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 24;
    userScrolledRef.current = !atBottom;
  }

  function handleCopyPath() {
    if (selected) void window.castApi.writeClipboardText(selected);
  }

  function handleOpenFolder() {
    void window.castApi.obsOpenLogFolder();
  }

  return (
    <SectionShell
      title="Logs"
      subtitle="Session log files written by the main process. The current session live-tails."
      headerExtra={(
        <div className="flex items-center gap-2">
          <button type="button" className="rounded border border-secondary px-2 py-0.5 text-xs text-secondary hover:bg-tertiary/40" onClick={() => void refreshSessions()}>
            Refresh
          </button>
          <button type="button" className="rounded border border-secondary px-2 py-0.5 text-xs text-secondary hover:bg-tertiary/40" onClick={handleOpenFolder}>
            Open folder
          </button>
          <button type="button" className="rounded border border-secondary px-2 py-0.5 text-xs text-secondary hover:bg-tertiary/40 disabled:opacity-40" onClick={handleCopyPath} disabled={!selected}>
            Copy path
          </button>
        </div>
      )}
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="flex max-h-72 flex-col overflow-y-auto rounded border border-secondary">
          {sessions.length === 0 ? (
            <p className="p-3 text-sm text-tertiary">No log sessions found.</p>
          ) : (
            sessions.map((session) => {
              const active = session.path === selected;
              return (
                <button
                  key={session.path}
                  type="button"
                  onClick={() => { setSelected(session.path); userScrolledRef.current = false; }}
                  className={`flex flex-col gap-0.5 border-b border-secondary/40 px-3 py-2 text-left text-xs last:border-b-0 ${active ? 'bg-active text-primary' : 'text-secondary hover:bg-tertiary/40'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{session.fileName}</span>
                    {session.isCurrent ? (
                      <span className="rounded bg-emerald-500/20 px-1 text-[10px] uppercase tracking-wide text-emerald-300">live</span>
                    ) : null}
                  </div>
                  <div className="text-tertiary">{formatBytes(session.sizeBytes)} · {new Date(session.modifiedAtMs).toLocaleString()}</div>
                </button>
              );
            })
          )}
        </div>
        <div className="flex min-h-72 flex-col gap-2">
          <FilterChips
            value={levelFilter}
            options={LEVEL_FILTERS}
            onChange={(next) => setLevelFilter(next)}
          />
          <div
            ref={lineContainerRef}
            onScroll={handleScroll}
            className="h-72 overflow-y-auto rounded border border-secondary bg-primary/40 p-2 font-mono text-[11px] leading-snug text-secondary"
          >
            {loading && filteredLines.length === 0 ? (
              <div className="text-tertiary">Loading…</div>
            ) : filteredLines.length === 0 ? (
              <div className="text-tertiary">No log lines.</div>
            ) : (
              filteredLines.map((line, index) => (
                <div key={`${index}-${line.length}`} className={lineColor(line)}>{line}</div>
              ))
            )}
          </div>
        </div>
      </div>
    </SectionShell>
  );
}

function lineColor(line: string): string {
  if (line.includes(' ERROR ')) return 'text-red-400';
  if (line.includes(' WARN ')) return 'text-amber-400';
  return '';
}

// ─── Shared bits ────────────────────────────────────────────────────

function SectionShell({ title, subtitle, headerExtra, children }: {
  title: string;
  subtitle?: string;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-b border-primary pb-6 last:border-b-0">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold text-primary">{title}</h2>
          {subtitle ? <p className="text-xs text-tertiary">{subtitle}</p> : null}
        </div>
        {headerExtra}
      </header>
      {children}
    </section>
  );
}

function Stat({ label, value, highlight }: { label: string; value: React.ReactNode; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-tertiary">{label}</span>
      <span className={`font-mono text-xs ${highlight ? 'text-amber-300' : 'text-secondary'}`}>{value}</span>
    </div>
  );
}

function FilterChips<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`rounded px-2 py-0.5 text-xs ${value === option.id ? 'bg-active text-primary' : 'text-secondary hover:bg-tertiary/40'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const minutes = Math.floor(sec / 60);
  const remainingSec = sec % 60;
  if (minutes < 60) return `${minutes}m ${remainingSec.toString().padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return `${hours}h ${remainingMin.toString().padStart(2, '0')}m`;
}
