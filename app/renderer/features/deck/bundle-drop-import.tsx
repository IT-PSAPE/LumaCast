import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  DeckBundleBrokenReferenceAction,
  DeckBundleBrokenReferenceDecision,
  DeckBundleInspection,
} from '@core/types';
import { ReacstButton } from '@renderer/components/controls/button';
import { Dialog } from '@renderer/components/overlays/dialog';
import { useCast } from '@renderer/contexts/app-context';
import { BrokenReferenceReviewList } from './broken-reference-review-list';

interface DecisionState {
  action: DeckBundleBrokenReferenceAction;
  replacementPath: string | null;
}

interface DropTarget {
  filePath: string;
  inspection: DeckBundleInspection | null;
  error: string | null;
}

export function BundleDropImport() {
  const { mutate, setStatusText } = useCast();
  const [isHoveringFile, setIsHoveringFile] = useState(false);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const [decisionMap, setDecisionMap] = useState<Map<string, DecisionState>>(new Map());
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let dragDepth = 0;

    function isFileDrag(event: DragEvent): boolean {
      return Array.from(event.dataTransfer?.types ?? []).includes('Files');
    }

    function handleDragEnter(event: DragEvent) {
      if (!isFileDrag(event)) return;
      dragDepth += 1;
      setIsHoveringFile(true);
    }

    function handleDragLeave(event: DragEvent) {
      if (!isFileDrag(event)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setIsHoveringFile(false);
    }

    function handleDragOver(event: DragEvent) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
    }

    async function handleDrop(event: DragEvent) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      dragDepth = 0;
      setIsHoveringFile(false);

      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      if (!file.name.toLowerCase().endsWith('.cst')) {
        setStatusText('Only .cst bundle files can be dropped.');
        return;
      }

      const filePath = window.castApi.getPathForFile(file);
      if (!filePath) {
        setStatusText('Could not resolve dropped file path.');
        return;
      }

      setTarget({ filePath, inspection: null, error: null });
      setDecisionMap(new Map());
      try {
        const inspection = await window.castApi.inspectImportBundle(filePath);
        setTarget({ filePath, inspection, error: null });
      } catch (error) {
        setTarget({ filePath, inspection: null, error: (error as Error).message });
      }
    }

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [setStatusText]);

  const close = useCallback(() => {
    setTarget(null);
    setDecisionMap(new Map());
    setImporting(false);
  }, []);

  const blockedReasons = useMemo(() => {
    const inspection = target?.inspection;
    if (!inspection) return [];
    return inspection.brokenReferences.flatMap((reference) => {
      const decision = decisionMap.get(reference.source);
      if (!decision) return [`Choose an action for ${reference.source}`];
      if (decision.action === 'replace' && !decision.replacementPath) {
        return [`Choose a replacement file for ${reference.source}`];
      }
      return [];
    });
  }, [decisionMap, target]);

  function handleActionChange(source: string, action: DeckBundleBrokenReferenceAction) {
    setDecisionMap((current) => {
      const next = new Map(current);
      const existing = next.get(source);
      next.set(source, {
        action,
        replacementPath: action === 'replace' ? existing?.replacementPath ?? null : null,
      });
      return next;
    });
  }

  async function handleChooseReplacement(source: string) {
    const filePath = await window.castApi.chooseImportReplacementMediaPath();
    if (!filePath) return;
    setDecisionMap((current) => {
      const next = new Map(current);
      next.set(source, { action: 'replace', replacementPath: filePath });
      return next;
    });
  }

  async function handleConfirm() {
    if (!target?.inspection || !target.filePath || importing || blockedReasons.length > 0) return;
    setImporting(true);
    try {
      const decisions: DeckBundleBrokenReferenceDecision[] = target.inspection.brokenReferences.map((reference) => {
        const decision = decisionMap.get(reference.source);
        if (!decision) throw new Error(`Missing decision for ${reference.source}`);
        return {
          source: reference.source,
          action: decision.action,
          replacementPath: decision.replacementPath ?? undefined,
        };
      });
      await mutate(() => window.castApi.finalizeImportBundle(target.filePath, decisions));
      setStatusText(`Imported ${target.inspection.itemCount} item${target.inspection.itemCount === 1 ? '' : 's'}.`);
      close();
    } catch (error) {
      setTarget((current) => current ? { ...current, error: (error as Error).message } : current);
      setImporting(false);
    }
  }

  const dialogOpen = target !== null;

  return (
    <>
      {isHoveringFile && (
        <div
          className="pointer-events-none fixed inset-0 z-[2000] flex items-center justify-center bg-primary/40 backdrop-blur-sm"
          aria-hidden="true"
        >
          <div className="rounded-lg border-2 border-dashed border-focus bg-primary/90 px-8 py-6 text-center shadow-2xl">
            <div className="text-base font-semibold text-primary">Drop to import deck bundle</div>
            <div className="mt-1 text-xs text-tertiary">Accepts .cst files</div>
          </div>
        </div>
      )}

      <Dialog.Root open={dialogOpen} onOpenChange={(next) => { if (!next) close(); }}>
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content className="w-full max-w-2xl">
              <Dialog.Header>
                <Dialog.Title>Import deck bundle</Dialog.Title>
                <Dialog.CloseButton />
              </Dialog.Header>
              <Dialog.Body className="overflow-y-auto px-4 py-3">
                {target && !target.inspection && !target.error && (
                  <div className="text-sm text-secondary">Inspecting bundle…</div>
                )}
                {target?.error && (
                  <div className="text-sm text-error_primary">{target.error}</div>
                )}
                {target?.inspection && (
                  <div className="flex flex-col gap-4">
                    <div className="text-sm text-secondary">
                      <span className="font-medium text-primary">{target.inspection.itemCount}</span> item{target.inspection.itemCount === 1 ? '' : 's'},{' '}
                      <span className="font-medium text-primary">{target.inspection.themeCount}</span> theme{target.inspection.themeCount === 1 ? '' : 's'},{' '}
                      <span className="font-medium text-primary">{target.inspection.mediaReferenceCount}</span> media reference{target.inspection.mediaReferenceCount === 1 ? '' : 's'}.
                    </div>
                    {target.inspection.brokenReferences.length > 0 && (
                      <div className="flex flex-col gap-2">
                        <div className="text-xs uppercase tracking-wide text-tertiary">Resolve broken references</div>
                        <BrokenReferenceReviewList
                          inspection={target.inspection}
                          decisionMap={decisionMap}
                          onActionChange={handleActionChange}
                          onChooseReplacement={handleChooseReplacement}
                        />
                      </div>
                    )}
                    {blockedReasons.length > 0 && (
                      <ul className="text-xs text-tertiary list-disc pl-4">
                        {blockedReasons.map((reason) => <li key={reason}>{reason}</li>)}
                      </ul>
                    )}
                  </div>
                )}
              </Dialog.Body>
              <Dialog.Footer>
                <ReacstButton variant="ghost" onClick={close}>Cancel</ReacstButton>
                <ReacstButton
                  variant="default"
                  onClick={handleConfirm}
                  disabled={!target?.inspection || importing || blockedReasons.length > 0}
                >
                  {importing ? 'Importing…' : 'Import'}
                </ReacstButton>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Positioner>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
