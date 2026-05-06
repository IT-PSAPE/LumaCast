import { useCallback, useEffect, useState } from 'react';
import type { NdiActiveSenderDiagnostics, NdiOutputName } from '@core/types';
import { FieldCheckbox as CheckboxField, FieldInput } from '../../components/form/field';
import { useNdi } from '../../contexts/app-context';
import { useImageCacheStats } from '../canvas/use-image-cache-stats';

const OUTPUT_TITLES: Record<NdiOutputName, string> = {
  audience: 'Audience NDI',
  stage: 'Stage NDI',
};

const OUTPUT_DESCRIPTIONS: Record<NdiOutputName, string | null> = {
  audience: null,
  stage: 'Output dedicated to a presenter / on-stage monitor. Renders the active stage layout selected from the Show screen.',
};

export function OutputSettingsPanel() {
  const { state: { diagnostics } } = useNdi();
  const imageCacheStats = useImageCacheStats();

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 border-b border-primary pb-5">
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-primary">Audience screen</h2>
        </header>
        <p className="text-sm text-tertiary">System display output is not wired yet.</p>
      </section>

      <OutputControls name="audience" />
      <OutputControls name="stage" />

      <section className="flex flex-col gap-3">
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-primary">NDI diagnostics</h2>
        </header>
        {diagnostics ? (
          <div className="flex flex-col gap-1 text-sm text-secondary">
            <div>Runtime: {diagnostics.runtimeLoaded ? (diagnostics.runtimePath ?? 'Loaded') : 'Not loaded'}</div>
            <div>Status: {diagnostics.sourceStatus}</div>
            <div>Audience config: {diagnostics.outputConfigs.audience.senderName}</div>
            <div>Stage config: {diagnostics.outputConfigs.stage.senderName}</div>
            <SenderDiagnosticsBlock name="audience" diagnostics={diagnostics.senders.audience} />
            <SenderDiagnosticsBlock name="stage" diagnostics={diagnostics.senders.stage} />
            {diagnostics.lastError ? (
              <div className="text-red-400">Error: {diagnostics.lastError}</div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-tertiary">Waiting for NDI diagnostics.</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-primary">Image cache</h2>
        </header>
        <div className="flex flex-col gap-1 text-sm text-secondary">
          <div>Entries: {imageCacheStats.entryCount}</div>
          <div>Estimated memory: {formatBytes(imageCacheStats.totalEstimatedBytes)}</div>
          <div>Loaded: {imageCacheStats.loadedCount}</div>
          <div>Loading: {imageCacheStats.loadingCount}</div>
          <div>Errors: {imageCacheStats.errorCount}</div>
        </div>
      </section>
    </div>
  );
}

function SenderDiagnosticsBlock({ name, diagnostics }: { name: NdiOutputName; diagnostics: NdiActiveSenderDiagnostics | null }) {
  if (!diagnostics) {
    return <div>{OUTPUT_TITLES[name]} sender: inactive</div>;
  }

  const performance = diagnostics.performance;
  return (
    <>
      <div>
        {OUTPUT_TITLES[name]} sender: {diagnostics.senderName} ({diagnostics.width}x{diagnostics.height})
        {' '}· Async send: {diagnostics.asyncVideoSend ? 'on' : 'off'}
        {' '}· Connections: {diagnostics.connectionCount ?? 'unknown'}
      </div>
      <div>{OUTPUT_TITLES[name]} frames captured: {performance.framesCaptured}</div>
      <div>{OUTPUT_TITLES[name]} frames sent: {performance.framesSent}</div>
      <div>{OUTPUT_TITLES[name]} frames replayed: {performance.framesReplayed}</div>
      <div>{OUTPUT_TITLES[name]} frames skipped with no connections: {performance.framesSkippedNoConnections}</div>
      <div>{OUTPUT_TITLES[name]} skipped captures: {performance.skippedCaptures}</div>
      <div>{OUTPUT_TITLES[name]} frames dropped (backpressure): {performance.framesDroppedBackpressure}</div>
      <div>{OUTPUT_TITLES[name]} bytes received: {formatBytes(performance.bytesReceived)}</div>
      <div>{OUTPUT_TITLES[name]} cache copy bytes: {formatBytes(performance.cacheCopyBytes)}</div>
      <div>{OUTPUT_TITLES[name]} average capture time: {performance.avgCaptureDurationMs.toFixed(2)} ms</div>
      <div>{OUTPUT_TITLES[name]} average readback time: {performance.avgReadbackDurationMs.toFixed(2)} ms</div>
      <div>{OUTPUT_TITLES[name]} average send time: {performance.avgSendDurationMs.toFixed(2)} ms</div>
      <div>{OUTPUT_TITLES[name]} rejected frames: {performance.framesRejected}</div>
      <div>
        {OUTPUT_TITLES[name]} audio: received {diagnostics.audio.audioFramesReceived} ·
        sent {diagnostics.audio.audioFramesSent} ·
        samples {diagnostics.audio.audioSamplesSent} ·
        {diagnostics.audio.lastSampleRate > 0
          ? ` ${diagnostics.audio.lastSampleRate} Hz × ${diagnostics.audio.lastChannels}ch`
          : ' inactive'}
        {diagnostics.audio.audioFramesRejected > 0
          ? ` · rejected ${diagnostics.audio.audioFramesRejected}`
          : ''}
      </div>
    </>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

// Per-output controls block. Rendered once per `NdiOutputName` so audience and
// stage senders are configured side-by-side with identical UX.
function OutputControls({ name }: { name: NdiOutputName }) {
  const { state: { outputState, outputConfigs }, actions: { setOutputEnabled, updateOutputConfig } } = useNdi();
  const config = outputConfigs[name];
  const enabled = outputState[name];
  const [senderNameDraft, setSenderNameDraft] = useState(config.senderName);

  // Re-sync the input draft when the persisted name changes from elsewhere
  // (e.g. another window committing a rename).
  useEffect(() => {
    setSenderNameDraft(config.senderName);
  }, [config.senderName]);

  function handleSetOutputEnabled(value: boolean) {
    setOutputEnabled(name, value);
  }

  function handleCommitSenderName() {
    const trimmed = senderNameDraft.trim();
    if (trimmed && trimmed !== config.senderName) {
      updateOutputConfig(name, { senderName: trimmed });
    } else if (!trimmed) {
      setSenderNameDraft(config.senderName);
    }
  }

  const handleSetWithAlpha = useCallback((withAlpha: boolean) => {
    updateOutputConfig(name, { withAlpha });
  }, [name, updateOutputConfig]);

  const description = OUTPUT_DESCRIPTIONS[name];

  return (
    <section className="flex flex-col gap-3 border-b border-primary pb-5">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-primary">{OUTPUT_TITLES[name]}</h2>
      </header>
      {description ? <p className="text-sm text-tertiary">{description}</p> : null}
      <CheckboxField checked={enabled} label="Enabled" onChange={handleSetOutputEnabled} />
      <div className="flex flex-col gap-3">
        <FieldInput label="Sender name" value={senderNameDraft} onChange={setSenderNameDraft} onBlur={handleCommitSenderName} wide />
      </div>
      <CheckboxField checked={config.withAlpha} label="Include alpha channel" onChange={handleSetWithAlpha} />
      <p className="text-sm text-tertiary">
        Leave alpha off for normal playback. In NDI Studio Monitor, also disable
        &quot;Show the NDI source&apos;s Alpha Channel&quot; unless you intentionally want to view the matte.
      </p>
    </section>
  );
}
