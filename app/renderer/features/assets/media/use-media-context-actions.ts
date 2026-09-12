import type { MediaAsset } from '@lumacast/composition';
import { useElements } from '../../../contexts/canvas/canvas-context';
import { useCast } from '../../../contexts/app-context';
import { useConfirm } from '../../../components/overlays/confirm-dialog';
import { castMediaSrc } from '../../../utils/slides';

export function useMediaContextActions(asset: MediaAsset) {
  const { deleteMedia } = useElements();
  const { mutatePatch, setStatusText } = useCast();
  const confirm = useConfirm();

  // All callers invoke these via `void …().catch(() => undefined)`: the
  // repo methods reject when the asset no longer exists (#214), and
  // mutatePatch has already reported the failure (#221), so the rethrow
  // is absorbed at the call site.
  async function handleReplaceSource() {
    const filePath = await window.castApi.chooseImportReplacementMediaPath();
    if (!filePath) return;
    // Import capability, not a renderable URL: main persists it and returns the
    // managed media id the bin actually renders (issue #159).
    const nextSrc = castMediaSrc(filePath);
    await mutatePatch(() => window.castApi.updateMediaAssetSrc(asset.id, nextSrc));
    setStatusText(`Replaced source for ${asset.name}`);
  }

  // deleteMedia → deleteMediaAsset rejects when the asset no longer exists
  // (#214); mutatePatch has already reported the failure (#221), so the
  // rethrow is absorbed at the call site.
  async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${asset.name}"?`,
      description: 'Slides and elements that reference this media will lose their source.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await deleteMedia(asset.id);
    setStatusText(`Deleted ${asset.name}`);
  }

  return { handleReplaceSource, handleDelete };
}
