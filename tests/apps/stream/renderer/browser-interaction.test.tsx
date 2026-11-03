// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserInteractionOverlay,
  browserSourceInputPoint,
  browserSourceOverlayRect,
} from '../../../../apps/stream/renderer/browser-interaction';
import { rotatePointAroundSource } from '../../../../apps/stream/renderer/source-transform';
import type { BrowserSourceInput, StreamScene, StreamSource } from '../../../../apps/stream/shared/desktop-api';

function browserSource(id: string, transform: StreamSource['transform'] = { x: 0, y: 0, width: 1280, height: 720 }): StreamSource {
  return {
    id,
    name: 'Browser',
    kind: 'browser',
    url: 'https://example.test',
    visible: true,
    muted: false,
    volume: 1,
    transform,
  };
}

function colorSource(id: string, transform: StreamSource['transform']): StreamSource {
  return {
    id,
    name: 'Cover',
    kind: 'color',
    color: '#ffffff',
    visible: true,
    muted: false,
    volume: 1,
    transform,
  };
}

function sceneWith(...sources: StreamSource[]): StreamScene {
  return { id: 'scene', name: 'Preview', sources };
}

const output = { width: 1600, height: 1200, baseWidth: 1280, baseHeight: 720 };

function makeFrameMap(...ids: string[]): Map<string, { naturalWidth: number; naturalHeight: number }> {
  return new Map(ids.map((id) => [id, { naturalWidth: 1280, naturalHeight: 720 }]));
}

function stageRect(stage: HTMLElement) {
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
    left: 100, top: 50, width: 800, height: 600, right: 900, bottom: 650,
    x: 100, y: 50, toJSON: () => ({}),
  } as DOMRect);
}

function capturePointer(region: HTMLElement) {
  Object.defineProperty(region, 'setPointerCapture', { configurable: true, value: vi.fn() });
  Object.defineProperty(region, 'hasPointerCapture', { configurable: true, value: vi.fn(() => false) });
  Object.defineProperty(region, 'releasePointerCapture', { configurable: true, value: vi.fn() });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('browser source input geometry', () => {
  it('maps through source crop and inverse rotation', () => {
    const source: StreamSource = {
      ...browserSource('browser', { x: 300, y: 200, width: 400, height: 200, rotation: 90 }),
      crop: { left: 20, right: 20, top: 10, bottom: 10 },
    };
    const localPoint = { x: 400, y: 250 };
    const canvasPoint = rotatePointAroundSource(localPoint, source.transform);

    expect(browserSourceInputPoint(source, canvasPoint, { naturalWidth: 400, naturalHeight: 200 })).toEqual({ x: 0.275, y: 0.275 });
    expect(browserSourceInputPoint(source, { x: 100, y: 100 }, { naturalWidth: 400, naturalHeight: 200 })).toBeNull();
  });

  it('maps the source overlay from base canvas dimensions into output coordinates', () => {
    expect(browserSourceOverlayRect(browserSource('browser', { x: 0, y: 0, width: 1280, height: 720 }), output)).toEqual({
      x: 0, y: 150, width: 1600, height: 900,
    });
  });
});

describe('BrowserInteractionOverlay', () => {
  it('forwards pointer, wheel and keyboard events in base-canvas coordinates and traps app hotkeys', () => {
    const source = browserSource('browser-runtime');
    const scene = sceneWith(source);
    const imageElements = makeFrameMap(source.id);
    const sendBrowserSourceInput = vi.fn(async (_id: string, _input: BrowserSourceInput) => undefined);
    const editorHotkey = vi.fn();
    const onExit = vi.fn();
    const { getByRole, getByTestId } = render(<div data-testid="stage" onKeyDown={editorHotkey}>
      <BrowserInteractionOverlay
        scene={scene}
        output={output}
        selectedSourceId={source.id}
        imageElements={imageElements}
        sendBrowserSourceInput={sendBrowserSourceInput}
        onExit={onExit}
      />
    </div>);
    const stage = getByTestId('stage');
    stageRect(stage);
    const region = getByRole('group', { name: 'Interact with Browser' });
    capturePointer(region);

    fireEvent.pointerMove(region, { pointerId: 1, pointerType: 'mouse', clientX: 500, clientY: 350, buttons: 0 });
    expect(sendBrowserSourceInput).toHaveBeenLastCalledWith(source.id, expect.objectContaining({ type: 'pointer', action: 'move', x: 0.5, y: 0.5 }));
    fireEvent.wheel(region, { clientX: 500, clientY: 350, deltaX: 0, deltaY: 120 });
    expect(sendBrowserSourceInput).toHaveBeenLastCalledWith(source.id, { type: 'wheel', x: 0.5, y: 0.5, deltaX: 0, deltaY: 120, modifiers: 0 });
    fireEvent.keyDown(region, { key: 'h', code: 'KeyH' });
    expect(sendBrowserSourceInput).toHaveBeenLastCalledWith(source.id, { type: 'key', action: 'down', key: 'h', code: 'KeyH', text: 'h', modifiers: 0 });
    expect(editorHotkey).not.toHaveBeenCalled();
    fireEvent.keyUp(region, { key: 'h', code: 'KeyH' });
    expect(sendBrowserSourceInput).toHaveBeenLastCalledWith(source.id, { type: 'key', action: 'up', key: 'h', code: 'KeyH', modifiers: 0 });
    fireEvent.keyDown(region, { key: 'Escape', code: 'Escape' });
    expect(onExit).toHaveBeenCalledOnce();
    expect(editorHotkey).not.toHaveBeenCalled();
  });

  it('cancels handled native wheel events without allowing stage scrolling', () => {
    const source = browserSource('browser-runtime');
    const sendBrowserSourceInput = vi.fn(async (_id: string, _input: BrowserSourceInput) => undefined);
    const stageWheel = vi.fn();
    const { getByRole, getByTestId } = render(<div data-testid="stage" onWheel={stageWheel}>
      <BrowserInteractionOverlay
        scene={sceneWith(source)}
        output={output}
        selectedSourceId={source.id}
        imageElements={makeFrameMap(source.id)}
        sendBrowserSourceInput={sendBrowserSourceInput}
        onExit={vi.fn()}
      />
    </div>);
    stageRect(getByTestId('stage'));
    const region = getByRole('group', { name: 'Interact with Browser' });
    const wheelEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: 500,
      clientY: 350,
      deltaY: 120,
    });

    region.dispatchEvent(wheelEvent);

    expect(wheelEvent.defaultPrevented).toBe(true);
    expect(stageWheel).not.toHaveBeenCalled();
    expect(sendBrowserSourceInput).toHaveBeenCalledWith(source.id, expect.objectContaining({
      type: 'wheel',
      deltaY: 120,
    }));
  });

  it('captures pointer drags outside the source and maps the drag to its original browser', () => {
    const source = browserSource('browser-runtime');
    const scene = sceneWith(source);
    const sendBrowserSourceInput = vi.fn(async (_id: string, _input: BrowserSourceInput) => undefined);
    const { getByRole, getByTestId } = render(<div data-testid="stage">
      <BrowserInteractionOverlay
        scene={scene}
        output={output}
        selectedSourceId={source.id}
        imageElements={makeFrameMap(source.id)}
        sendBrowserSourceInput={sendBrowserSourceInput}
        onExit={vi.fn()}
      />
    </div>);
    stageRect(getByTestId('stage'));
    const region = getByRole('group', { name: 'Interact with Browser' });
    capturePointer(region);

    fireEvent.pointerDown(region, { pointerId: 4, pointerType: 'mouse', button: 0, detail: 1, clientX: 500, clientY: 350, buttons: 1 });
    fireEvent.pointerMove(region, { pointerId: 4, pointerType: 'mouse', clientX: 1000, clientY: 350, buttons: 1 });
    fireEvent.pointerUp(region, { pointerId: 4, pointerType: 'mouse', button: 0, clientX: 1000, clientY: 350, buttons: 0 });

    expect(sendBrowserSourceInput).toHaveBeenNthCalledWith(1, source.id, expect.objectContaining({ type: 'pointer', action: 'down', x: 0.5, y: 0.5, button: 'left' }));
    expect(sendBrowserSourceInput).toHaveBeenNthCalledWith(2, source.id, expect.objectContaining({ type: 'pointer', action: 'move', x: 1, y: 0.5 }));
    expect(sendBrowserSourceInput).toHaveBeenNthCalledWith(3, source.id, expect.objectContaining({ type: 'pointer', action: 'up', x: 1, y: 0.5, button: 'left' }));
  });

  it('lets the existing editor handler receive a click when another source is topmost', () => {
    const browser = browserSource('browser-runtime');
    const cover = colorSource('cover', browser.transform);
    const sendBrowserSourceInput = vi.fn(async (_id: string, _input: BrowserSourceInput) => undefined);
    const editorPointer = vi.fn();
    const { getByRole, getByTestId } = render(<div data-testid="stage" onPointerDown={editorPointer}>
      <BrowserInteractionOverlay
        scene={sceneWith(browser, cover)}
        output={output}
        selectedSourceId={browser.id}
        imageElements={makeFrameMap(browser.id)}
        sendBrowserSourceInput={sendBrowserSourceInput}
        onExit={vi.fn()}
      />
    </div>);
    stageRect(getByTestId('stage'));
    const region = getByRole('group', { name: 'Interact with Browser' });
    capturePointer(region);

    fireEvent.pointerDown(region, { pointerId: 2, pointerType: 'mouse', button: 0, clientX: 500, clientY: 350, buttons: 1 });

    expect(editorPointer).toHaveBeenCalledOnce();
    expect(sendBrowserSourceInput).not.toHaveBeenCalled();
  });

  it('does not render for an unselected or unavailable browser frame', () => {
    const source = browserSource('browser-runtime');
    const props = {
      scene: sceneWith(source),
      output,
      selectedSourceId: source.id,
      imageElements: new Map<string, { naturalWidth: number; naturalHeight: number }>(),
      sendBrowserSourceInput: vi.fn(async (_id: string, _input: BrowserSourceInput) => undefined),
      onExit: vi.fn(),
    };

    const { container, rerender } = render(<BrowserInteractionOverlay {...props} />);
    expect(container.firstChild).toBeNull();
    rerender(<BrowserInteractionOverlay {...props} selectedSourceId={null} imageElements={makeFrameMap(source.id)} />);
    expect(container.firstChild).toBeNull();
  });
});
