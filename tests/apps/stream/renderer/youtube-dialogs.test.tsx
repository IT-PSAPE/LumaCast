import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CreateYouTubeStreamDialog } from '../../../../apps/stream/renderer/docks/youtube-dialogs';
import type { YouTubeBroadcastDraft } from '../../../../apps/stream/shared/desktop-api';

afterEach(cleanup);

function makeDraft(overrides: Partial<YouTubeBroadcastDraft> = {}): YouTubeBroadcastDraft {
  return {
    title: '',
    description: '',
    privacy: 'unlisted',
    broadcastId: '',
    scheduledStartTime: '',
    ...overrides,
  };
}

function futureLocalDateTime(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

describe('CreateYouTubeStreamDialog', () => {
  it('does not announce initial empty-field errors, then associates submit errors with each field', () => {
    render(
      <CreateYouTubeStreamDialog
        open
        initialDraft={makeDraft()}
        busy={false}
        error=""
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const title = screen.getByLabelText('Title');
    const startTime = screen.getByLabelText('Start time');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(title).not.toHaveAttribute('aria-invalid', 'true');
    expect(startTime).not.toHaveAttribute('aria-invalid', 'true');

    fireEvent.blur(title);
    expect(screen.getByText('Enter a title.')).toHaveAttribute('role', 'alert');
    expect(screen.queryByText('Choose a future start time.')).toBeNull();
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(startTime).not.toHaveAttribute('aria-invalid', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Create stream' }));

    const titleError = screen.getByText('Enter a title.');
    const startTimeError = screen.getByText('Choose a future start time.');
    expect(titleError).toHaveAttribute('role', 'alert');
    expect(startTimeError).toHaveAttribute('role', 'alert');
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title).toHaveAttribute('aria-describedby', titleError.id);
    expect(startTime).toHaveAttribute('aria-invalid', 'true');
    expect(startTime).toHaveAttribute('aria-describedby', startTimeError.id);
  });

  it('clears field errors when values become valid and submits the selected time', () => {
    const onSubmit = vi.fn();
    const initialDraft = makeDraft();
    render(
      <CreateYouTubeStreamDialog
        open
        initialDraft={initialDraft}
        busy={false}
        error=""
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create stream' }));
    const title = screen.getByLabelText('Title');
    const startTime = screen.getByLabelText('Start time');
    expect(screen.getAllByRole('alert')).toHaveLength(2);

    const localStartTime = futureLocalDateTime();
    fireEvent.change(title, { target: { value: 'Weekly show' } });
    fireEvent.change(startTime, { target: { value: localStartTime } });

    expect(screen.queryByRole('alert')).toBeNull();
    expect(title).not.toHaveAttribute('aria-invalid', 'true');
    expect(startTime).not.toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Create stream' }));

    expect(onSubmit).toHaveBeenCalledWith({
      ...initialDraft,
      title: 'Weekly show',
      scheduledStartTime: new Date(Date.parse(localStartTime)).toISOString(),
    });
  });

  it('prevents closing and submitting while the create callback is busy', () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    render(
      <CreateYouTubeStreamDialog
        open
        initialDraft={makeDraft({ title: 'Weekly show', scheduledStartTime: new Date(Date.now() + 60_000).toISOString() })}
        busy
        error=""
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByLabelText('Title')).toBeDisabled();
    expect(screen.getByLabelText('Description')).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Stream privacy' })).toBeDisabled();
    expect(screen.getByLabelText('Start time')).toBeDisabled();
    const closeButton = screen.getByRole('button', { name: 'Close dialog' });
    expect(closeButton).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Create stream' }), { key: 'Escape' });
    fireEvent.click(closeButton);

    expect(onClose).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Create stream' })).toBeInTheDocument();
  });
});
