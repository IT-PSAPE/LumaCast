import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { flattenSourceNodes } from '../shared/source-tree';
import type { BrowserSourceInput, StreamScene, StreamSource } from '../shared/desktop-api';
import { canvasPointFromOutputPoint, outputRectFromCanvasRect } from './output-scaling';
import type { VideoPoint, VideoRect } from './output-scaling';
import { hitTestSource } from './canvas-composition';
import { rotatePointAroundSource, sourceContainsPoint } from './source-transform';

export interface BrowserInteractionOutput {
  width: number;
  height: number;
  baseWidth: number;
  baseHeight: number;
}

export interface BrowserInteractionImageSize {
  naturalWidth: number;
  naturalHeight: number;
}

export interface BrowserInteractionOverlayProps {
  /** Runtime scene whose source IDs are used by BrowserSourceManager. */
  scene: StreamScene;
  output: BrowserInteractionOutput;
  selectedSourceId: string | null;
  imageElements: ReadonlyMap<string, BrowserInteractionImageSize>;
  sendBrowserSourceInput: (sourceId: string, input: BrowserSourceInput) => Promise<void>;
  onExit: () => void;
  onError?: (error: unknown) => void;
}

interface ActivePointer {
  pointerId: number;
  sourceId: string;
  button: 'left' | 'middle' | 'right';
  point: VideoPoint;
}

interface BrowserPointOptions {
  allowOutside?: boolean;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function cropForSource(source: StreamSource, width: number, height: number) {
  const left = clamp(source.crop?.left ?? 0, 0, width);
  const right = clamp(source.crop?.right ?? 0, 0, width - left);
  const top = clamp(source.crop?.top ?? 0, 0, height);
  const bottom = clamp(source.crop?.bottom ?? 0, 0, height - top);
  return { left, right, top, bottom, width: width - left - right, height: height - top - bottom };
}

/** Maps a base-canvas point through the rendered crop and rotation to normalized page coordinates. */
export function browserSourceInputPoint(
  source: StreamSource,
  point: VideoPoint,
  imageSize: BrowserInteractionImageSize,
  options: BrowserPointOptions = {},
): VideoPoint | null {
  if (source.kind !== 'browser' || !finitePositive(imageSize.naturalWidth) || !finitePositive(imageSize.naturalHeight)
    || !finitePositive(source.transform.width) || !finitePositive(source.transform.height)) return null;
  if (!options.allowOutside && !sourceContainsPoint(source.transform, point.x, point.y)) return null;

  const sourcePoint = rotatePointAroundSource(point, source.transform, -(source.transform.rotation ?? 0));
  const relativeX = clamp((sourcePoint.x - source.transform.x) / source.transform.width, 0, 1);
  const relativeY = clamp((sourcePoint.y - source.transform.y) / source.transform.height, 0, 1);
  const crop = cropForSource(source, imageSize.naturalWidth, imageSize.naturalHeight);
  if (!finitePositive(crop.width) || !finitePositive(crop.height)) return null;
  return {
    x: clamp((crop.left + relativeX * crop.width) / imageSize.naturalWidth, 0, 1),
    y: clamp((crop.top + relativeY * crop.height) / imageSize.naturalHeight, 0, 1),
  };
}

export function browserSourceOverlayRect(
  source: StreamSource,
  output: BrowserInteractionOutput,
): VideoRect {
  return outputRectFromCanvasRect(source.transform, {
    width: output.baseWidth,
    height: output.baseHeight,
  }, {
    width: output.width,
    height: output.height,
  });
}

function stageCanvasPoint(
  element: HTMLElement,
  clientX: number,
  clientY: number,
  output: BrowserInteractionOutput,
): VideoPoint | null {
  const rect = element.getBoundingClientRect();
  if (!finitePositive(rect.width) || !finitePositive(rect.height)
    || !finitePositive(output.width) || !finitePositive(output.height)
    || !finitePositive(output.baseWidth) || !finitePositive(output.baseHeight)) return null;
  return canvasPointFromOutputPoint({
    x: ((clientX - rect.left) / rect.width) * output.width,
    y: ((clientY - rect.top) / rect.height) * output.height,
  }, { width: output.baseWidth, height: output.baseHeight }, { width: output.width, height: output.height });
}

function sourceById(scene: StreamScene, id: string): StreamSource | undefined {
  return flattenSourceNodes(scene.sources).find((source) => source.id === id);
}

function pointerButton(button: number): ActivePointer['button'] | null {
  if (button === 0) return 'left';
  if (button === 1) return 'middle';
  if (button === 2) return 'right';
  return null;
}

function modifiersFromEvent(event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): number {
  return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
}

function printableText(key: string, event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean }): string | undefined {
  if (event.altKey || event.ctrlKey || event.metaKey || Array.from(key).length !== 1 || /[\u0000-\u001f\u007f]/.test(key)) return undefined;
  return key;
}

function sourceInputPoint(
  scene: StreamScene,
  target: StreamSource,
  canvasPoint: VideoPoint,
  imageElements: ReadonlyMap<string, BrowserInteractionImageSize>,
  allowOutside = false,
): VideoPoint | null {
  if (target.kind !== 'browser' || (!allowOutside && hitTestSource(scene, canvasPoint.x, canvasPoint.y)?.id !== target.id)) return null;
  const imageSize = imageElements.get(target.id);
  if (!imageSize) return null;
  return browserSourceInputPoint(target, canvasPoint, imageSize, { allowOutside });
}

function BrowserInteractionRegion({
  scene,
  output,
  source,
  imageElements,
  sendInput,
  onExit,
  onError,
}: Omit<BrowserInteractionOverlayProps, 'selectedSourceId' | 'sendBrowserSourceInput'> & {
  source: StreamSource;
  sendInput: BrowserInteractionOverlayProps['sendBrowserSourceInput'];
}) {
  const regionRef = useRef<HTMLDivElement | null>(null);
  const activePointer = useRef<ActivePointer | null>(null);
  const keyboardSourceId = useRef(source.id);
  const pressedKeys = useRef(new Map<string, Extract<BrowserSourceInput, { type: 'key' }>>());
  const sendInputRef = useRef(sendInput);
  const onExitRef = useRef(onExit);
  const onErrorRef = useRef(onError);
  const wheelHandlerRef = useRef<(event: WheelEvent) => void>(() => undefined);
  sendInputRef.current = sendInput;
  onExitRef.current = onExit;
  onErrorRef.current = onError;

  const send = (sourceId: string, input: BrowserSourceInput) => {
    void sendInputRef.current(sourceId, input).catch((error) => onErrorRef.current?.(error));
  };

  const getCanvasPoint = (clientX: number, clientY: number) => {
    const stage = regionRef.current?.parentElement?.parentElement;
    return stage ? stageCanvasPoint(stage, clientX, clientY, output) : null;
  };

  const resolveTopBrowser = (clientX: number, clientY: number) => {
    const point = getCanvasPoint(clientX, clientY);
    if (!point) return null;
    const target = hitTestSource(scene, point.x, point.y);
    if (target?.kind !== 'browser') return null;
    const normalized = sourceInputPoint(scene, target, point, imageElements);
    return normalized ? { source: target, point: normalized } : null;
  };

  const forwardPointer = (event: ReactPointerEvent<HTMLDivElement>, action: 'move' | 'down' | 'up', sourceId: string, button?: ActivePointer['button']) => {
    const target = sourceById(scene, sourceId);
    const canvasPoint = getCanvasPoint(event.clientX, event.clientY);
    if (!target || !canvasPoint) return;
    const imageSize = imageElements.get(sourceId);
    if (!imageSize) return;
    const point = action === 'move' && activePointer.current?.pointerId === event.pointerId
      ? browserSourceInputPoint(target, canvasPoint, imageSize, { allowOutside: true })
      : sourceInputPoint(scene, target, canvasPoint, imageElements, action !== 'down');
    if (!point) return;
    if (activePointer.current?.pointerId === event.pointerId) {
      activePointer.current = { ...activePointer.current, point };
    }
    send(sourceId, {
      type: 'pointer',
      action,
      ...point,
      ...(action === 'move' ? { buttons: event.buttons } : { button: button ?? pointerButton(event.button) ?? 'left' }),
      ...(action === 'down' ? { clickCount: event.detail } : {}),
      modifiers: modifiersFromEvent(event),
    });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = activePointer.current;
    if (active?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      forwardPointer(event, 'move', active.sourceId, active.button);
      return;
    }
    const target = resolveTopBrowser(event.clientX, event.clientY);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    send(target.source.id, {
      type: 'pointer',
      action: 'move',
      ...target.point,
      buttons: event.buttons,
      modifiers: modifiersFromEvent(event),
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return;
    const button = pointerButton(event.button);
    if (!button) return;
    const target = resolveTopBrowser(event.clientX, event.clientY);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointer.current = { pointerId: event.pointerId, sourceId: target.source.id, button, point: target.point };
    keyboardSourceId.current = target.source.id;
    send(target.source.id, {
      type: 'pointer',
      action: 'down',
      ...target.point,
      button,
      buttons: event.buttons,
      clickCount: Math.max(1, Math.min(3, event.detail)),
      modifiers: modifiersFromEvent(event),
    });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = activePointer.current;
    if (active?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    activePointer.current = null;
    forwardPointer(event, 'up', active.sourceId, active.button);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  wheelHandlerRef.current = (event: WheelEvent) => {
    const target = resolveTopBrowser(event.clientX, event.clientY);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    send(target.source.id, {
      type: 'wheel',
      ...target.point,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      modifiers: modifiersFromEvent(event),
    });
  };

  useEffect(() => {
    const region = regionRef.current;
    if (!region) return;
    const handleWheel = (event: WheelEvent) => wheelHandlerRef.current(event);
    region.addEventListener('wheel', handleWheel, { passive: false });
    return () => region.removeEventListener('wheel', handleWheel);
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      onExitRef.current();
      return;
    }
    const text = printableText(event.key, event);
    const input: Extract<BrowserSourceInput, { type: 'key' }> = {
      type: 'key',
      action: 'down',
      key: event.key,
      code: event.code,
      ...(text === undefined ? {} : { text }),
      modifiers: modifiersFromEvent(event),
    };
    pressedKeys.current.set(event.code || event.key, input);
    send(keyboardSourceId.current, input);
  };

  const handleKeyUp = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') return;
    pressedKeys.current.delete(event.code || event.key);
    send(keyboardSourceId.current, {
      type: 'key',
      action: 'up',
      key: event.key,
      code: event.code,
      modifiers: modifiersFromEvent(event),
    });
  };

  useEffect(() => {
    regionRef.current?.focus();
    return () => {
      const active = activePointer.current;
      if (active) {
        send(active.sourceId, {
          type: 'pointer',
          action: 'up',
          ...active.point,
          button: active.button,
          buttons: 0,
        });
        activePointer.current = null;
      }
      for (const [key, input] of pressedKeys.current) {
        send(keyboardSourceId.current, {
          type: 'key',
          action: 'up',
          key: input.key,
          code: input.code,
          modifiers: input.modifiers,
        });
        pressedKeys.current.delete(key);
      }
    };
  }, [source.id]);

  const rect = browserSourceOverlayRect(source, output);
  return <div
    ref={regionRef}
    className="browser-interaction-region"
    role="group"
    aria-label={`Interact with ${source.name}`}
    tabIndex={0}
    style={{
      position: 'absolute',
      left: `${(rect.x / output.width) * 100}%`,
      top: `${(rect.y / output.height) * 100}%`,
      width: `${(rect.width / output.width) * 100}%`,
      height: `${(rect.height / output.height) * 100}%`,
      transform: `rotate(${source.transform.rotation ?? 0}deg)`,
      transformOrigin: 'center',
      outline: 'none',
      pointerEvents: 'auto',
      touchAction: 'none',
    }}
    onPointerDown={handlePointerDown}
    onPointerMove={handlePointerMove}
    onPointerUp={handlePointerUp}
    onPointerCancel={handlePointerUp}
    onKeyDown={handleKeyDown}
    onKeyUp={handleKeyUp}
  />;
}

export function BrowserInteractionOverlay({
  scene,
  output,
  selectedSourceId,
  imageElements,
  sendBrowserSourceInput,
  onExit,
  onError,
}: BrowserInteractionOverlayProps) {
  if (!selectedSourceId) return null;
  const source = sourceById(scene, selectedSourceId);
  const image = imageElements.get(selectedSourceId);
  if (!source || source.kind !== 'browser' || !source.visible || !image
    || !finitePositive(image.naturalWidth) || !finitePositive(image.naturalHeight)) return null;

  return <div className="browser-interaction-overlay" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4 }}>
    <BrowserInteractionRegion
      scene={scene}
      output={output}
      source={source}
      imageElements={imageElements}
      sendInput={sendBrowserSourceInput}
      onExit={onExit}
      onError={onError}
    />
  </div>;
}
