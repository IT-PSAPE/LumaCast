import { useEffect, useRef, useState } from 'react';
import { Modal, ReacstButton, Select, TextField } from '@lumacast/ui';
import type { AudioTrack, StreamProject } from '../../shared/desktop-api';
import type { NdiSource, StreamNdiAPI } from '../../shared/ndi';
import { ndiOutputFrameRate, ndiOutputSize } from '../ndi-media';

export function NdiDialog({ api, mode, onClose, onSelect, sending, starting, stopping = false, onStart, onStop, output }: {
  api?: StreamNdiAPI;
  mode: 'input' | 'output';
  onClose: () => void;
  onSelect: (source: NdiSource) => void;
  sending: boolean;
  starting: boolean;
  stopping?: boolean;
  onStart: (name: string, track: AudioTrack) => Promise<void>;
  onStop: () => Promise<void>;
  output?: StreamProject['output'];
}) {
  const [sources, setSources] = useState<NdiSource[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('LumaStream Program');
  const [track, setTrack] = useState<AudioTrack>(1);
  const generation = useRef(0);
  const discoveryPending = useRef(false);
  const discover = async () => {
    if (!api || discoveryPending.current) return;
    discoveryPending.current = true;
    const current = ++generation.current;
    setBusy(true); setError('');
    try {
      const found = await api.discover();
      if (current === generation.current) setSources(found);
    } catch (e) {
      if (current === generation.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (current === generation.current) {
        discoveryPending.current = false;
        setBusy(false);
      }
    }
  };
  useEffect(() => {
    if (mode === 'input') void discover();
    return () => { generation.current++; discoveryPending.current = false; };
  }, [api, mode]);
  const size = output ? ndiOutputSize(output.width, output.height) : null;
  return <Modal open onClose={onClose} title={mode === 'input' ? 'Add NDI source' : 'NDI Program output'} size="sm">
    <div className="flex min-h-0 flex-col gap-3 overflow-auto p-4">
      {!api ? <p role="alert">NDI is unavailable in this build.</p> : mode === 'input' ? <>
        <ReacstButton size="sm" disabled={busy} onClick={() => void discover()}>{busy ? 'Finding sources…' : 'Refresh sources'}</ReacstButton>
        {!busy && !error && sources.length === 0 && <p>No NDI sources found on this network.</p>}
        {sources.map((source) => <ReacstButton key={`${source.name}:${source.urlAddress ?? ''}`} onClick={() => onSelect(source)}>{source.name}</ReacstButton>)}
      </> : <>
        <TextField label="NDI name" value={name} onValueChange={setName} disabled={sending || starting || stopping} />
        <Select label="Audio track" value={track} onValueChange={setTrack} disabled={sending || starting || stopping}
          options={([1, 2, 3, 4, 5, 6] as AudioTrack[]).map((value) => ({ value, label: `Track ${value}` }))} />
        {size && output && <p>{size.width} × {size.height} · {ndiOutputFrameRate(output.frameRate)} FPS · Stereo</p>}
        <p role="status">{stopping ? 'Stopping NDI…' : sending ? 'Broadcasting Program over NDI' : starting ? 'Starting NDI…' : 'NDI output stopped'}</p>
        {sending || starting || stopping
          ? <ReacstButton disabled={stopping} onClick={() => void onStop()}>Stop NDI output</ReacstButton>
          : <ReacstButton disabled={!name.trim() || name.length > 128 || !output} onClick={() => void onStart(name, track)}>Start NDI output</ReacstButton>}
      </>}
      {error && <p role="alert">{error}</p>}
    </div>
  </Modal>;
}
