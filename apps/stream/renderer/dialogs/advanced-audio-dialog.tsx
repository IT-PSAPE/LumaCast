import { useEffect } from 'react';
import type { RefObject } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { Checkbox, EmptyState, Modal, NumberField, ReacstButton, Select, Slider } from '@lumacast/ui';
import { AUDIO_TRACKS, type AudioMonitoring, type AudioTrack, type StreamSource } from '../../shared/desktop-api';
import './advanced-audio-dialog.css';

const MONITORING_OPTIONS: ReadonlyArray<{ value: AudioMonitoring; label: string }> = [
  { value: 'off', label: 'Monitor Off' },
  { value: 'monitor-only', label: 'Monitor Only' },
  { value: 'monitor-and-output', label: 'Monitor and Output' },
];

/** Balance values within this many percentage points of centre snap to dead centre. */
const BALANCE_CENTER_SNAP = 3;

type AudioPatch = Partial<Pick<StreamSource, 'volume' | 'muted' | 'balance' | 'audioMonitoring' | 'audioTracks'>>;

export interface AdvancedAudioDialogProps {
  sources: StreamSource[];
  onUpdate: (sourceId: string, patch: AudioPatch) => void;
  onClose: () => void;
  /** Control to return focus to on close. See the effect below for why this is needed. */
  openerRef?: RefObject<HTMLElement | null>;
}

export function AdvancedAudioDialog({ sources, onUpdate, onClose, openerRef }: AdvancedAudioDialogProps) {
  // This component has no `open` prop — the caller mounts it only while
  // visible — so Base UI's own close-focus restoration (tied to an open→false
  // transition on a persistently-mounted Dialog.Root) never runs here.
  // Restore focus to whatever opened the dialog ourselves, on unmount.
  useEffect(() => () => openerRef?.current?.focus(), [openerRef]);

  return (
    <Modal open onClose={onClose} title="Advanced Audio Properties">
      {sources.length === 0 ? (
        <EmptyState.Root>
          <EmptyState.Title>No audio sources</EmptyState.Title>
        </EmptyState.Root>
      ) : (
        <div className="advanced-audio-table-wrap">
          <table className="advanced-audio-table">
            <thead>
              <tr>
                <th scope="col" className="advanced-audio-mute-col">
                  <span className="sr-only">Mute</span>
                </th>
                <th scope="col">Name</th>
                <th scope="col">Volume</th>
                <th scope="col">Balance</th>
                <th scope="col">Audio Monitoring</th>
                <th scope="col" colSpan={AUDIO_TRACKS.length}>Tracks</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => (
                <AdvancedAudioRow key={source.id} source={source} onUpdate={onUpdate} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function AdvancedAudioRow({ source, onUpdate }: { source: StreamSource; onUpdate: (sourceId: string, patch: AudioPatch) => void }) {
  const volumePercent = Math.round((source.volume ?? 1) * 100);
  const balancePercent = Math.round((source.balance ?? 0) * 100);
  const tracks = source.audioTracks ?? [1];

  const setVolumePercent = (raw: number) => {
    if (!Number.isFinite(raw)) return;
    const clamped = Math.max(0, Math.min(200, Math.round(raw)));
    onUpdate(source.id, { volume: clamped / 100 });
  };

  const setBalancePercent = (raw: number) => {
    if (!Number.isFinite(raw)) return;
    const clamped = Math.max(-100, Math.min(100, Math.round(raw)));
    const snapped = Math.abs(clamped) <= BALANCE_CENTER_SNAP ? 0 : clamped;
    onUpdate(source.id, { balance: snapped / 100 });
  };

  const toggleTrack = (track: AudioTrack, checked: boolean) => {
    const next = checked
      ? [...new Set([...tracks, track])]
      : tracks.filter((value) => value !== track);
    onUpdate(source.id, { audioTracks: next.sort((a, b) => a - b) });
  };

  return (
    <tr>
      <td className="advanced-audio-mute-col">
        <ReacstButton.Icon
          variant={source.muted ? 'danger' : 'ghost'}
          active={source.muted}
          label={source.muted ? `Unmute ${source.name}` : `Mute ${source.name}`}
          onClick={() => onUpdate(source.id, { muted: !source.muted })}
        >
          {source.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </ReacstButton.Icon>
      </td>
      <td className="advanced-audio-name" title={source.name}>{source.name}</td>
      <td>
        <NumberField
          size="sm"
          className="w-[72px]"
          label={`${source.name} volume`}
          labelPlacement="hidden"
          suffix="%"
          min={0}
          max={200}
          step={1}
          precision={0}
          value={volumePercent}
          onValueChange={setVolumePercent}
        />
      </td>
      <td>
        <Slider
          size="sm"
          className="w-[110px]"
          label={`${source.name} balance`}
          labelPlacement="hidden"
          min={-100}
          max={100}
          step={1}
          fillFrom={0}
          value={balancePercent}
          onValueChange={setBalancePercent}
        />
      </td>
      <td>
        <Select
          size="sm"
          label={`${source.name} audio monitoring`}
          value={source.audioMonitoring ?? 'off'}
          onValueChange={(value) => onUpdate(source.id, { audioMonitoring: value })}
          options={MONITORING_OPTIONS}
        />
      </td>
      {AUDIO_TRACKS.map((track) => (
        <td key={track} className="advanced-audio-track-col">
          <Checkbox
            label={String(track)}
            checked={tracks.includes(track)}
            onCheckedChange={(checked) => toggleTrack(track, checked)}
          />
        </td>
      ))}
    </tr>
  );
}
