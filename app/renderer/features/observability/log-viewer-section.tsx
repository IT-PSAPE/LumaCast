import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LogReadResult, LogSessionSummary } from '@lumacast/protocol';
import { SectionShell } from './section-shell';
import { FilterChips } from './filter-chips';
import { LEVEL_FILTERS } from './observability-constants';
import { formatBytes, lineColor } from './observability-format';

export function LogViewerSection() {
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
