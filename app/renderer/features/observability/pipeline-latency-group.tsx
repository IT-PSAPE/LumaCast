import type { NdiSenderPerformanceDiagnostics } from '@lumacast/protocol';
import { PipelineStat } from './pipeline-stat';

export function PipelineLatencyGroup({ pipeline }: { pipeline: NdiSenderPerformanceDiagnostics['pipeline'] }) {
  // Captures the sender-side path for accepted attempts: from the first
  // renderer-side state change to the native send call returning. Stage
  // breakdown helps localize which hop dominates when headline latency rises.
  return (
    <div className="mt-3 border-t border-secondary/40 pt-2">
      <div className="pb-1 text-xs font-semibold uppercase tracking-wide text-tertiary">
        Pipeline latency (ms · p50 / p95 · last)
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-secondary md:grid-cols-3">
        <PipelineStat label="Frame age at native send" stats={pipeline.frameAgeAtNativeSend} warnP95={50} />
        <PipelineStat label="Signature → native send" stats={pipeline.signatureToNativeSend} warnP95={66} />
        <PipelineStat label="Activate → native send" stats={pipeline.activateToNativeSend} warnP95={66} />
        <PipelineStat label="Take → native send" stats={pipeline.takeToNativeSend} warnP95={66} />
        <PipelineStat label="Capture → renderer send" stats={pipeline.captureToRendererSend} warnP95={20} />
        <PipelineStat label="Renderer → main IPC" stats={pipeline.rendererToMainIpc} warnP95={10} />
        <PipelineStat label="Main handler" stats={pipeline.mainHandler} warnP95={5} />
        <PipelineStat label="Main → host IPC" stats={pipeline.mainToHostIpc} warnP95={10} />
        <PipelineStat label="Host → native send return" stats={pipeline.hostToNative} warnP95={20} />
        <PipelineStat label="Sequential take → native send" stats={pipeline.takeReasonToNativeSend.sequential} warnP95={66} />
        <PipelineStat label="Jump take → native send" stats={pipeline.takeReasonToNativeSend.jump} warnP95={66} />
        <PipelineStat label="Cross-item take → native send" stats={pipeline.takeReasonToNativeSend.crossItem} warnP95={66} />
        <PipelineStat label="Macro take → native send" stats={pipeline.takeReasonToNativeSend.macro} warnP95={66} />
      </div>
      <div className="pt-2 text-xs text-tertiary">
        Per-reason rows reflect authored take reasons. Macro is currently unauthored because there is no macro-driven slide-take telemetry path today.
      </div>
    </div>
  );
}
