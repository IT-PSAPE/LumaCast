import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { NdiPipelineLatencyDiagnostics, NdiPipelineStageStats, NdiTakeReason } from '@lumacast/protocol';
import { PipelineLatencyGroup } from './pipeline-latency-group';

const emptyStage = (): NdiPipelineStageStats => ({ p50: 0, p95: 0, lastMs: 0, count: 0 });

function createPipeline(): NdiPipelineLatencyDiagnostics {
  const takeReasons = Object.fromEntries(
    ['sequential', 'jump', 'crossItem', 'macro'].map((reason) => [reason, emptyStage()]),
  ) as Record<NdiTakeReason, NdiPipelineStageStats>;
  return {
    frameAgeAtNativeSend: emptyStage(),
    signatureToNativeSend: emptyStage(),
    activateToNativeSend: emptyStage(),
    takeToNativeSend: emptyStage(),
    takeReasonToNativeSend: takeReasons,
    captureToRendererSend: emptyStage(),
    rendererToMainIpc: emptyStage(),
    mainHandler: emptyStage(),
    mainToHostIpc: emptyStage(),
    directWorkerToHostIpc: { p50: 3, p95: 7, lastMs: 5, count: 2 },
    hostToNative: emptyStage(),
  };
}

describe('PipelineLatencyGroup', () => {
  afterEach(cleanup);

  it('shows direct worker-to-host transport latency separately', () => {
    render(<PipelineLatencyGroup pipeline={createPipeline()} />);

    expect(screen.getByText('Worker → host direct IPC')).not.toBeNull();
    expect(screen.getByText('3.0 / 7.0 · 5.0')).not.toBeNull();
  });
});
