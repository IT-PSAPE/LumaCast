import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
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
