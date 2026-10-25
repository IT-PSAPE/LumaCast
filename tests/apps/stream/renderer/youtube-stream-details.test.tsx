import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { YouTubeStreamDetails, type YouTubeStreamDetailsProps } from '../../../../apps/stream/renderer/docks/youtube-stream-details';
import type { YouTubeLiveDetails } from '../../../../apps/stream/shared/desktop-api';

afterEach(cleanup);

const baseDetails: YouTubeLiveDetails = {
  title: 'Community stream',
  currentViewers: 42,
  viewCount: 1_234,
  health: 'excellent',
  notices: [],
};

function renderDetails(details: YouTubeLiveDetails | null, title = 'Selected broadcast') {
  const props: YouTubeStreamDetailsProps = { title, details };
  return render(<YouTubeStreamDetails {...props} />);
}

describe('YouTubeStreamDetails', () => {
  it('formats real viewer and view counts', () => {
    renderDetails(baseDetails);

    expect(screen.getByText(new Intl.NumberFormat().format(42))).toBeInTheDocument();
    expect(screen.getByText(new Intl.NumberFormat().format(1_234))).toBeInTheDocument();
  });

  it('keeps the title as plain text unless a stream chooser action is supplied', () => {
    const onChooseStream = vi.fn();
    const { rerender } = render(<YouTubeStreamDetails title="Selected broadcast" details={baseDetails} onChooseStream={onChooseStream} />);

    const titleButton = screen.getByRole('button', { name: 'Choose stream: Community stream' });
    expect(titleButton).toHaveClass('youtube-stream-details-title');
    expect(titleButton).toHaveClass('youtube-stream-select-button');
    fireEvent.click(titleButton);
    expect(onChooseStream).toHaveBeenCalledOnce();
    rerender(<YouTubeStreamDetails title="Selected broadcast" details={{ ...baseDetails, viewCount: 1_235 }} onChooseStream={onChooseStream} />);
    expect(screen.getByRole('button', { name: 'Choose stream: Community stream' })).toBe(titleButton);

    cleanup();
    renderDetails(baseDetails);
    expect(screen.queryByRole('button', { name: /choose stream/i })).toBeNull();
  });

  it('shows em dashes for null metrics', () => {
    renderDetails({ ...baseDetails, currentViewers: null, viewCount: null });

    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('shows em dashes for non-finite metrics', () => {
    renderDetails({ ...baseDetails, currentViewers: Number.NaN, viewCount: Number.POSITIVE_INFINITY });

    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('renders each YouTube health status independently of output status', () => {
    const { rerender } = renderDetails(null);
    const states = [
      ['waiting', 'Waiting for stream'],
      ['excellent', 'Excellent'],
      ['warning', 'Warning'],
      ['error', 'Error'],
    ] as const;

    for (const [health, label] of states) {
      const details = health === 'waiting' ? null : { ...baseDetails, health };
      rerender(<YouTubeStreamDetails title="Selected broadcast" details={details} />);
      expect(screen.getByRole('status', { name: `Stream health: ${label}` })).toBeInTheDocument();
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('exposes provider notice titles by severity and keeps metrics outside live regions', () => {
    renderDetails({
      ...baseDetails,
      notices: [
        { severity: 'warning', type: 'copyright', title: 'Copyright notice', description: 'A copyright match was detected.' },
        { severity: 'error', type: 'streamInterrupted', title: 'Stream interrupted', description: 'YouTube reports that this stream stopped.' },
      ],
    });

    const copyrightNotice = screen.getByText('Copyright notice').closest('[role="status"]');
    expect(copyrightNotice).toHaveTextContent('A copyright match was detected.');
    expect(screen.getByText('A copyright match was detected.')).toBeInTheDocument();
    const interruptionNotice = screen.getByText('Stream interrupted').closest('[role="alert"]');
    expect(interruptionNotice).toHaveTextContent('YouTube reports that this stream stopped.');
    expect(screen.getByText('YouTube reports that this stream stopped.')).toBeInTheDocument();
    // Severity is conveyed to assistive tech by politeness: a warning waits, an error interrupts.
    expect(copyrightNotice).toHaveAttribute('aria-live', 'polite');
    expect(interruptionNotice).toHaveAttribute('aria-live', 'assertive');
    expect(copyrightNotice).not.toBe(interruptionNotice);

    const health = screen.getByRole('status', { name: 'Stream health: Excellent' });
    expect(health).toHaveAttribute('aria-live', 'polite');
    expect(health).toHaveAttribute('aria-atomic', 'true');
    expect(copyrightNotice).toHaveAttribute('aria-atomic', 'true');
    expect(interruptionNotice).toHaveAttribute('aria-atomic', 'true');
    for (const value of [42, 1_234]) {
      expect(screen.getByText(new Intl.NumberFormat().format(value)).closest('[role="status"], [role="alert"]')).toBeNull();
    }
  });
});
