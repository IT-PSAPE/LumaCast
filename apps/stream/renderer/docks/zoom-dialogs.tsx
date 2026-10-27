import { useEffect, useId, useState, type FormEvent } from 'react';
import { Banner, Modal, NumberField, ReacstButton, TextField } from '@lumacast/ui';
import type { StreamServiceSettings, ZoomAccount } from '../../shared/desktop-api';

function toLocalDateTimeValue(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function parseLocalDateTime(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

export function ZoomSettingsDialog({ open, account, busy, readOnly = false, error, onConnect, onDisconnect, onClose }: {
  open: boolean; account: ZoomAccount | null; busy: boolean; readOnly?: boolean; error: string; onConnect(): void; onDisconnect(): void; onClose(): void;
}) {
  return <Modal open={open} onClose={onClose} closeDisabled={busy} size="sm" title="Zoom settings">
    <div className="zoom-dialog">
      <section className="zoom-dialog-account" aria-label="Zoom account">
        <div><strong>{account?.displayName ?? 'Not connected'}</strong>{account?.email && <span>{account.email}</span>}</div>
        {account ? <ReacstButton variant="default" disabled={busy || readOnly} onClick={onDisconnect}>{busy ? 'Disconnecting…' : 'Disconnect'}</ReacstButton> : <ReacstButton variant="default" disabled={busy || readOnly} onClick={onConnect}>{busy ? 'Connecting…' : 'Connect Zoom'}</ReacstButton>}
      </section>
      {error && <Banner tone="error" size="sm">{error}</Banner>}
      <div className="zoom-dialog-footer"><ReacstButton variant="default" disabled={busy} onClick={onClose}>Done</ReacstButton></div>
    </div>
  </Modal>;
}

export function CreateZoomMeetingDialog({ open, initialDraft, busy, error, onClose, onSubmit }: {
  open: boolean; initialDraft: StreamServiceSettings['zoom']; busy: boolean; error: string; onClose(): void; onSubmit(draft: StreamServiceSettings['zoom']): void;
}) {
  const [draft, setDraft] = useState(() => ({ ...initialDraft }));
  const [attempted, setAttempted] = useState(false);
  const timeId = useId();
  useEffect(() => {
    if (!open) return;
    setDraft({ ...initialDraft, startTime: initialDraft.startTime && Date.parse(initialDraft.startTime) > Date.now() ? initialDraft.startTime : new Date(Date.now() + 10 * 60_000).toISOString() });
    setAttempted(false);
  }, [open]);
  const topicValid = Boolean(draft.topic.trim());
  const timestamp = Date.parse(draft.startTime);
  const timeValid = Number.isFinite(timestamp) && timestamp > Date.now();
  const durationValid = Number.isInteger(draft.durationMinutes) && draft.durationMinutes >= 1 && draft.durationMinutes <= 1440;

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault(); setAttempted(true);
    if (!busy && topicValid && timeValid && durationValid) onSubmit({ ...draft, topic: draft.topic.trim() });
  }
  return <Modal open={open} onClose={onClose} closeDisabled={busy} size="sm" title="New Zoom meeting">
    <div className="zoom-dialog">
      <form className="zoom-dialog-form" noValidate onSubmit={submit}>
        <TextField size="sm" label="Topic" maxLength={200} disabled={busy} value={draft.topic} error={attempted && !topicValid ? 'Enter a meeting topic.' : undefined} onValueChange={(topic) => setDraft((current) => ({ ...current, topic }))} />
        <label className="zoom-dialog-field" htmlFor={timeId}><span>Start time</span><input id={timeId} type="datetime-local" disabled={busy} value={toLocalDateTimeValue(draft.startTime)} aria-invalid={attempted && !timeValid || undefined} aria-describedby={attempted && !timeValid ? `${timeId}-error` : undefined} onChange={(event) => setDraft((current) => ({ ...current, startTime: parseLocalDateTime(event.target.value) }))} /></label>
        {attempted && !timeValid && <span id={`${timeId}-error`} className="zoom-dialog-error" role="alert">Choose a future start time.</span>}
        <NumberField size="sm" label="Duration" suffix="min" min={1} max={1440} step={1} precision={0} disabled={busy} value={draft.durationMinutes} error={attempted && !durationValid ? 'Duration must be 1–1440 minutes.' : undefined} onValueChange={(durationMinutes) => setDraft((current) => ({ ...current, durationMinutes }))} />
        {error && <Banner tone="error" size="sm">{error}</Banner>}
        <div className="zoom-dialog-footer"><ReacstButton variant="default" disabled={busy} onClick={onClose}>Cancel</ReacstButton><ReacstButton variant="primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create meeting'}</ReacstButton></div>
      </form>
    </div>
  </Modal>;
}
