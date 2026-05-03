import type {
  BrokenDeckBundleReference,
  DeckBundleBrokenReferenceAction,
  DeckBundleInspection,
} from '@core/types';
import { SegmentedControl } from '@renderer/components/controls/segmented-control';
import { ReacstButton } from '@renderer/components/controls/button';

interface BrokenReferenceReviewListProps {
  inspection: DeckBundleInspection;
  decisionMap: ReadonlyMap<string, { action: DeckBundleBrokenReferenceAction; replacementPath: string | null }>;
  onActionChange: (source: string, action: DeckBundleBrokenReferenceAction) => void;
  onChooseReplacement: (source: string) => Promise<void>;
}

interface BrokenReferenceRowProps {
  reference: BrokenDeckBundleReference;
  action: DeckBundleBrokenReferenceAction | null;
  replacementPath: string | null;
  onActionChange: (source: string, action: DeckBundleBrokenReferenceAction) => void;
  onChooseReplacement: (source: string) => Promise<void>;
}

function BrokenReferenceRow({
  reference,
  action,
  replacementPath,
  onActionChange,
  onChooseReplacement,
}: BrokenReferenceRowProps) {
  const ownerSummary = [...reference.itemTitles, ...reference.themeNames].join(', ');

  function handleValueChange(value: string | string[]) {
    if (Array.isArray(value)) return;
    if (value === 'replace' || value === 'remove' || value === 'leave') {
      onActionChange(reference.source, value);
    }
  }

  async function handleChooseReplacement() {
    await onChooseReplacement(reference.source);
  }

  return (
    <div className="flex flex-col gap-3 rounded border border-primary bg-tertiary/25 p-3">
      <div className="flex flex-col gap-1">
        <div className="text-sm font-medium text-primary">{reference.source}</div>
        <div className="text-xs text-tertiary">
          {reference.occurrenceCount} use{reference.occurrenceCount === 1 ? '' : 's'} in {ownerSummary || 'imported deck'}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl label={`Broken reference action for ${reference.source}`} value={action ?? ''} onValueChange={handleValueChange}>
          <SegmentedControl.Label value="replace">Replace</SegmentedControl.Label>
          <SegmentedControl.Label value="remove">Remove</SegmentedControl.Label>
          <SegmentedControl.Label value="leave">Leave Broken</SegmentedControl.Label>
        </SegmentedControl>

        {action === 'replace' ? (
          <ReacstButton variant="ghost" onClick={handleChooseReplacement}>
            {replacementPath ? 'Change File' : 'Choose File'}
          </ReacstButton>
        ) : null}
      </div>

      {action === 'replace' ? (
        <div className="text-xs text-tertiary">
          {replacementPath ?? 'No replacement file selected.'}
        </div>
      ) : null}
    </div>
  );
}

export function BrokenReferenceReviewList({
  inspection,
  decisionMap,
  onActionChange,
  onChooseReplacement,
}: BrokenReferenceReviewListProps) {
  const rows = inspection.brokenReferences.map((reference) => {
    const decision = decisionMap.get(reference.source);
    return (
      <BrokenReferenceRow
        key={reference.source}
        reference={reference}
        action={decision?.action ?? null}
        replacementPath={decision?.replacementPath ?? null}
        onActionChange={onActionChange}
        onChooseReplacement={onChooseReplacement}
      />
    );
  });

  return <div className="flex flex-col gap-3">{rows}</div>;
}
