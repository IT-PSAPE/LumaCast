import { useState } from 'react';
import { ReacstButton } from '@renderer/components/controls/button';
import { useConfirm } from '@renderer/components/overlays/confirm-dialog';

export function MediaLibrarySettingsPanel() {
  const confirm = useConfirm();
  const [inFlight, setInFlight] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleReclaim() {
    const confirmed = await confirm({
      title: 'Reclaim unused media?',
      description: 'Media files no longer used by any item, theme, overlay or stage are deleted from the library. Undoing back past a deletion will not find them again.',
      confirmLabel: 'Reclaim',
      destructive: true,
    });
    if (!confirmed) return;

    setInFlight(true);
    try {
      const { removedFiles, freedBytes } = await window.castApi.reclaimMediaLibrary();
      setResult(removedFiles === 0
        ? 'Nothing to reclaim'
        : `Removed ${removedFiles} file${removedFiles === 1 ? '' : 's'}, freed ${formatBytes(freedBytes)}`);
    } catch (error) {
      console.error('[MediaLibrarySettingsPanel] Failed to reclaim unused media:', error);
      setResult('Could not reclaim unused media.');
    } finally {
      setInFlight(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 border-b border-primary pb-5 last:border-b-0 last:pb-0">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-primary">Media library</h2>
        <ReacstButton onClick={() => void handleReclaim()} disabled={inFlight}>
          {inFlight ? 'Reclaiming…' : 'Reclaim unused media'}
        </ReacstButton>
      </header>
      {result ? <p className="text-xs text-secondary">{result}</p> : null}
    </section>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
