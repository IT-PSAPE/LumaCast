import { useId, useState } from 'react';
import { Check } from 'lucide-react';
import type { YouTubeBroadcast } from '../../shared/desktop-api';

export interface YouTubeStreamRowProps {
  stream: YouTubeBroadcast;
  selected?: boolean;
  disabled?: boolean;
  onSelect(stream: YouTubeBroadcast): void;
}

function formatScheduledStart(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Time not set'
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** A selectable row for a scheduled YouTube broadcast. */
export function YouTubeStreamRow({ stream, selected = false, disabled = false, onSelect }: YouTubeStreamRowProps) {
  const [failedThumbnail, setFailedThumbnail] = useState<string | null>(null);
  const dateId = useId();
  const scheduledStart = formatScheduledStart(stream.scheduledStartTime);
  const thumbnailKey = JSON.stringify([stream.id, stream.thumbnailUrl]);
  const thumbnailAvailable = Boolean(stream.thumbnailUrl) && failedThumbnail !== thumbnailKey;

  return (
    <button
      type="button"
      className="youtube-stream-row"
      aria-label={`Select ${stream.title}${selected ? ', currently selected' : ''}`}
      aria-describedby={dateId}
      data-selected={selected ? 'true' : undefined}
      disabled={disabled}
      onClick={() => onSelect(stream)}
    >
      <span className="youtube-stream-row__thumbnail" aria-hidden="true">
        {thumbnailAvailable && (
          <img
            key={stream.thumbnailUrl}
            className="youtube-stream-row__thumbnail-image"
            src={stream.thumbnailUrl}
            alt=""
            draggable={false}
            onError={() => setFailedThumbnail(thumbnailKey)}
          />
        )}
      </span>
      <span className="youtube-stream-row__content">
        <span className="youtube-stream-row__title">{stream.title}</span>
        <span id={dateId} className="youtube-stream-row__date">{scheduledStart}</span>
      </span>
      {selected && <Check className="youtube-stream-row__check" size={14} aria-hidden="true" />}
    </button>
  );
}
