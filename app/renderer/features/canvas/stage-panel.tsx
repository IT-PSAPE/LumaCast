import { Film, Image, Square, Type } from 'lucide-react';
import { ReacstButtonGroup } from '@renderer/components/controls/button-group';
import { MediaPickerDialog } from '../../components/overlays/media-picker-dialog';
import { useElements } from '../../contexts/canvas/canvas-context';
import { useActiveEditorSource } from '../../contexts/canvas/use-active-editor-source';
import { useStagePanelController } from './use-stage-panel-controller';
import { StageViewport } from './stage-viewport';
import { EmptyState } from '../../components/display/empty-state';

function formatMetric(value: number | null): string {
  if (value === null) return '--';
  return `${Math.round(value)}`;
}

export function StagePanel() {
  const { actions, state } = useStagePanelController();
  const { x, y, width, height } = state.selectionMetrics;
  const { createText, createShape } = useElements();
  const activeEditorSource = useActiveEditorSource();

  return (
    <section
      data-ui-region="stage-panel"
      className="grid h-full min-h-0 grid-rows-[1fr_auto] overflow-hidden bg-primary/50"
    >
      <div className="relative min-h-0 overflow-hidden p-2">
        {state.hasCanvasSource ? (
          <>
            <StageViewport />
            <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
              <ReacstButtonGroup.Root className="pointer-events-auto">
                {activeEditorSource.createCapabilities.text ? (
                  <ReacstButtonGroup.Icon native label="Add text" onClick={createText}>
                    <Type strokeWidth={1.5} />
                  </ReacstButtonGroup.Icon>
                ) : null}
                {activeEditorSource.createCapabilities.shape ? (
                  <ReacstButtonGroup.Icon native label="Add shape" onClick={createShape}>
                    <Square strokeWidth={1.5} />
                  </ReacstButtonGroup.Icon>
                ) : null}
                {activeEditorSource.createCapabilities.image ? (
                  <ReacstButtonGroup.Icon native label="Add image" onClick={() => actions.openAssetPicker('image')}>
                    <Image strokeWidth={1.5} />
                  </ReacstButtonGroup.Icon>
                ) : null}
                {activeEditorSource.createCapabilities.video ? (
                  <ReacstButtonGroup.Icon native label="Add video" onClick={() => actions.openAssetPicker('video')}>
                    <Film strokeWidth={1.5} />
                  </ReacstButtonGroup.Icon>
                ) : null}
              </ReacstButtonGroup.Root>
            </div>
            {state.pickerKind ? (
              <MediaPickerDialog
                assets={state.mediaAssets}
                kind={state.pickerKind}
                onConfirm={actions.confirmMedia}
                onClose={actions.closeAssetPicker}
                onImportAssets={actions.importAssets}
              />
            ) : null}
          </>
        ) : (
          <EmptyState.Root>
            <EmptyState.Title>{state.emptyStateLabel}</EmptyState.Title>
          </EmptyState.Root>
        )}
      </div>

      <footer className="flex items-center gap-4 border-t border-primary bg-primary/80 px-3 py-1 text-sm text-secondary">
        <span className="font-medium text-tertiary">Selection</span>
        <span>X: {formatMetric(x)}</span>
        <span>Y: {formatMetric(y)}</span>
        <span>W: {formatMetric(width)}</span>
        <span>H: {formatMetric(height)}</span>
      </footer>
    </section>
  );
}
