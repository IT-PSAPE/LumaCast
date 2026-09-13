import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SlideElement } from '@lumacast/composition';
import { ShapeElementInspector } from '@renderer/features/inspector/shape-element-inspector';

const mocks = vi.hoisted(() => ({
  elements: {
    selectedElement: null as SlideElement | null,
    selectedElementIds: [] as string[],
    elementDraft: null as null | { x: number; y: number; width: number; height: number; rotation: number; opacity: number; zIndex: number },
    elementPayloadDraft: null as unknown,
    lockAspectRatio: false,
    setElementDraft: vi.fn(),
    setElementPayloadDraft: vi.fn(),
    setLockAspectRatio: vi.fn(),
    alignSelection: vi.fn(),
  },
}));

vi.mock('@renderer/contexts/canvas/canvas-context', () => ({
  useElements: () => mocks.elements,
  useRenderScenes: () => ({ editScene: { width: 1920, height: 1080 } }),
}));

// FieldSelect's real implementation is a Base UI portal-based listbox that
// needs the workbench overlay stack; every other Field primitive this
// inspector uses (FieldInput, FieldIcon, FieldCheckbox) is self-contained, so
// only FieldSelect is swapped for a native <select> here — the goal is
// testing this inspector's wiring, not re-testing the Field kit itself.
vi.mock('@renderer/components/form/field', async () => {
  const actual = await vi.importActual<typeof import('@renderer/components/form/field')>('@renderer/components/form/field');
  function FieldSelectStub({ value, onChange, children }: { value: string; onChange: (value: string) => void; children?: ReactNode }) {
    return (
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    );
  }
  function FieldSelectOptionStub({ value, children }: { value: string; children?: ReactNode }) {
    return <option value={value}>{children}</option>;
  }
  return { ...actual, FieldSelect: Object.assign(FieldSelectStub, { Option: FieldSelectOptionStub }) };
});

function shapeElement(overrides: Partial<SlideElement> = {}): SlideElement {
  return {
    id: 'el-shape', slideId: 'slide-1', type: 'shape',
    x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, zIndex: 0, layer: 'content',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    // fillEnabled/strokeEnabled explicit false: readVisualPayload defaults a
    // shape's fillEnabled to true and strokeEnabled to (borderWidth>0), which
    // would otherwise pull in ColorPicker/Popover (a separate overlay-stack
    // dependency) — out of scope for these tests.
    payload: { fillColor: '#ffffff', fillEnabled: false, borderColor: '#111111', borderWidth: 0, borderRadius: 0, strokeEnabled: false, shadowEnabled: false },
    ...overrides,
  } as SlideElement;
}

function imageElement(payloadOverrides: Record<string, unknown> = {}): SlideElement {
  return {
    id: 'el-image', slideId: 'slide-1', type: 'image',
    x: 0, y: 0, width: 200, height: 100, rotation: 0, opacity: 1, zIndex: 0, layer: 'content',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    payload: { src: 'asset://a.png', ...payloadOverrides },
  } as SlideElement;
}

function select(element: SlideElement, overrides: Partial<typeof mocks.elements> = {}) {
  mocks.elements.selectedElement = element;
  mocks.elements.selectedElementIds = [element.id];
  mocks.elements.elementDraft = {
    x: element.x, y: element.y, width: element.width, height: element.height,
    rotation: element.rotation, opacity: element.opacity, zIndex: element.zIndex,
  };
  mocks.elements.elementPayloadDraft = element.payload;
  mocks.elements.lockAspectRatio = false;
  Object.assign(mocks.elements, overrides);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ShapeElementInspector aspect-ratio lock', () => {
  it('is reachable: clicking the lock button calls setLockAspectRatio', () => {
    select(shapeElement());
    render(<ShapeElementInspector />);
    const button = screen.getByTitle('Lock aspect ratio');
    expect(button).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(button);

    expect(mocks.elements.setLockAspectRatio).toHaveBeenCalledTimes(1);
    const updater = mocks.elements.setLockAspectRatio.mock.calls[0][0] as (current: boolean) => boolean;
    expect(updater(false)).toBe(true);
  });

  it('shows the locked icon state when lockAspectRatio is already true', () => {
    select(shapeElement(), { lockAspectRatio: true });
    render(<ShapeElementInspector />);
    expect(screen.getByTitle('Lock aspect ratio')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('ShapeElementInspector align selection', () => {
  it('labels the row "Position" and aligns the single element locally when only 1 is selected', () => {
    select(shapeElement());
    render(<ShapeElementInspector />);

    expect(screen.getByText('Position')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Align left'));

    expect(mocks.elements.setElementDraft).toHaveBeenCalledTimes(1);
    expect(mocks.elements.alignSelection).not.toHaveBeenCalled();
  });

  it('labels the row "Align Selection" and aligns the selection when ≥2 are selected', () => {
    select(shapeElement(), { selectedElementIds: ['el-shape', 'el-other'] });
    render(<ShapeElementInspector />);

    expect(screen.getByText('Align Selection')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Align left'));

    expect(mocks.elements.alignSelection).toHaveBeenCalledWith('left', 'selection');
    expect(mocks.elements.setElementDraft).not.toHaveBeenCalled();
  });

  it('maps each icon to its edge/center when aligning a multi-selection', () => {
    select(shapeElement(), { selectedElementIds: ['el-shape', 'el-other'] });
    render(<ShapeElementInspector />);

    fireEvent.click(screen.getByTitle('Align center'));
    expect(mocks.elements.alignSelection).toHaveBeenLastCalledWith('centerX', 'selection');
    fireEvent.click(screen.getByTitle('Align right'));
    expect(mocks.elements.alignSelection).toHaveBeenLastCalledWith('right', 'selection');
    fireEvent.click(screen.getByTitle('Align top'));
    expect(mocks.elements.alignSelection).toHaveBeenLastCalledWith('top', 'selection');
    fireEvent.click(screen.getByTitle('Align middle'));
    expect(mocks.elements.alignSelection).toHaveBeenLastCalledWith('centerY', 'selection');
    fireEvent.click(screen.getByTitle('Align bottom'));
    expect(mocks.elements.alignSelection).toHaveBeenLastCalledWith('bottom', 'selection');
  });
});

describe('ShapeElementInspector reset rotation', () => {
  it('sets rotation to 0 via the reset-rotation button', () => {
    select(shapeElement({ rotation: 45 }));
    render(<ShapeElementInspector />);

    fireEvent.click(screen.getByTitle('Reset rotation'));

    expect(mocks.elements.setElementDraft).toHaveBeenCalledTimes(1);
    const updater = mocks.elements.setElementDraft.mock.calls[0][0] as (current: typeof mocks.elements.elementDraft) => unknown;
    expect(updater(mocks.elements.elementDraft)).toMatchObject({ rotation: 0 });
  });
});

describe('ShapeElementInspector media fit (image elements)', () => {
  it('shows a Media section defaulting to cover when no fit is authored', () => {
    select(imageElement());
    render(<ShapeElementInspector />);
    expect(screen.getByText('Media')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('cover');
  });

  it('reflects an explicit authored fit', () => {
    select(imageElement({ fit: 'contain' }));
    render(<ShapeElementInspector />);
    expect(screen.getByRole('combobox')).toHaveValue('contain');
  });

  it('persists a new fit through setElementPayloadDraft', () => {
    select(imageElement());
    render(<ShapeElementInspector />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'fill' } });

    expect(mocks.elements.setElementPayloadDraft).toHaveBeenCalledWith(
      expect.objectContaining({ fit: 'fill', src: 'asset://a.png' }),
    );
  });

  it('omits the Media section for a non-media element', () => {
    select(shapeElement());
    render(<ShapeElementInspector />);
    expect(screen.queryByText('Media')).not.toBeInTheDocument();
  });
});
