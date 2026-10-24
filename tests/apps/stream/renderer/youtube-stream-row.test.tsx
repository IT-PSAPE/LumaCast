import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { YouTubeStreamRow } from '../../../../apps/stream/renderer/docks/youtube-stream-row';
import type { YouTubeBroadcast } from '../../../../apps/stream/shared/desktop-api';

afterEach(cleanup);

function makeBroadcast(overrides: Partial<YouTubeBroadcast> = {}): YouTubeBroadcast {
  return {
    id: 'broadcast-1',
    title: 'Weekly show',
    description: '',
    scheduledStartTime: '2030-08-10T14:30:00.000Z',
    status: 'upcoming',
    privacy: 'unlisted',
    thumbnailUrl: 'data:image/png;base64,ZmFrZQ==',
    ...overrides,
  };
}

describe('YouTubeStreamRow', () => {
  it('selects the broadcast represented by the activated row', () => {
    const stream = makeBroadcast();
    const onSelect = vi.fn();
    render(<YouTubeStreamRow stream={stream} onSelect={onSelect} />);

    const scheduledDate = new Date(stream.scheduledStartTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    expect(screen.getByText(scheduledDate)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select Weekly show' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(stream);
  });

  it('exposes selection and disabled state through native button semantics', () => {
    const onSelect = vi.fn();
    render(<YouTubeStreamRow stream={makeBroadcast()} selected disabled onSelect={onSelect} />);
    const row = screen.getByRole('button', { name: 'Select Weekly show, currently selected' });

    expect(row).toHaveAttribute('data-selected', 'true');
    expect(row).not.toHaveAttribute('aria-pressed');
    expect(row).toBeDisabled();
    const check = row.querySelector('.youtube-stream-row__check');
    expect(check).toBeInTheDocument();
    expect(check).toHaveAttribute('width', '14');

    fireEvent.click(row);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows a useful fallback when the scheduled date is invalid', () => {
    render(<YouTubeStreamRow stream={makeBroadcast({ scheduledStartTime: 'invalid-date' })} onSelect={vi.fn()} />);

    expect(screen.getByText('Time not set')).toBeInTheDocument();
    expect(screen.queryByText('Invalid Date')).not.toBeInTheDocument();
  });

  it('leaves the neutral thumbnail area empty when no thumbnail is available', () => {
    const { container } = render(<YouTubeStreamRow stream={makeBroadcast({ thumbnailUrl: '' })} onSelect={vi.fn()} />);
    const thumbnail = container.querySelector('.youtube-stream-row__thumbnail');

    expect(thumbnail).toBeInTheDocument();
    expect(thumbnail).toBeEmptyDOMElement();
  });

  it('removes a failed thumbnail while preserving its empty thumbnail area', () => {
    const { container } = render(<YouTubeStreamRow stream={makeBroadcast()} onSelect={vi.fn()} />);
    const thumbnail = container.querySelector('.youtube-stream-row__thumbnail')!;

    fireEvent.error(thumbnail.querySelector('img')!);

    expect(thumbnail).toBeEmptyDOMElement();
  });

  it('retries a thumbnail when the row switches to a different broadcast', () => {
    const firstStream = makeBroadcast();
    const secondStream = makeBroadcast({ id: 'broadcast-2' });
    const onSelect = vi.fn();
    const { container, rerender } = render(<YouTubeStreamRow stream={firstStream} onSelect={onSelect} />);
    const thumbnail = container.querySelector('.youtube-stream-row__thumbnail')!;

    fireEvent.error(thumbnail.querySelector('img')!);
    expect(thumbnail).toBeEmptyDOMElement();

    rerender(<YouTubeStreamRow stream={secondStream} onSelect={onSelect} />);

    expect(container.querySelector('.youtube-stream-row__thumbnail img')).toHaveAttribute('src', firstStream.thumbnailUrl);
  });
});
