import { Radio } from 'lucide-react';
import { Banner, ReacstButton, StatusDot, type BannerTone, type StatusTone } from '@lumacast/ui';
import type { YouTubeLiveDetails } from '../../shared/desktop-api';

export interface YouTubeStreamDetailsProps {
  title?: string | null;
  details: YouTubeLiveDetails | null;
  loading?: boolean;
  outputState?: 'stopped' | 'connecting' | 'live' | 'error';
  providerHealthFresh?: boolean;
  metricsUnavailableMessage?: string;
  onChooseStream?: () => void;
  onReturn?: () => void;
}

type NoticeSeverity = Extract<BannerTone, 'warning' | 'error' | 'info'>;

const HEALTH_TONES: Record<YouTubeLiveDetails['health'], StatusTone> = { waiting: 'neutral', excellent: 'success', warning: 'warning', error: 'error' };
const OUTPUT_STATE_TONES: Record<NonNullable<YouTubeStreamDetailsProps['outputState']>, StatusTone> = {
  stopped: 'neutral',
  connecting: 'warning',
  live: 'success',
  error: 'error',
};

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

function getOutputStateLabel(state: NonNullable<YouTubeStreamDetailsProps['outputState']>): string {
  switch (state) {
    case 'stopped': return 'Waiting for stream';
    case 'connecting': return 'Connecting';
    case 'live': return 'Streaming';
    case 'error': return 'Error';
  }
}

function getNoticeSeverity(severity: string): NoticeSeverity {
  if (severity === 'warning' || severity === 'error') return severity;
  return 'info';
}

export function YouTubeStreamDetails({ title, details, loading = false, outputState, providerHealthFresh = true, metricsUnavailableMessage, onChooseStream, onReturn }: YouTubeStreamDetailsProps) {
  const streamTitle = details?.title?.trim() || title?.trim();
  if (!streamTitle && !details) return null;

  const outputStateLabel = outputState ? getOutputStateLabel(outputState) : null;
  const providerHealth = details && providerHealthFresh ? details.health : null;
  const providerHealthLabel = providerHealth ? getHealthLabel(providerHealth) : null;
  const notices = details?.notices ?? [];
  const titleRowClass = `youtube-stream-details-title${onChooseStream ? ' youtube-stream-details-title--button youtube-stream-select-button' : ''}`;
  const titleContent = <><Radio size={16} aria-hidden="true" /><span>{streamTitle || 'Stream details'}</span></>;

  return (
    <section className={`youtube-stream-details${onReturn ? ' youtube-stream-details--returnable' : ''}`} aria-label="Current stream details" aria-busy={loading}>
      {onChooseStream
        ? <button type="button" className={titleRowClass} aria-label={streamTitle ? `Choose stream: ${streamTitle}` : 'Choose a stream'} onClick={onChooseStream}>{titleContent}</button>
        : <div className={titleRowClass}>{titleContent}</div>}
      {(outputState || providerHealth) && <div className="youtube-stream-statuses">
        {outputState && outputStateLabel && <div className="youtube-health-row" role="status" aria-live="polite" aria-atomic="true" aria-label={`Output status: ${outputStateLabel}`}>
          <StatusDot tone={OUTPUT_STATE_TONES[outputState]} />
          <span className="youtube-health-label">{outputStateLabel}</span>
        </div>}
        {providerHealth && providerHealthLabel && <div className="youtube-health-row" role="status" aria-live="polite" aria-atomic="true" aria-label={`Provider health: ${providerHealthLabel}`}>
          <StatusDot tone={HEALTH_TONES[providerHealth]} />
          <span className="youtube-health-label">YouTube health: {providerHealthLabel}</span>
        </div>}
      </div>}
      <div className="youtube-stream-metrics-group">
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
        {metricsUnavailableMessage && <p className="youtube-stream-metrics-hint">{metricsUnavailableMessage}</p>}
      </div>
      {notices.map((notice, index) => {
        const severity = getNoticeSeverity(notice.severity);
        return (
          <Banner tone={severity} size="sm" title={notice.title} key={`${notice.type}-${notice.title}-${index}`}>{notice.description}</Banner>
        );
      })}
      {onReturn && <ReacstButton variant="default" className="youtube-stream-return" onClick={onReturn}>Return</ReacstButton>}
    </section>
  );
}
