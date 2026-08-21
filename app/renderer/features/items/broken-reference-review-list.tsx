import type { BundleBrokenReferenceAction, BundleInspection } from '@lumacast/protocol';
import { BrokenReferenceRow } from './broken-reference-row';

interface BrokenReferenceReviewListProps {
  inspection: BundleInspection;
  decisionMap: ReadonlyMap<string, { action: BundleBrokenReferenceAction; replacementPath: string | null }>;
  onActionChange: (source: string, action: BundleBrokenReferenceAction) => void;
  onChooseReplacement: (source: string) => Promise<void>;
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
