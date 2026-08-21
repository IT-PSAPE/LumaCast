import type { ObsEvent } from './metrics-store';
import { colorForLevel } from './observability-format';

export function EventRow({ event }: { event: ObsEvent }) {
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
