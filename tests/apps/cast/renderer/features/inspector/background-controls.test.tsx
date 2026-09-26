import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SlideBackground } from '@lumacast/composition';

vi.mock('@renderer/contexts/canvas/canvas-context', () => ({
  useElements: () => ({ importMedia: vi.fn() }),
}));

vi.mock('@renderer/contexts/use-project-content', () => ({
  useProjectContent: () => ({ mediaAssets: [] }),
}));

// ColorPicker (rendered for a 'color' background) needs the workbench overlay
// stack via its Popover; irrelevant to what this suite covers.
vi.mock('@renderer/components/form/color-picker', () => ({
  ColorPicker: () => null,
}));

// See shape-element-inspector.test.tsx: FieldSelect alone needs the workbench
// overlay stack, so only it is swapped for a native <select>.
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

import { BackgroundControls } from '@renderer/features/inspector/background-controls';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BackgroundControls fit select', () => {
  it('shows the fit select for an image background', () => {
    const background: SlideBackground = { type: 'image', mediaAssetId: null, src: 'asset://a.png', fit: 'cover' };
    render(<BackgroundControls title="Background" background={background} onChange={vi.fn()} />);
    const selects = screen.getAllByRole('combobox');
    // First combobox is the background-kind picker (None/Color/Gradient/Image/Video).
    expect(selects[1]).toHaveValue('cover');
  });

  // Regression: the fit select previously only rendered for `type === 'image'`,
  // silently stranding a video background's fit at whatever it was created with.
  it('also shows the fit select for a video background', () => {
    const background: SlideBackground = { type: 'video', mediaAssetId: null, src: 'asset://clip.mp4', fit: 'contain' };
    render(<BackgroundControls title="Background" background={background} onChange={vi.fn()} />);
    const selects = screen.getAllByRole('combobox');
    expect(selects[1]).toHaveValue('contain');
  });

  it('reports a changed video fit through onChange', () => {
    const background: SlideBackground = { type: 'video', mediaAssetId: null, src: 'asset://clip.mp4', fit: 'contain' };
    const onChange = vi.fn();
    render(<BackgroundControls title="Background" background={background} onChange={onChange} />);

    const fitSelect = screen.getAllByRole('combobox')[1];
    fireEvent.change(fitSelect, { target: { value: 'fill' } });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ type: 'video', fit: 'fill' }));
  });

  it('omits the fit select entirely for a color background', () => {
    const background: SlideBackground = { type: 'color', color: '#000000FF' };
    render(<BackgroundControls title="Background" background={background} onChange={vi.fn()} />);
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
  });
});
