import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlideElement, VideoElementPayload } from '@lumacast/composition';

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

// See shape-element-inspector.test.tsx: FieldSelect alone needs the workbench
// overlay stack, so only it is swapped for a native <select>.
vi.mock('@lumacast/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lumacast/ui')>();
  type Option = { value: string; label: string };
  function SelectStub({ value, onValueChange, options, label }: { value: string; onValueChange: (value: string) => void; options: ReadonlyArray<Option>; label?: string }) {
    return (
      <select aria-label={label} value={value} onChange={(event) => onValueChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  return { ...actual, Select: SelectStub };
});

import { VideoElementInspector } from '@renderer/features/inspector/video-element-inspector';

function videoPayload(overrides: Partial<VideoElementPayload> = {}): VideoElementPayload {
  return { src: 'asset://clip.mp4', autoplay: false, loop: false, ...overrides };
}

function selectVideo(payload: VideoElementPayload) {
  mocks.elements.selectedElement = { id: 'el-1', slideId: 'slide-1', type: 'video' } as SlideElement;
  mocks.elements.elementPayloadDraft = payload;
}

// jsdom has no real media pipeline; the component's preview <video> calls
// .load() on mount (see the src-sync effect), which jsdom otherwise reports
// as "not implemented".
beforeEach(() => {
  HTMLMediaElement.prototype.load = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('VideoElementInspector fit', () => {
  it('defaults to contain when no fit is authored', () => {
    selectVideo(videoPayload());
    render(<VideoElementInspector />);
    expect(screen.getByRole('combobox')).toHaveValue('contain');
  });

  it('reflects an explicit authored fit', () => {
    selectVideo(videoPayload({ fit: 'cover' }));
    render(<VideoElementInspector />);
    expect(screen.getByRole('combobox')).toHaveValue('cover');
  });

  it('persists a new fit through setElementPayloadDraft', () => {
    selectVideo(videoPayload());
    render(<VideoElementInspector />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'fill' } });

    expect(mocks.elements.setElementPayloadDraft).toHaveBeenCalledTimes(1);
    const updater = mocks.elements.setElementPayloadDraft.mock.calls[0][0] as (current: VideoElementPayload) => VideoElementPayload;
    expect(updater(videoPayload())).toMatchObject({ fit: 'fill', src: 'asset://clip.mp4' });
  });
});
