import { Radio } from 'lucide-react';
import type { YouTubeLiveDetails } from '../../shared/desktop-api';

export interface YouTubeStreamDetailsProps {
  title?: string | null;
  details: YouTubeLiveDetails | null;
  loading?: boolean;
  onChooseStream?: () => void;
}

type NoticeSeverity = 'warning' | 'error' | 'info';

function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return '—';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.floor(value));
}

function getHealthLabel(health: YouTubeLiveDetails['health']): string {
  switch (health) {
    case 'excellent': return 'Excellent';
    case 'warning': return 'Warning';
    case 'error': return 'Error';
    case 'waiting': return 'Waiting for stream';
  }
}

function getNoticeSeverity(severity: string): NoticeSeverity {
  if (severity === 'warning' || severity === 'error') return severity;
  return 'info';
}

export function YouTubeStreamDetails({ title, details, loading = false, onChooseStream }: YouTubeStreamDetailsProps) {
  const streamTitle = details?.title?.trim() || title?.trim();
  if (!streamTitle && !details) return null;

  const health = details?.health ?? 'waiting';
  const notices = details?.notices ?? [];
  const titleRowClass = `youtube-stream-details-title${onChooseStream ? ' youtube-stream-details-title--button youtube-stream-select-button' : ''}`;
  const titleContent = <><Radio size={16} aria-hidden="true" /><span>{streamTitle || 'Stream details'}</span></>;

  return (
    <section className="youtube-stream-details" aria-label="Current stream details" aria-busy={loading}>
      {onChooseStream
        ? <button type="button" className={titleRowClass} aria-label={streamTitle ? `Choose stream: ${streamTitle}` : 'Choose a stream'} onClick={onChooseStream}>{titleContent}</button>
        : <div className={titleRowClass}>{titleContent}</div>}
      <div className="youtube-health-row" role="status" aria-live="polite" aria-atomic="true" aria-label={`Stream health: ${getHealthLabel(health)}`}>
        <span className={`youtube-health-dot youtube-health-dot--${health}`} aria-hidden="true" />
        <span className="youtube-health-label">{getHealthLabel(health)}</span>
      </div>
      <div className="youtube-stream-metrics">
        <div className="youtube-stream-metric">
          <span className="youtube-stream-metric__label">Current viewers</span>
          <span className="youtube-stream-metric__value">{formatCount(details?.currentViewers)}</span>
        </div>
        <span className="youtube-stream-metrics__divider" aria-hidden="true" />
        <div className="youtube-stream-metric">
          <span className="youtube-stream-metric__label">Views</span>
          <span className="youtube-stream-metric__value">{formatCount(details?.viewCount)}</span>
        </div>
      </div>
      {notices.map((notice, index) => {
        const severity = getNoticeSeverity(notice.severity);
        return (
          <aside className={`youtube-notice youtube-notice--${severity}`} role={severity === 'error' ? 'alert' : 'status'} aria-atomic="true" key={`${notice.type}-${notice.title}-${index}`}>
            <span className="youtube-notice__label">{notice.title}</span>
            <span className="youtube-notice__text">{notice.description}</span>
          </aside>
        );
      })}
    </section>
  );
}
