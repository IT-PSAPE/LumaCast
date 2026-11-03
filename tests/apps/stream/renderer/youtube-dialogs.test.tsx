import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CreateYouTubeStreamDialog, YouTubeSettingsDialog, type YouTubeSettingsDialogProps } from '../../../../apps/stream/renderer/docks/youtube-dialogs';
import { createDefaultStreamServiceSettings, type YouTubeBroadcastDraft } from '../../../../apps/stream/shared/desktop-api';

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function renderYouTubeSettingsDialog(overrides: Partial<YouTubeSettingsDialogProps> = {}) {
  const props: YouTubeSettingsDialogProps = {
    open: true,
    account: null,
    busy: false,
    error: '',
    settings: createDefaultStreamServiceSettings(),
    readClipboardText: vi.fn().mockResolvedValue(''),
    onChange: vi.fn(),
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return { ...render(<YouTubeSettingsDialog {...props} />), props };
}

describe('YouTubeSettingsDialog clipboard paste', () => {
  it('pastes non-empty clipboard text into the stream key and preserves other settings', async () => {
    const settings = { ...createDefaultStreamServiceSettings(), serverId: 'legacy', streamKey: 'old-key' };
    const readClipboardText = vi.fn().mockResolvedValue('new-key');
    const { props } = renderYouTubeSettingsDialog({ settings, readClipboardText });

    fireEvent.click(screen.getByRole('button', { name: 'Paste stream key' }));

    await waitFor(() => expect(props.onChange).toHaveBeenCalledWith({ ...settings, streamKey: 'new-key' }));
    expect(readClipboardText).toHaveBeenCalledOnce();
  });

  it('leaves the existing key intact when the clipboard is empty', async () => {
    const settings = { ...createDefaultStreamServiceSettings(), streamKey: 'keep-this-key' };
    const readClipboardText = vi.fn().mockResolvedValue('');
    const { props } = renderYouTubeSettingsDialog({ settings, readClipboardText });

    fireEvent.click(screen.getByRole('button', { name: 'Paste stream key' }));

    await waitFor(() => expect(readClipboardText).toHaveBeenCalledOnce());
    expect(props.onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Stream Key')).toHaveValue('keep-this-key');
    expect(screen.queryByText('Clipboard access was denied.')).toBeNull();
  });

  it('shows an error when the native clipboard read rejects', async () => {
    const { props } = renderYouTubeSettingsDialog({
      readClipboardText: vi.fn().mockRejectedValue(new Error('clipboard unavailable')),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Paste stream key' }));

    expect(await screen.findByText('Clipboard access was denied.')).toBeInTheDocument();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('discards a pending clipboard result after read-only mode engages', async () => {
    const clipboardRead = deferred<string>();
    const { props, rerender } = renderYouTubeSettingsDialog({ readClipboardText: vi.fn(() => clipboardRead.promise) });

    fireEvent.click(screen.getByRole('button', { name: 'Paste stream key' }));
    rerender(<YouTubeSettingsDialog {...props} readOnly />);
    await act(async () => clipboardRead.resolve('late-key'));

    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('keeps a pending clipboard result invalidated after read-only mode engages and unlocks', async () => {
    const clipboardRead = deferred<string>();
    const { props, rerender } = renderYouTubeSettingsDialog({ readClipboardText: vi.fn(() => clipboardRead.promise) });

    fireEvent.click(screen.getByRole('button', { name: 'Paste stream key' }));
    rerender(<YouTubeSettingsDialog {...props} readOnly />);
    rerender(<YouTubeSettingsDialog {...props} readOnly={false} />);
    await act(async () => clipboardRead.resolve('late-key'));

    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('discards a pending clipboard result after close and reopen', async () => {
    const clipboardRead = deferred<string>();
    const { props, rerender } = renderYouTubeSettingsDialog({ readClipboardText: vi.fn(() => clipboardRead.promise) });

    fireEvent.click(screen.getByRole('button', { name: 'Paste stream key' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    rerender(<YouTubeSettingsDialog {...props} open={false} />);
    rerender(<YouTubeSettingsDialog {...props} open />);
    await act(async () => clipboardRead.resolve('late-key'));

    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('does not overwrite a newer stream key edit while the clipboard read is pending', async () => {
    const settings = createDefaultStreamServiceSettings();
    const clipboardRead = deferred<string>();
    const { props, rerender } = renderYouTubeSettingsDialog({ settings, readClipboardText: vi.fn(() => clipboardRead.promise) });

    fireEvent.click(screen.getByRole('button', { name: 'Paste stream key' }));
    fireEvent.change(screen.getByLabelText('Stream Key'), { target: { value: 'manually-entered-key' } });
    props.settings = { ...settings, streamKey: 'manually-entered-key' };
    rerender(<YouTubeSettingsDialog {...props} />);
    await act(async () => clipboardRead.resolve('late-key'));

    expect(props.onChange).toHaveBeenCalledOnce();
    expect(props.onChange).toHaveBeenCalledWith({ ...settings, streamKey: 'manually-entered-key' });
  });
});

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

  it('locks stream creation while another output is active but still allows closing the dialog', () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    render(
      <CreateYouTubeStreamDialog
        open
        initialDraft={makeDraft({ title: 'Weekly show', scheduledStartTime: new Date(Date.now() + 60_000).toISOString() })}
        busy={false}
        selectionLocked
        error=""
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByLabelText('Title')).toBeDisabled();
    expect(screen.getByLabelText('Description')).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Stream privacy' })).toBeDisabled();
    expect(screen.getByLabelText('Start time')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create stream' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
