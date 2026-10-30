import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SceneNode } from '../../../../../../apps/cast/renderer/features/canvas/scene-node';

vi.mock('react-konva', async () => {
  const ReactModule = await import('react');
  const Group = ReactModule.forwardRef<HTMLDivElement, Record<string, unknown>>((props, ref) => {
    const handler = props.onClick as ((event: { evt: MouseEvent; cancelBubble: boolean }) => void) | undefined;
    return ReactModule.createElement('div', {
      ref,
      'data-testid': 'scene-node',
      onClick: (event: React.MouseEvent<HTMLDivElement>) => handler?.({ evt: event.nativeEvent, cancelBubble: false }),
    }, props.children as React.ReactNode);
  });
  return { Group };
});

vi.mock('@lumacast/composition', () => ({
  isSceneNodeVisible: () => true,
  sceneNodeFrame: () => ({
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    rotation: 0,
    opacity: 1,
    scaleX: 1,
    scaleY: 1,
    offsetX: 0,
    offsetY: 0,
  }),
}));

vi.mock('@lumacast/canvas', () => ({ renderSceneNodeContent: () => null }));

describe('SceneNode selection presses', () => {
  afterEach(() => cleanup());

  function renderNode(onSelect: (id: string, toggle: boolean) => void) {
    render(
      <SceneNode
        node={{ id: 'shape-1', visual: { locked: false } } as never}
        surface="deck-editor"
        editable
        isBeingEdited={false}
        onSelect={onSelect}
        onDoubleClick={vi.fn()}
        onDragStart={vi.fn()}
        onDragMove={vi.fn()}
        onDragEnd={vi.fn()}
        onTransform={vi.fn()}
        onTransformEnd={vi.fn()}
        onContextMenu={vi.fn()}
        setNodeRef={vi.fn()}
      />,
    );
    return screen.getByTestId('scene-node');
  }

  it('selects on a plain primary click without requesting a toggle', () => {
    const onSelect = vi.fn();
    fireEvent.click(renderNode(onSelect), { button: 0 });
    expect(onSelect).toHaveBeenCalledWith('shape-1', false);
  });

  it.each([
    ['Shift', { shiftKey: true }],
    ['Control', { ctrlKey: true }],
    ['Command', { metaKey: true }],
  ])('requests a selection toggle for a %s press', (_modifier, modifiers) => {
    const onSelect = vi.fn();
    fireEvent.click(renderNode(onSelect), { button: 0, ...modifiers });
    expect(onSelect).toHaveBeenCalledWith('shape-1', true);
  });

  it('leaves selection intact during a primary press so drag start can preserve the group', () => {
    const onSelect = vi.fn();
    fireEvent.mouseDown(renderNode(onSelect), { button: 0 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not change selection on a non-primary press', () => {
    const onSelect = vi.fn();
    fireEvent.click(renderNode(onSelect), { button: 2 });
    expect(onSelect).not.toHaveBeenCalled();
  });
});
