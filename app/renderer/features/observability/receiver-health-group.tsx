import type { NdiTallyState } from '@lumacast/protocol';
import { Stat } from './stat';

export function ReceiverHealthGroup({
  connectionCount,
  tally,
}: {
  connectionCount: number | null;
  tally: NdiTallyState | null;
}) {
  // Tally + connection count come from the receiver via the NDI SDK. They
  // confirm the receiver is actually subscribed and considers itself live —
  // useful context for interpreting pipeline-latency numbers above.
  const tallyText = tally
    ? `${tally.onProgram ? 'PGM' : '—'} · ${tally.onPreview ? 'PVW' : '—'}`
    : 'unsupported';
  return (
    <div className="mt-3 border-t border-secondary/40 pt-2">
      <div className="pb-1 text-xs font-semibold uppercase tracking-wide text-tertiary">
        Receiver health
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-secondary md:grid-cols-3">
        <Stat label="Connections" value={connectionCount ?? 'unknown'} />
        <Stat label="Tally" value={tallyText} />
      </div>
    </div>
  );
}
