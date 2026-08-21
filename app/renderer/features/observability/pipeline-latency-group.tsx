import type { NdiSenderPerformanceDiagnostics } from '@lumacast/protocol';
import { PipelineStat } from './pipeline-stat';

export function PipelineLatencyGroup({ pipeline }: { pipeline: NdiSenderPerformanceDiagnostics['pipeline'] }) {
  // Captures the full sender-side pipeline: from the moment a state change
  // is observed in the renderer to the moment bits leave the native NDI
  // send call. Stage breakdown helps localize which IPC hop or process is
  // dominating when the headline numbers spike.
  return (
    <div className="mt-3 border-t border-secondary/40 pt-2">
      <div className="pb-1 text-xs font-semibold uppercase tracking-wide text-tertiary">
        Pipeline latency (ms · p50 / p95 · last)
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-secondary md:grid-cols-3">
        <PipelineStat label="Frame age at wire" stats={pipeline.frameAgeAtWire} warnP95={50} />
        <PipelineStat label="Signature → wire" stats={pipeline.signatureToWire} warnP95={66} />
        <PipelineStat label="Capture → renderer send" stats={pipeline.captureToRendererSend} warnP95={20} />
        <PipelineStat label="Renderer → main IPC" stats={pipeline.rendererToMainIpc} warnP95={10} />
        <PipelineStat label="Main handler" stats={pipeline.mainHandler} warnP95={5} />
        <PipelineStat label="Main → host IPC" stats={pipeline.mainToHostIpc} warnP95={10} />
        <PipelineStat label="Host → native send" stats={pipeline.hostToNative} warnP95={20} />
      </div>
    </div>
  );
}
