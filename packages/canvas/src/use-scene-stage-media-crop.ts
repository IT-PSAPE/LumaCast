import { useCallback, useRef, type RefObject } from 'react';
import type Konva from 'konva';
import type { Id } from '@lumacast/kernel';
import type { SlideElement } from '@lumacast/composition';
import type { ElementUpdateInput } from '@lumacast/protocol';
import { computeMediaCropGesture, type CropTransformHandle, type CropTransformRect } from './media-crop-transform';
import type { SceneStageElementsPort } from './use-scene-stage-editor';

const HANDLES: Record<string, CropTransformHandle> = {
  'top-left': 'nw', 'top-center': 'n', 'top-right': 'ne',
  'middle-right': 'e', 'bottom-right': 'se', 'bottom-center': 's',
  'bottom-left': 'sw', 'middle-left': 'w',
};

interface CropSession {
  element: SlideElement;
  node: Konva.Group;
  initialAttrs: Record<string, unknown>;
  handle: CropTransformHandle;
  inverse: Konva.Transform;
  transform: Konva.Transform;
  pointer: { x: number; y: number };
  sourceDrawRect: CropTransformRect | null;
  media: Konva.Image | null;
  mediaAttrs: Record<string, unknown> | null;
  initialMediaCrop: CropTransformRect | null;
  rects: Array<{ node: Konva.Node; attrs: Record<string, unknown> }>;
  sourceWidth: number;
  sourceHeight: number;
  update: ElementUpdateInput | null;
  previewed: boolean;
}

interface MediaCropParams {
  editable: boolean;
  stageRef: RefObject<Konva.Stage | null>;
  transformerRef: RefObject<Konva.Transformer | null>;
  nodeRefs: RefObject<Map<Id, Konva.Group>>;
  effectiveElementsRef: RefObject<SlideElement[]>;
  baseElementsRef: RefObject<SlideElement[]>;
  selectedElementIdsRef: RefObject<Id[]>;
  applyDraftPatch: (id: Id, patch: Partial<SlideElement>) => void;
  flushDraftBuffer: () => void;
  elements: Pick<SceneStageElementsPort, 'commitElementUpdates' | 'setDraftElements' | 'setCanvasInteracting'>;
}

/** Modifier cropping owns one transformer gesture, using its initial source
 * mapping throughout. Repeated preview ticks never accumulate scale errors. */
export function useSceneStageMediaCrop(params: MediaCropParams) {
  const sessionRef = useRef<CropSession | null>(null);
  const {
    editable, stageRef, transformerRef, nodeRefs, effectiveElementsRef,
    baseElementsRef, selectedElementIdsRef, applyDraftPatch, flushDraftBuffer,
    elements: { commitElementUpdates, setDraftElements, setCanvasInteracting },
  } = params;

  const handleTransformStart = useCallback((event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    sessionRef.current = null;
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    if (!editable || !(mac ? event.evt.metaKey : event.evt.ctrlKey)) return;
    const ids = selectedElementIdsRef.current;
    if (ids.length !== 1) return;
    const element = effectiveElementsRef.current.find((entry) => entry.id === ids[0]);
    const node = nodeRefs.current.get(ids[0]);
    let handle = HANDLES[transformerRef.current?.getActiveAnchor() ?? ''];
    const pointer = stageRef.current?.getPointerPosition();
    if (!element || !node || !handle || !pointer
      || (element.type !== 'image' && element.type !== 'video')
      || element.payload.locked || element.payload.visible === false) return;

    // Transformer handles describe the displayed box; source coordinates use
    // the unflipped media axes.
    if (node.scaleX() < 0) handle = handle.replace(/[we]/g, (axis) => axis === 'w' ? 'e' : 'w') as CropTransformHandle;
    if (node.scaleY() < 0) handle = handle.replace(/[ns]/g, (axis) => axis === 'n' ? 's' : 'n') as CropTransformHandle;
    const media = node.findOne<Konva.Image>('.element-media') ?? null;
    const { width: sourceWidth, height: sourceHeight } = sourceSize(media);
    const region = media?.crop();
    const crop = region && region.width > 0 && region.height > 0
      ? region : { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
    let sourceDrawRect: CropTransformRect | null = null;
    if (media && sourceWidth > 0 && sourceHeight > 0 && media.width() > 0 && media.height() > 0) {
      const width = media.width() * sourceWidth / crop.width;
      const height = media.height() * sourceHeight / crop.height;
      sourceDrawRect = {
        x: media.x() - crop.x / sourceWidth * width,
        y: media.y() - crop.y / sourceHeight * height,
        width, height,
      };
    }
    const inverse = node.getAbsoluteTransform().copy().invert();
    sessionRef.current = {
      element, node, initialAttrs: { ...node.getAttrs() }, handle,
      inverse, transform: node.getTransform().copy(), pointer: inverse.point(pointer),
      sourceDrawRect, media, sourceWidth, sourceHeight, update: null, previewed: false,
      mediaAttrs: media ? { ...media.getAttrs() } : null,
      initialMediaCrop: media ? { ...media.crop() } : null,
      rects: node.children.filter((child) => child.getClassName() === 'Rect')
        .map((child) => ({ node: child, attrs: { ...child.getAttrs() } })),
    };
    setCanvasInteracting(true);
  }, [editable, stageRef, transformerRef, nodeRefs, effectiveElementsRef, selectedElementIdsRef, setCanvasInteracting]);

  const handleTransform = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return false;
    const { element, node, sourceDrawRect, media } = session;
    const pointer = stageRef.current?.getPointerPosition();
    const local = pointer ? session.inverse.point(pointer) : session.pointer;
    const result = sourceDrawRect ? computeMediaCropGesture({
      frame: { x: 0, y: 0, width: element.width, height: element.height },
      handle: session.handle,
      deltaX: local.x - session.pointer.x, deltaY: local.y - session.pointer.y,
      sourceDrawRect,
    }) : null;
    // Missing metadata and empty intersections never fall back to rescaling.
    if (!result || !media) {
      node.setAttrs(session.update ? {
        x: session.update.x, y: session.update.y,
        width: session.update.width, height: session.update.height,
        scaleX: session.initialAttrs.scaleX ?? 1, scaleY: session.initialAttrs.scaleY ?? 1,
        offsetX: Number(session.initialAttrs.scaleX) < 0 ? session.update.width : 0,
        offsetY: Number(session.initialAttrs.scaleY) < 0 ? session.update.height : 0,
      } : session.initialAttrs);
      transformerRef.current?.forceUpdate();
      return true;
    }
    const { frame, crop, cropFrame } = result;
    if (Math.abs(frame.x) < 1e-8 && Math.abs(frame.y) < 1e-8
      && Math.abs(frame.width - element.width) < 1e-8 && Math.abs(frame.height - element.height) < 1e-8) {
      session.update = null;
      restorePreview(session);
      if (session.previewed) applyDraftPatch(element.id, {
        x: element.x, y: element.y, width: element.width, height: element.height, payload: element.payload,
      });
      transformerRef.current?.forceUpdate();
      return true;
    }
    const flipX = Number(session.initialAttrs.scaleX) < 0;
    const flipY = Number(session.initialAttrs.scaleY) < 0;
    const origin = session.transform.point({
      x: frame.x + (flipX ? frame.width : 0),
      y: frame.y + (flipY ? frame.height : 0),
    });
    const base = baseElementsRef.current.find((entry) => entry.id === element.id);
    if (!base) { node.setAttrs(session.initialAttrs); return true; }
    const payload = { ...base.payload, crop, cropFrame };
    const themeOverrideKeys = base.sourceThemeElementId
      ? [...new Set([...(base.themeOverrideKeys ?? []), 'crop', 'cropFrame'])].sort()
      : undefined;
    const geometry = { x: origin.x, y: origin.y, width: frame.width, height: frame.height };
    session.update = { id: element.id, ...geometry, payload, ...(themeOverrideKeys ? { themeOverrideKeys } : {}) };
    session.previewed = true;
    node.setAttrs({
      ...geometry, scaleX: flipX ? -1 : 1, scaleY: flipY ? -1 : 1,
      offsetX: flipX ? frame.width : 0, offsetY: flipY ? frame.height : 0,
    });
    // Apply the exact source mapping before React's buffered draft paints.
    // A proxy can be replaced by its full-resolution resource mid-gesture.
    // Keep the normalized mapping, but use the current resource's pixel units.
    const currentSource = sourceSize(media);
    const sourceWidth = currentSource.width || session.sourceWidth;
    const sourceHeight = currentSource.height || session.sourceHeight;
    media.setAttrs({
      image: media.image(),
      x: cropFrame.x * frame.width, y: cropFrame.y * frame.height,
      width: cropFrame.width * frame.width, height: cropFrame.height * frame.height,
      crop: { x: crop.x * sourceWidth, y: crop.y * sourceHeight,
        width: crop.width * sourceWidth, height: crop.height * sourceHeight },
    });
    for (const child of node.children) {
      if (child.getClassName() === 'Rect') child.setAttrs({ width: frame.width, height: frame.height });
    }
    // Draft resolved styling while only crop fields are authored on commit.
    applyDraftPatch(element.id, { ...geometry, payload: { ...element.payload, crop, cropFrame } });
    transformerRef.current?.forceUpdate();
    node.getLayer()?.batchDraw();
    return true;
  }, [stageRef, transformerRef, baseElementsRef, applyDraftPatch]);

  const handleTransformEnd = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return false;
    sessionRef.current = null;
    flushDraftBuffer();
    try {
      if (session.update) await commitElementUpdates([session.update]);
      else if (session.previewed) setDraftElements((current) => {
        const next = { ...current };
        delete next[session.element.id];
        return next;
      });
    } catch {
      // Existing mutation reporting presents the error. Remove the failed
      // preview so the canvas returns to its last authored state.
      restorePreview(session);
      transformerRef.current?.forceUpdate();
      session.node.getLayer()?.batchDraw();
      setDraftElements((current) => {
        const next = { ...current };
        delete next[session.element.id];
        return next;
      });
    } finally {
      setCanvasInteracting(false);
    }
    return true;
  }, [flushDraftBuffer, commitElementUpdates, setDraftElements, setCanvasInteracting, transformerRef]);

  return { handleTransformStart, handleTransform, handleTransformEnd };
}

function restorePreview(session: CropSession) {
  session.node.setAttrs(session.initialAttrs);
  if (session.media && session.mediaAttrs) {
    const image = session.media.image();
    const size = sourceSize(session.media);
    session.media.setAttrs({ ...session.mediaAttrs, image });
    const crop = session.initialMediaCrop;
    if (crop && crop.width > 0 && crop.height > 0 && session.sourceWidth > 0 && session.sourceHeight > 0) {
      session.media.crop({
        x: crop.x * size.width / session.sourceWidth, y: crop.y * size.height / session.sourceHeight,
        width: crop.width * size.width / session.sourceWidth, height: crop.height * size.height / session.sourceHeight,
      });
    }
  }
  for (const rect of session.rects) rect.node.setAttrs(rect.attrs);
  session.node.getLayer()?.batchDraw();
}

function sourceSize(media: Konva.Image | null) {
  const resource = media?.image() as {
    naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number;
  } | undefined;
  return {
    width: resource?.naturalWidth || resource?.videoWidth || 0,
    height: resource?.naturalHeight || resource?.videoHeight || 0,
  };
}
