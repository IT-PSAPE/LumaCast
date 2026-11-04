import { useEffect, useMemo, useState } from 'react';
import { Pause, Play, RotateCcw, Square } from 'lucide-react';
import { ReacstButton, Select, Toolbar } from '@lumacast/ui';
import { runMediaPlaybackCommand, type MediaPlaybackCommand } from './media-playback';
import type { RuntimeSource } from './source-runtime';
import type { SourceStatus } from './source-availability';

interface MediaControlsProps {
  sources: readonly RuntimeSource[];
  programSourceIds: ReadonlySet<string>;
  previewSourceIds: ReadonlySet<string>;
  elements: ReadonlyMap<string, HTMLMediaElement>;
  playbackStates: Readonly<Record<string, { paused: boolean; ended: boolean }>>;
  resourceStatuses: Readonly<Record<string, SourceStatus>>;
  onError: (message: string) => void;
}

export function MediaControls({ sources, programSourceIds, previewSourceIds, elements, playbackStates, resourceStatuses, onError }: MediaControlsProps) {
  const [targetId, setTargetId] = useState<string | null>(null);
  const candidates = useMemo(() => {
    const media = sources.filter((source) => source.kind === 'media' && (source.mediaKind === 'audio' || source.mediaKind === 'video'));
    return [
      ...media.filter((source) => programSourceIds.has(source.id)),
      ...media.filter((source) => previewSourceIds.has(source.id) && !programSourceIds.has(source.id)),
    ];
  }, [sources, programSourceIds, previewSourceIds]);
  const target = candidates.find((source) => source.id === targetId) ?? candidates[0];
  const resolvedId = target?.id ?? null;
  useEffect(() => setTargetId(resolvedId), [resolvedId]);
  if (!target) return null;

  const inProgram = programSourceIds.has(target.id);
  const playback = playbackStates[target.id];
  const disabled = !inProgram || !elements.has(target.id) || resourceStatuses[target.id]?.state !== 'ready';
  const paused = playback?.paused !== false || playback.ended;
  const control = (command: MediaPlaybackCommand) => {
    const element = elements.get(target.id);
    if (!disabled && element) void runMediaPlaybackCommand(element, command, onError);
  };

  return <Toolbar.Group label="Media playback" title={target.name} className="min-w-0">
    <Select size="sm" className="w-44" label="Media source" labelPlacement="hidden" value={target.id} onValueChange={setTargetId}
      options={candidates.map((source) => ({ value: source.id, label: `${source.name} · ${programSourceIds.has(source.id) ? 'Program' : 'Preview'}` }))} />
    <ReacstButton.Icon variant="ghost" size="sm" label={paused ? 'Play media' : 'Pause media'} disabled={disabled} onClick={() => control('toggle')}>
      {paused ? <Play /> : <Pause />}
    </ReacstButton.Icon>
    <ReacstButton.Icon variant="ghost" size="sm" label="Restart media" disabled={disabled} onClick={() => control('restart')}><RotateCcw /></ReacstButton.Icon>
    <ReacstButton.Icon variant="ghost" size="sm" label="Stop media" disabled={disabled} onClick={() => control('stop')}><Square /></ReacstButton.Icon>
    {!inProgram && <span className="shrink-0 whitespace-nowrap text-xs text-secondary">Starts in Program</span>}
  </Toolbar.Group>;
}
