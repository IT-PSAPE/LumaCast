import { useMetricsStore } from './metrics-store';
import { SectionShell } from './section-shell';
import { Stat } from './stat';
import { formatNumber } from './observability-format';

export function AudioHealthSection() {
  const audio = useMetricsStore((s) => s.audioHealth);
  return (
    <SectionShell title="Audio health" subtitle="Sampled from the same AudioContext that feeds NDI audio.">
      {!audio ? (
        <p className="text-sm text-tertiary">Audio capture not initialized — start playing audio or video to wake it up.</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-secondary md:grid-cols-4">
          <Stat label="Context" value={audio.contextState ?? 'n/a'} highlight={audio.contextState !== 'running'} />
          <Stat label="Sample rate" value={`${audio.sampleRate} Hz`} />
          <Stat label="Base latency" value={`${audio.baseLatencyMs.toFixed(1)} ms`} />
          <Stat label="Output latency" value={`${audio.outputLatencyMs.toFixed(1)} ms`} />
          <Stat label="Peak" value={audio.peakLevel.toFixed(3)} highlight={audio.peakLevel >= 0.99} />
          <Stat label="RMS" value={audio.rmsLevel.toFixed(3)} />
          <Stat label="Clipping" value={audio.clippingDetected ? 'yes' : 'no'} highlight={audio.clippingDetected} />
          <Stat label="Underruns" value={formatNumber(audio.underrunCount)} highlight={audio.underrunCount > 0} />
        </div>
      )}
    </SectionShell>
  );
}
