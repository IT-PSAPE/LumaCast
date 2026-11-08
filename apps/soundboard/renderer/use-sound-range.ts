import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SoundPlaybackSettings } from "../shared/desktop-api";
import type { SaveSoundSettings } from "./sound-ports";

export const MIN_RANGE = 0.1;
const round = (value: number) => Math.round(value * 100) / 100;
type Range = [number, number];
type RangeIntent = Pick<SoundPlaybackSettings, "startTime" | "endTime">;
type SubmittedRange = { range: Range; preview: Range | null; saved: boolean; intent?: RangeIntent };

// A tile owns draft handles and coalesced writes. Playback continues to consume
// canonical saved settings; this owner has no access to the audio resource.
// Submitted command bounds remain authoritative until canonical acknowledgement.
export function useSoundRange({ soundId, settings, duration, readPlayhead, save }: {
  soundId: string;
  settings: SoundPlaybackSettings;
  duration: number;
  readPlayhead: () => number;
  save: SaveSoundSettings;
}) {
  const [draft, setDraft] = useState<Range | null>(null);
  const draftRef = useRef<Range | null>(null);
  const pending = useRef<SubmittedRange | null>(null);
  const submitted = useRef<SubmittedRange | null>(null);
  const saving = useRef(false);
  const alive = useRef(true);
  const latest = useRef({ settings, duration, readPlayhead, save });
  latest.current = { settings, duration, readPlayhead, save };

  const retire = (request: SubmittedRange) => {
    if (submitted.current !== request) return;
    submitted.current = null;
    // An acknowledgement must not erase a newer pointer-only preview.
    if (draftRef.current === request.preview) {
      draftRef.current = null;
      if (alive.current) setDraft(null);
    }
  };
  const acknowledge = () => {
    const request = submitted.current;
    const saved = latest.current.settings;
    if (request?.saved && request.intent?.startTime === saved.startTime && request.intent.endTime === saved.endTime) retire(request);
  };
  useLayoutEffect(acknowledge, [settings.startTime, settings.endTime]);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; pending.current = null; submitted.current = null; draftRef.current = null; };
  }, []);

  const commit = async (range: Range) => {
    if (!alive.current) return;
    const request = { range, preview: draftRef.current, saved: false };
    submitted.current = request;
    pending.current = request;
    if (saving.current) return;
    saving.current = true;
    let continuation = false;
    try {
      while (pending.current && alive.current) {
        const request = pending.current;
        const [from, to] = request.range;
        pending.current = null;
        const { duration: length, save: write } = latest.current;
        request.intent = { startTime: from, endTime: length > 0 && to >= length - 0.005 ? null : to };
        const result = await (continuation ? write(soundId, request.intent, { preserveError: true }) : write(soundId, request.intent));
        continuation = true;
        // A removed sound or ended library lifetime cannot accept follow-up work.
        // Failed writes are reported by the library owner, never retried here.
        if (result === "discarded") {
          pending.current = null;
          if (submitted.current) retire(submitted.current);
          break;
        }
        if (result === "failed") retire(request);
        else { request.saved = true; acknowledge(); }
      }
    } finally {
      saving.current = false;
    }
  };

  const markIn = () => {
    const { settings: saved, duration: length, readPlayhead: playhead } = latest.current;
    const end = submitted.current?.range[1] ?? saved.endTime ?? length;
    if (length <= 0 || end - MIN_RANGE < 0) return;
    void commit([round(Math.min(Math.max(0, playhead()), end - MIN_RANGE)), end]);
  };
  const markOut = () => {
    const { settings: saved, duration: length, readPlayhead: playhead } = latest.current;
    if (length <= 0) return;
    const start = submitted.current?.range[0] ?? saved.startTime;
    void commit([start, round(Math.min(length, Math.max(playhead(), start + MIN_RANGE)))]);
  };
  const reset = () => { void commit([0, latest.current.duration]); };
  const cancelPreview = () => {
    draftRef.current = null;
    if (alive.current) setDraft(null);
  };
  const trackMax = duration > 0 ? duration : Math.max(1, settings.endTime ?? 1);
  const savedEnd = Math.min(trackMax, settings.endTime ?? trackMax);
  const range: Range = draft ?? [Math.min(settings.startTime, Math.max(0, savedEnd - MIN_RANGE)), savedEnd];

  return {
    range, trackMax, canEdit: duration > 0,
    trimmed: range[0] > 0 || (duration > 0 && range[1] < duration - 0.005),
    change: (range: Range) => { draftRef.current = range; setDraft(range); }, cancelPreview, commit, markIn, markOut, reset,
  };
}
