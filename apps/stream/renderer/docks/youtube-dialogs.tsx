import { useEffect, useId, useState, type FormEvent } from 'react';
import { ClipboardPaste, Eye, EyeOff } from 'lucide-react';
import { Banner, Modal, ReacstButton, Select, Textarea } from '@lumacast/ui';
import type { StreamServiceSettings, YouTubeAccount, YouTubeBroadcastDraft, YouTubePrivacy } from '../../shared/desktop-api';
import { getStreamService } from '../../shared/stream-services';

const PRIVACY_OPTIONS: ReadonlyArray<{ value: YouTubePrivacy; label: string }> = [
  { value: 'public', label: 'Public' },
  { value: 'unlisted', label: 'Unlisted' },
  { value: 'private', label: 'Private' },
];

export interface YouTubeSettingsDialogProps {
  open: boolean;
  account: YouTubeAccount | null;
  busy: boolean;
  error: string;
  settings: StreamServiceSettings;
  onChange(next: StreamServiceSettings): void;
  onConnect(): void;
  onDisconnect(): void;
  onClose(): void;
}

/** Settings for the compact YouTube dock; API work stays with the dock owner. */
export function YouTubeSettingsDialog({ open, account, busy, error, settings, onChange, onConnect, onDisconnect, onClose }: YouTubeSettingsDialogProps) {
  const [keyVisible, setKeyVisible] = useState(false);
  const [pasteFailed, setPasteFailed] = useState(false);
  const youtubePreset = getStreamService('youtube');

  useEffect(() => {
    if (!open) return;
    setKeyVisible(false);
    setPasteFailed(false);
  }, [open]);

  function update(patch: Partial<StreamServiceSettings>): void {
    onChange({ ...settings, service: 'youtube', ...patch });
  }

  async function pasteStreamKey(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      setPasteFailed(false);
      update({ streamKey: text.slice(0, 512) });
    } catch {
      setPasteFailed(true);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="YouTube settings">
      <div className="youtube-dialog">
        <section className="youtube-dialog-section" aria-labelledby="youtube-account-heading">
          <h3 id="youtube-account-heading">YouTube account</h3>
          <div className="youtube-dialog-account-row">
            <div>
              <strong>{account?.channelTitle ?? 'Not connected'}</strong>
              {account && <span>Connected channel</span>}
            </div>
            {account
              ? <ReacstButton variant="default" disabled={busy} onClick={onDisconnect}>{busy ? 'Disconnecting…' : 'Disconnect'}</ReacstButton>
              : <ReacstButton variant="default" disabled={busy} onClick={onConnect}>{busy ? 'Connecting…' : 'Connect YouTube'}</ReacstButton>}
          </div>
          {error && <Banner tone="error" size="sm">{error}</Banner>}
        </section>

        <section className="youtube-dialog-section" aria-labelledby="youtube-manual-heading">
          <h3 id="youtube-manual-heading">Manual RTMPS</h3>
          <p className="youtube-dialog-empty">Used when no YouTube account is connected.</p>
          <Select
            label="YouTube ingest server"
            size="sm"
            value={settings.serverId}
            onValueChange={(serverId) => update({ serverId })}
            options={youtubePreset.servers.map((server) => ({ value: server.id, label: server.label }))}
          />
          <label className="youtube-dialog-field">
            <span>{youtubePreset.keyLabel}</span>
            <div className="youtube-dialog-key-row">
              <input
                type={keyVisible ? 'text' : 'password'}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                maxLength={512}
                value={settings.streamKey}
                onChange={(event) => {
                  setPasteFailed(false);
                  update({ streamKey: event.target.value });
                }}
              />
              <ReacstButton.Icon variant="ghost" size="sm" label="Show stream key" pressed={keyVisible} tooltip={keyVisible ? 'Hide stream key' : 'Show stream key'} onClick={() => setKeyVisible((visible) => !visible)}>
                {keyVisible ? <EyeOff /> : <Eye />}
              </ReacstButton.Icon>
              <ReacstButton.Icon variant="ghost" size="sm" label="Paste stream key" onClick={() => void pasteStreamKey()}>
                <ClipboardPaste />
              </ReacstButton.Icon>
            </div>
            {pasteFailed && <Banner tone="error" size="sm">Clipboard access was denied.</Banner>}
          </label>
        </section>

        <div className="youtube-dialog-footer">
          <ReacstButton variant="default" onClick={onClose}>Done</ReacstButton>
        </div>
      </div>
    </Modal>
  );
}

export interface CreateYouTubeStreamDialogProps {
  open: boolean;
  initialDraft: YouTubeBroadcastDraft;
  busy: boolean;
  error: string;
  onClose(): void;
  onSubmit(draft: YouTubeBroadcastDraft): void;
}

function toLocalDateTimeValue(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function parseLocalDateTime(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

export function CreateYouTubeStreamDialog({ open, initialDraft, busy, error, onClose, onSubmit }: CreateYouTubeStreamDialogProps) {
  const [draft, setDraft] = useState<YouTubeBroadcastDraft>(() => ({ ...initialDraft }));
  const [touched, setTouched] = useState({ title: false, startTime: false });
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const formId = useId();
  const titleId = `${formId}-title`;
  const titleErrorId = `${formId}-title-error`;
  const startTimeId = `${formId}-start-time`;
  const startTimeErrorId = `${formId}-start-time-error`;
  useEffect(() => {
    if (!open) return;
    setDraft({ ...initialDraft });
    setTouched({ title: false, startTime: false });
    setSubmitAttempted(false);
  }, [open]);
  const titleValid = Boolean(draft.title.trim());
  const startTimestamp = Date.parse(draft.scheduledStartTime);
  const startTimeValid = Number.isFinite(startTimestamp) && startTimestamp > Date.now();
  const showTitleError = (touched.title || submitAttempted) && !titleValid;
  const showStartTimeError = (touched.startTime || submitAttempted) && !startTimeValid;

  function update(patch: Partial<YouTubeBroadcastDraft>): void {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setSubmitAttempted(true);
    if (busy || !titleValid || !startTimeValid) return;
    onSubmit(draft);
  }

  return (
    <Modal open={open} onClose={onClose} closeDisabled={busy} title="Create stream">
      <div className="youtube-dialog">
        <form className="youtube-dialog-form" noValidate onSubmit={submit}>
          <div className="youtube-dialog-field">
            <label htmlFor={titleId}>Title</label>
            <input
              id={titleId}
              type="text"
              maxLength={100}
              required
              disabled={busy}
              value={draft.title}
              aria-invalid={showTitleError || undefined}
              aria-describedby={showTitleError ? titleErrorId : undefined}
              onBlur={() => setTouched((current) => ({ ...current, title: true }))}
              onChange={(event) => update({ title: event.target.value })}
            />
            {showTitleError && <span id={titleErrorId} className="youtube-dialog-error" role="alert">Enter a title.</span>}
          </div>
          <Textarea label="Description" rows={3} maxLength={5000} disabled={busy} commitOn="change" value={draft.description} onValueChange={(description) => update({ description })} />
          <Select label="Stream privacy" size="sm" disabled={busy} value={draft.privacy} onValueChange={(privacy) => update({ privacy })} options={PRIVACY_OPTIONS} />
          <div className="youtube-dialog-field">
            <label htmlFor={startTimeId}>Start time</label>
            <input
              id={startTimeId}
              type="datetime-local"
              required
              disabled={busy}
              value={toLocalDateTimeValue(draft.scheduledStartTime)}
              aria-invalid={showStartTimeError || undefined}
              aria-describedby={showStartTimeError ? startTimeErrorId : undefined}
              onBlur={() => setTouched((current) => ({ ...current, startTime: true }))}
              onChange={(event) => update({ scheduledStartTime: parseLocalDateTime(event.target.value) })}
            />
            {showStartTimeError && <span id={startTimeErrorId} className="youtube-dialog-error" role="alert">Choose a future start time.</span>}
          </div>
          <p className="youtube-dialog-empty">The stream will be created and selected. It will not go live yet.</p>
          {error && <Banner tone="error" size="sm">{error}</Banner>}
          <div className="youtube-dialog-footer">
            <ReacstButton variant="default" disabled={busy} onClick={onClose}>Cancel</ReacstButton>
            <ReacstButton variant="success" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create stream'}</ReacstButton>
          </div>
        </form>
      </div>
    </Modal>
  );
}

export interface EndYouTubeStreamDialogProps {
  open: boolean;
  busy?: boolean;
  onCancel(): void;
  onConfirm(): void;
}

export function EndYouTubeStreamDialog({ open, busy = false, onCancel, onConfirm }: EndYouTubeStreamDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} closeDisabled={busy} title="End stream?">
      <div className="youtube-dialog">
        <p className="youtube-dialog-confirm-copy">This will stop your YouTube stream.</p>
        <div className="youtube-dialog-footer">
          <ReacstButton variant="default" disabled={busy} onClick={onCancel}>Keep streaming</ReacstButton>
          <ReacstButton variant="danger" disabled={busy} onClick={onConfirm}>{busy ? 'Ending…' : 'End stream'}</ReacstButton>
        </div>
      </div>
    </Modal>
  );
}
