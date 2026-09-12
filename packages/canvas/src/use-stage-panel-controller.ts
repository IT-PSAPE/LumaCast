import { useCallback, useMemo, useState } from 'react';
import type { MediaAsset, SlideElement } from '@lumacast/composition';
import type { ActiveEditorSource } from './editor-source';

// Mirrors app/renderer/components/overlays/media-picker-dialog.tsx's
// MediaPickerAssetKind. Declared locally (rather than imported) so this
// package stays free of a dependency on that shared app-shell UI component;
// TypeScript's structural typing keeps the two interchangeable at the
// app/package boundary.
export type MediaPickerAssetKind = 'image' | 'video';

interface SelectionMetrics {
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
}

// Mirrors the `x`/`y`/`width`/`height` fields of app's
// ElementInspectorDraft (app/renderer/types/ui.ts) — the only fields this
// controller reads. See MediaPickerAssetKind above for why this is a local
// structural type rather than an import.
export interface StagePanelElementDraft {
  x: number;
  y: number;
  width: number;
  height: number;
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

// The narrow slice of app-shell state this controller needs. The app (its
// stage-panel.tsx caller) resolves the active editor source, selection/draft
// state, media-creation actions, and the project's media assets, then passes
// them in — the package never reaches into an app-shell context directly.
export interface StagePanelControllerDeps {
  activeEditorSource: ActiveEditorSource;
  selectedElement: SlideElement | null;
  elementDraft: StagePanelElementDraft | null;
  createFromMedia: (asset: MediaAsset, x: number, y: number) => Promise<void>;
  importMedia: (files: FileList) => Promise<void>;
  mediaAssets: MediaAsset[];
}

export function useStagePanelController({
  activeEditorSource,
  selectedElement,
  elementDraft,
  createFromMedia,
  importMedia,
  mediaAssets,
}: StagePanelControllerDeps): StagePanelController {
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
