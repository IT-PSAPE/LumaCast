import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SlideElement, TextElementPayload } from '@lumacast/composition';

const mocks = vi.hoisted(() => ({
  elements: {
    selectedElement: null as SlideElement | null,
    elementPayloadDraft: null as unknown,
    setElementPayloadDraft: vi.fn(),
  },
}));

vi.mock('@renderer/contexts/canvas/canvas-context', () => ({
  useElements: () => mocks.elements,
}));

// ColorPicker (always rendered in the Formatting section) needs the
// workbench overlay stack via its Popover; irrelevant to letterSpacing.
vi.mock('@renderer/components/form/color-picker', () => ({
  ColorPicker: () => null,
}));

// See shape-element-inspector.test.tsx: FieldSelect alone needs the workbench
// overlay stack (used here for the case-transform select), so only it is
// swapped for a native <select>.
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

import { TextElementInspector } from '@renderer/features/inspector/text-element-inspector';

function textPayload(overrides: Partial<TextElementPayload> = {}): TextElementPayload {
  return { text: 'Hello', fontFamily: 'Inter', fontSize: 32, color: '#ffffff', alignment: 'left', lineHeight: 1.25, ...overrides };
}

function selectText(payload: TextElementPayload) {
  mocks.elements.selectedElement = { id: 'el-1', slideId: 'slide-1', type: 'text' } as SlideElement;
  mocks.elements.elementPayloadDraft = payload;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TextElementInspector letterSpacing', () => {
  it('defaults to 0 when absent', () => {
    selectText(textPayload());
    render(<TextElementInspector />);
    // Base UI's NumberField.Input renders type="text" under the hood (see
    // field.tsx), so its DOM value is the formatted string, not a number.
    expect(screen.getByLabelText('Letter spacing')).toHaveValue('0');
  });

  it('shows an authored value', () => {
    selectText(textPayload({ letterSpacing: 4 }));
    render(<TextElementInspector />);
    expect(screen.getByLabelText('Letter spacing')).toHaveValue('4');
  });

  it('persists an edited value through setElementPayloadDraft', () => {
    selectText(textPayload());
    render(<TextElementInspector />);

    fireEvent.change(screen.getByLabelText('Letter spacing'), { target: { value: '3' } });

    expect(mocks.elements.setElementPayloadDraft).toHaveBeenCalledWith(
      expect.objectContaining({ letterSpacing: 3, text: 'Hello' }),
    );
  });
});
