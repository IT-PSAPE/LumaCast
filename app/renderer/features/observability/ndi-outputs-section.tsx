import { useNdiDiagnostics } from '../../contexts/app-context';
import { SectionShell } from './section-shell';
import { SenderCard } from './sender-card';

export function NdiOutputsSection() {
  const diagnostics = useNdiDiagnostics();
  if (!diagnostics) {
    return <SectionShell title="NDI outputs"><p className="text-sm text-tertiary">Waiting for NDI diagnostics.</p></SectionShell>;
  }
  return (
    <SectionShell title="NDI outputs" subtitle={`Runtime: ${diagnostics.runtimeLoaded ? (diagnostics.runtimePath ?? 'Loaded') : 'Not loaded'} · Source: ${diagnostics.sourceStatus}`}>
      <div className="flex flex-col gap-4">
        <SenderCard name="audience" sender={diagnostics.senders.audience} availabilityDrops={diagnostics.availabilityDrops.audience} />
        <SenderCard name="stage" sender={diagnostics.senders.stage} availabilityDrops={diagnostics.availabilityDrops.stage} />
        {diagnostics.lastError ? (
          <div className="rounded border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-300">{diagnostics.lastError}</div>
        ) : null}
      </div>
    </SectionShell>
  );
}
