import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
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
  readOnly?: boolean;
  readClipboardText(): Promise<string>;
  error: string;
  settings: StreamServiceSettings;
  onChange(next: StreamServiceSettings): void;
  onConnect(): void;
  onDisconnect(): void;
  onClose(): void;
}

/** Settings for the compact YouTube dock; API work stays with the dock owner. */
export function YouTubeSettingsDialog({ open, account, busy, readOnly = false, readClipboardText, error, settings, onChange, onConnect, onDisconnect, onClose }: YouTubeSettingsDialogProps) {
  const [keyVisible, setKeyVisible] = useState(false);
  const [pasteFailed, setPasteFailed] = useState(false);
  const settingsRef = useRef(settings);
  const openRef = useRef(open);
  const previousOpenRef = useRef(open);
  const readOnlyRef = useRef(readOnly);
  const settingsRevisionRef = useRef(0);
  const pasteRequestRef = useRef(0);
  settingsRef.current = settings;
  openRef.current = open;
  readOnlyRef.current = readOnly;
  const youtubePreset = getStreamService('youtube');

  useEffect(() => {
    if (!open) return;
    setKeyVisible(false);
    setPasteFailed(false);
  }, [open]);

  useEffect(() => () => { pasteRequestRef.current += 1; }, []);
  useLayoutEffect(() => {
    if ((previousOpenRef.current && !open) || readOnly) pasteRequestRef.current += 1;
    previousOpenRef.current = open;
  }, [open, readOnly]);

  function update(patch: Partial<StreamServiceSettings>): void {
    if (readOnlyRef.current) return;
    settingsRevisionRef.current += 1;
    const nextSettings = { ...settingsRef.current, service: 'youtube' as const, ...patch };
    settingsRef.current = nextSettings;
    onChange(nextSettings);
  }

  function close(): void {
    pasteRequestRef.current += 1;
    onClose();
  }

  async function pasteStreamKey(): Promise<void> {
    if (!openRef.current || readOnlyRef.current) return;
    const requestId = ++pasteRequestRef.current;
    const settingsRevision = settingsRevisionRef.current;
    const isCurrentRequest = () => requestId === pasteRequestRef.current
      && openRef.current && !readOnlyRef.current && settingsRevision === settingsRevisionRef.current;
    try {
      const text = await readClipboardText();
      if (!isCurrentRequest()) return;
      setPasteFailed(false);
      if (text.length > 0) update({ streamKey: text.slice(0, 512) });
    } catch {
      if (isCurrentRequest()) setPasteFailed(true);
    }
  }

  return (
    <Modal open={open} onClose={close} title="YouTube settings">
      <div className="youtube-dialog">
        <section className="youtube-dialog-section" aria-labelledby="youtube-account-heading">
          <h3 id="youtube-account-heading">YouTube account</h3>
          <div className="youtube-dialog-account-row">
            <div>
              <strong>{account?.channelTitle ?? 'Not connected'}</strong>
              {account && <span>Connected channel</span>}
            </div>
            {account
              ? <ReacstButton variant="default" disabled={busy || readOnly} onClick={onDisconnect}>{busy ? 'Disconnecting…' : 'Disconnect'}</ReacstButton>
              : <ReacstButton variant="default" disabled={busy || readOnly} onClick={onConnect}>{busy ? 'Connecting…' : 'Connect YouTube'}</ReacstButton>}
          </div>
          {error && <Banner tone="error" size="sm">{error}</Banner>}
        </section>

        <section className="youtube-dialog-section" aria-labelledby="youtube-manual-heading">
          <h3 id="youtube-manual-heading">Manual streaming</h3>
          <p className="youtube-dialog-empty">Used when no YouTube account is connected.</p>
          <Select
            label="YouTube ingest server"
            size="sm"
            value={settings.serverId}
            disabled={readOnly}
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
                disabled={readOnly}
                value={settings.streamKey}
                onChange={(event) => {
                  setPasteFailed(false);
                  update({ streamKey: event.target.value });
                }}
              />
              <ReacstButton.Icon variant="ghost" size="sm" label="Show stream key" pressed={keyVisible} disabled={readOnly} tooltip={keyVisible ? 'Hide stream key' : 'Show stream key'} onClick={() => setKeyVisible((visible) => !visible)}>
                {keyVisible ? <EyeOff /> : <Eye />}
              </ReacstButton.Icon>
              <ReacstButton.Icon variant="ghost" size="sm" label="Paste stream key" disabled={readOnly} onClick={() => void pasteStreamKey()}>
                <ClipboardPaste />
              </ReacstButton.Icon>
            </div>
            {pasteFailed && <Banner tone="error" size="sm">Clipboard access was denied.</Banner>}
          </label>
        </section>

        <div className="youtube-dialog-footer">
          <ReacstButton variant="default" onClick={close}>Done</ReacstButton>
        </div>
      </div>
    </Modal>
  );
}

export interface CreateYouTubeStreamDialogProps {
  open: boolean;
  initialDraft: YouTubeBroadcastDraft;
  busy: boolean;
  selectionLocked?: boolean;
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

export function CreateYouTubeStreamDialog({ open, initialDraft, busy, selectionLocked = false, error, onClose, onSubmit }: CreateYouTubeStreamDialogProps) {
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
    if (busy || selectionLocked || !titleValid || !startTimeValid) return;
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
              disabled={busy || selectionLocked}
              value={draft.title}
              aria-invalid={showTitleError || undefined}
              aria-describedby={showTitleError ? titleErrorId : undefined}
              onBlur={() => setTouched((current) => ({ ...current, title: true }))}
              onChange={(event) => update({ title: event.target.value })}
            />
            {showTitleError && <span id={titleErrorId} className="youtube-dialog-error" role="alert">Enter a title.</span>}
          </div>
          <Textarea label="Description" rows={3} maxLength={5000} disabled={busy || selectionLocked} commitOn="change" value={draft.description} onValueChange={(description) => update({ description })} />
          <Select label="Stream privacy" size="sm" disabled={busy || selectionLocked} value={draft.privacy} onValueChange={(privacy) => update({ privacy })} options={PRIVACY_OPTIONS} />
          <div className="youtube-dialog-field">
            <label htmlFor={startTimeId}>Start time</label>
            <input
              id={startTimeId}
              type="datetime-local"
              required
              disabled={busy || selectionLocked}
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
            <ReacstButton variant="success" type="submit" disabled={busy || selectionLocked}>{busy ? 'Creating…' : 'Create stream'}</ReacstButton>
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
