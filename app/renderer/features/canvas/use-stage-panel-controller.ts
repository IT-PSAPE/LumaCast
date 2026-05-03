import { useCallback, useMemo, useState } from 'react';
import type { MediaAsset } from '@core/types';
import type { MediaPickerAssetKind } from '../../components/overlays/media-picker-dialog';
import { useElements } from '../../contexts/canvas/canvas-context';
import { useActiveEditorSource } from '../../contexts/canvas/use-active-editor-source';
import { useProjectContent } from '../../contexts/use-project-content';

interface SelectionMetrics {
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
}

interface StagePanelControllerState {
  emptyStateLabel: string;
  hasCanvasSource: boolean;
  mediaAssets: MediaAsset[];
  pickerKind: MediaPickerAssetKind | null;
  selectionMetrics: SelectionMetrics;
}

interface StagePanelControllerActions {
  closeAssetPicker: () => void;
  confirmMedia: (selected: MediaAsset[]) => void;
  importAssets: (files: FileList) => Promise<void>;
  openAssetPicker: (kind: MediaPickerAssetKind) => void;
}

interface StagePanelController {
  actions: StagePanelControllerActions;
  state: StagePanelControllerState;
}

export function useStagePanelController(): StagePanelController {
  const activeEditorSource = useActiveEditorSource();
  const { selectedElement, elementDraft, createFromMedia, importMedia } = useElements();
  const { mediaAssets } = useProjectContent();
  const [pickerKind, setPickerKind] = useState<MediaPickerAssetKind | null>(null);

  const state = useMemo<StagePanelControllerState>(() => {
    return {
      emptyStateLabel: activeEditorSource.emptyStateLabel,
      hasCanvasSource: activeEditorSource.editable && activeEditorSource.hasSource,
      mediaAssets,
      pickerKind,
      selectionMetrics: {
        x: elementDraft?.x ?? selectedElement?.x ?? null,
        y: elementDraft?.y ?? selectedElement?.y ?? null,
        width: elementDraft?.width ?? selectedElement?.width ?? null,
        height: elementDraft?.height ?? selectedElement?.height ?? null
      }
    };
  }, [activeEditorSource, elementDraft, mediaAssets, pickerKind, selectedElement]);

  const openAssetPicker = useCallback((kind: MediaPickerAssetKind) => {
    setPickerKind(kind);
  }, []);

  const closeAssetPicker = useCallback(() => {
    setPickerKind(null);
  }, []);

  const confirmMedia = useCallback((selected: MediaAsset[]) => {
    setPickerKind(null);
    const startX = 200;
    const startY = 200;
    const offset = 40;

    for (let index = 0; index < selected.length; index += 1) {
      void createFromMedia(selected[index], startX + index * offset, startY + index * offset);
    }
  }, [createFromMedia]);

  const importAssets = useCallback(async (files: FileList) => {
    await importMedia(files);
  }, [importMedia]);

  return {
    actions: {
      closeAssetPicker,
      confirmMedia,
      importAssets,
      openAssetPicker
    },
    state
  };
}
