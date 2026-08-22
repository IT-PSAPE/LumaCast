import { useMemo, useState } from 'react';
import { useMetricsStore, useShallow, type ObsEventCategory } from './metrics-store';
import { SectionShell } from './section-shell';
import { FilterChips } from './filter-chips';
import { EventRow } from './event-row';
import { CATEGORY_FILTERS } from './observability-constants';

export function EventTimelineSection() {
  const { events, clearEvents, mirrorEventsToConsole, setMirrorEventsToConsole } = useMetricsStore(
    useShallow((s) => ({
      events: s.events,
      clearEvents: s.clearEvents,
      mirrorEventsToConsole: s.mirrorEventsToConsole,
      setMirrorEventsToConsole: s.setMirrorEventsToConsole,
    })),
  );
  const [filter, setFilter] = useState<'all' | ObsEventCategory>('all');
  const visible = useMemo(() => {
    const base = filter === 'all' ? events : events.filter((event) => event.category === filter);
    return base.slice().reverse();
  }, [events, filter]);
  return (
    <SectionShell
      title="Event timeline"
      subtitle="Recent in-app events, newest first. Cleared on app restart; enable log mirroring to persist them."
      headerExtra={(
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`rounded border px-2 py-0.5 text-xs ${mirrorEventsToConsole ? 'border-emerald-500/60 text-emerald-300' : 'border-secondary text-secondary hover:bg-tertiary/40'}`}
            onClick={() => setMirrorEventsToConsole(!mirrorEventsToConsole)}
          >
            {mirrorEventsToConsole ? 'Mirror to logs: on' : 'Mirror to logs: off'}
          </button>
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
