import { useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { AudioLines, MoreHorizontal, Settings2, Volume2, VolumeX } from 'lucide-react';
import { EmptyState, PointContextMenu, ReacstButton, Slider, usePointContextMenu, type MenuEntry } from '@lumacast/ui';
import { sourceIcon } from '../source-ui';
import { DockTitle } from './dock-title';
import { AudioMeter } from '../audio-meter';
import { METER_FLOOR_DB, linearToDb, updatePeakHold, type PeakHoldState } from '../audio-meter-model';
import { AdvancedAudioDialog } from '../dialogs/advanced-audio-dialog';
import { buildMixerMenu, parseMixerLayout, MIXER_LAYOUT_STORAGE_KEY, type MixerLayout } from './mixer-menu';
import { AUDIO_TRACKS, type AudioMonitoring, type AudioTrack, type StreamSource } from '../../shared/desktop-api';
import './mixer-dock.css';

type AudioPatch = Partial<Pick<StreamSource, 'volume' | 'muted' | 'balance' | 'audioMonitoring' | 'audioTracks'>>;

export interface MixerDockProps {
  style?: CSSProperties;
  resizer?: ReactNode;
  onHide: () => void;
  /** No longer called by this dock — the title-row button now opens a mixer options menu instead of global settings. Kept so callers can pass their existing handler unchanged. */
  onOpenSettings: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  sources: StreamSource[];
  meterLevels: Record<string, number>;
  onUpdateSourceSettings: (sourceId: string, settings: Pick<StreamSource, 'volume' | 'muted'>) => void;
  /** Every audio-capable source in the project, for Advanced Audio Properties. Falls back to `sources` (active-scene only) when omitted. */
  allAudioSources?: StreamSource[];
  /** Preferred handler for any audio attribute change (volume, mute, balance, monitoring, tracks). When omitted, only volume/mute changes fall back to `onUpdateSourceSettings`; balance/monitoring/track changes are not applied. */
  onUpdateSourceAudio?: (sourceId: string, patch: AudioPatch) => void;
  /** Opens the source's properties/filters. When omitted, the per-channel menu's "Filters" item is left out. */
  onOpenSourceProperties?: (sourceId: string) => void;
  /** Hides the source from the mixer (not the scene). When omitted, the per-channel menu's "Hide" item is left out. */
  onHideSource?: (sourceId: string) => void;
}

const CHANNEL_MONITORING_OPTIONS: ReadonlyArray<{ value: AudioMonitoring; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'monitor-only', label: 'Monitor Only' },
  { value: 'monitor-and-output', label: 'Monitor and Output' },
];

function buildChannelMenu(source: StreamSource, handlers: {
  onOpenProperties?: () => void;
  onSetMonitoring: (monitoring: AudioMonitoring) => void;
  onToggleTrack: (track: AudioTrack) => void;
  onHide?: () => void;
}): MenuEntry[] {
  const monitoring = source.audioMonitoring ?? 'off';
  const tracks = source.audioTracks ?? [1];
  const entries: MenuEntry[] = [];

  if (handlers.onOpenProperties) {
    entries.push({ id: 'channel.filters', label: 'Filters', onSelect: handlers.onOpenProperties });
  }

  entries.push({
    id: 'channel.monitoring',
    label: 'Monitoring',
    children: CHANNEL_MONITORING_OPTIONS.map((option) => ({
      id: `channel.monitoring.${option.value}`,
      label: option.label,
      checked: monitoring === option.value,
      onSelect: () => handlers.onSetMonitoring(option.value),
    })),
  });

  entries.push({
    id: 'channel.tracks',
    label: 'Tracks',
    children: AUDIO_TRACKS.map((track) => ({
      id: `channel.tracks.${track}`,
      label: `Track ${track}`,
      checked: tracks.includes(track),
      onSelect: () => handlers.onToggleTrack(track),
    })),
  });

  if (handlers.onHide) {
    entries.push({ separator: true }, { id: 'channel.hide', label: 'Hide', onSelect: handlers.onHide });
  }

  return entries;
}

const formatPercent = (value: number): string => `${value}%`;

function readStoredLayout(): MixerLayout {
  try {
    return parseMixerLayout(window.localStorage.getItem(MIXER_LAYOUT_STORAGE_KEY));
  } catch {
    return 'horizontal';
  }
}

export function MixerDock({
  style,
  resizer,
  onHide,
  sources,
  meterLevels,
  onUpdateSourceSettings,
  allAudioSources,
  onUpdateSourceAudio,
  onOpenSourceProperties,
  onHideSource,
}: MixerDockProps) {
  const [layout, setLayout] = useState<MixerLayout>(readStoredLayout);
  const [advancedAudioOpen, setAdvancedAudioOpen] = useState(false);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const titleMenu = usePointContextMenu();
  const channelMenu = usePointContextMenu();
  const titleMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const peakHoldsRef = useRef<Record<string, PeakHoldState>>({});

  const meteredSources = sources.filter((source) => meterLevels[source.id] !== undefined);
  const audioSourcesForDialog = allAudioSources ?? sources;

  const updateAudio = (sourceId: string, patch: AudioPatch) => {
    if (onUpdateSourceAudio) {
      onUpdateSourceAudio(sourceId, patch);
      return;
    }
    if (patch.volume === undefined && patch.muted === undefined) return;
    const source = sources.find((item) => item.id === sourceId) ?? audioSourcesForDialog.find((item) => item.id === sourceId);
    if (!source) return;
    onUpdateSourceSettings(sourceId, { volume: patch.volume ?? source.volume, muted: patch.muted ?? source.muted });
  };

  const toggleLayout = () => {
    setLayout((previous) => {
      const next: MixerLayout = previous === 'horizontal' ? 'vertical' : 'horizontal';
      try { window.localStorage.setItem(MIXER_LAYOUT_STORAGE_KEY, next); } catch { /* ignore */ }
      return next;
    });
  };

  const openTitleMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    titleMenu.show({ clientX: rect.left, clientY: rect.bottom, preventDefault: () => event.preventDefault() });
  };

  const openChannelMenu = (event: ReactMouseEvent<HTMLButtonElement>, sourceId: string) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setActiveChannelId(sourceId);
    channelMenu.show({ clientX: rect.left, clientY: rect.bottom, preventDefault: () => event.preventDefault() });
  };

  const titleMenuEntries = buildMixerMenu({
    layout,
    onToggleLayout: toggleLayout,
    onOpenAdvancedAudio: () => setAdvancedAudioOpen(true),
  });

  const activeChannelSource = meteredSources.find((source) => source.id === activeChannelId) ?? null;
  const channelMenuEntries = activeChannelSource ? buildChannelMenu(activeChannelSource, {
    onOpenProperties: onOpenSourceProperties ? () => onOpenSourceProperties(activeChannelSource.id) : undefined,
    onSetMonitoring: (monitoring) => updateAudio(activeChannelSource.id, { audioMonitoring: monitoring }),
    onToggleTrack: (track) => {
      const tracks = activeChannelSource.audioTracks ?? [1];
      const next = tracks.includes(track) ? tracks.filter((value) => value !== track) : [...tracks, track].sort((a, b) => a - b);
      updateAudio(activeChannelSource.id, { audioTracks: next });
    },
    onHide: onHideSource ? () => onHideSource(activeChannelSource.id) : undefined,
  }) : [];

  // Frame-rate independent: safe to recompute every render (see `updatePeakHold`'s doc comment).
  const now = performance.now();
  const meteredSourceIds = new Set(meteredSources.map((source) => source.id));
  for (const id of Object.keys(peakHoldsRef.current)) {
    if (!meteredSourceIds.has(id)) delete peakHoldsRef.current[id];
  }
  for (const source of meteredSources) {
    const levelDb = linearToDb(meterLevels[source.id] ?? 0);
    peakHoldsRef.current[source.id] = updatePeakHold(peakHoldsRef.current[source.id] ?? null, levelDb, now);
  }

  return (
    <section className="dock mixer-dock" style={style}>
      {resizer}
      <DockTitle
        title="Audio Mixer"
        onHide={onHide}
        actions={(
          <button ref={titleMenuButtonRef} className="mini-icon" aria-label="Audio Mixer options" onClick={openTitleMenu}>
            <MoreHorizontal size={16} />
          </button>
        )}
      />
      {meteredSources.length === 0
        ? (
          <EmptyState.Root>
            <EmptyState.Icon><AudioLines size={20} /></EmptyState.Icon>
            <EmptyState.Description>Add a microphone or capture source with system audio.</EmptyState.Description>
          </EmptyState.Root>
        )
        : <div className={`mixer-strips mixer-strips--${layout}`}>{meteredSources.map((source) => {
          const peak = peakHoldsRef.current[source.id] ?? { peakDb: METER_FLOOR_DB, heldUntil: 0 };
          const levelDb = linearToDb(meterLevels[source.id] ?? 0);
          const volumePercent = Math.round(source.volume * 100);
          const displayedVolume = source.muted ? 0 : volumePercent;
          const dbLabel = source.muted ? 'Muted' : `${Math.round(linearToDb(source.volume) * 10) / 10} dB`;
          // Live while dragging; the parent applies and persists each step (no separate commit hook).
          const onVolumeChange = (value: number) => {
            updateAudio(source.id, { volume: value / 100, muted: false });
          };
          const muteButton = (
            <ReacstButton.Icon
              variant="ghost"
              size="xs"
              pressed={source.muted}
              label={`Mute ${source.name}`}
              tooltip={source.muted ? 'Unmute' : 'Mute'}
              onClick={() => updateAudio(source.id, { volume: source.volume, muted: !source.muted })}
            >
              {source.muted ? <VolumeX /> : <Volume2 />}
            </ReacstButton.Icon>
          );
          const gearButton = (
            <ReacstButton.Icon variant="ghost" size="xs" label={`${source.name} options`} onClick={(event) => openChannelMenu(event, source.id)}>
              <Settings2 />
            </ReacstButton.Icon>
          );

          if (layout === 'vertical') {
            return (
              <div className="mixer-strip mixer-strip--vertical" key={source.id}>
                <div className="mixer-strip-head">
                  <span className="mixer-strip-icon">{sourceIcon(source.kind, source.mediaKind)}</span>
                  <span className="mixer-strip-name" title={source.name}>{source.name}</span>
                </div>
                <span className="mixer-strip-db">{dbLabel}</span>
                <div className="mixer-strip-visual">
                  <AudioMeter orientation="vertical" levelDb={levelDb} peakDb={peak.peakDb} ticks label={`${source.name} level`} />
                  <div className="mixer-fader mixer-fader--vertical">
                    <Slider
                      orientation="vertical"
                      size="sm"
                      label={`${source.name} volume`}
                      labelPlacement="hidden"
                      min={0}
                      max={200}
                      value={displayedVolume}
                      onValueChange={onVolumeChange}
                    />
                  </div>
                </div>
                <div className="mixer-strip-controls">{muteButton}{gearButton}</div>
              </div>
            );
          }

          return (
            <div className="mixer-strip mixer-strip--horizontal" key={source.id}>
              <div className="mixer-strip-head">
                <span className="mixer-strip-icon">{sourceIcon(source.kind, source.mediaKind)}</span>
                <span className="mixer-strip-name" title={source.name}>{source.name}</span>
                <span className="mixer-strip-db">{dbLabel}</span>
              </div>
              <AudioMeter orientation="horizontal" levelDb={levelDb} peakDb={peak.peakDb} ticks label={`${source.name} level`} />
              <div className="mixer-strip-fader-row">
                <div className="mixer-fader">
                  <Slider
                    size="sm"
                    label={`${source.name} volume`}
                    labelPlacement="hidden"
                    min={0}
                    max={200}
                    value={displayedVolume}
                    onValueChange={onVolumeChange}
                    showValue
                    formatValue={formatPercent}
                  />
                </div>
                {muteButton}
                {gearButton}
              </div>
            </div>
          );
        })}</div>}
      <PointContextMenu
        open={titleMenu.open}
        position={titleMenu.position}
        entries={titleMenuEntries}
        label="Audio Mixer options"
        onClose={titleMenu.close}
      />
      <PointContextMenu
        open={channelMenu.open}
        position={channelMenu.position}
        entries={channelMenuEntries}
        label={activeChannelSource ? `${activeChannelSource.name} options` : 'Channel options'}
        onClose={channelMenu.close}
      />
      {advancedAudioOpen && (
        <AdvancedAudioDialog
          sources={audioSourcesForDialog}
          onUpdate={updateAudio}
          onClose={() => setAdvancedAudioOpen(false)}
          openerRef={titleMenuButtonRef}
        />
      )}
    </section>
  );
}
