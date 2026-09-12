import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { VolumeControl } from '../../../../../app/renderer/features/playback/volume-control';
afterEach(cleanup);
for (const kind of ['Audio', 'Video'] as const) {
  it(`changes ${kind} volume in fractional units and exposes its percentage`, () => {
    const change = vi.fn();
    render(<VolumeControl kind={kind} volume={.6} disabled={false} onChange={change} />);
    const slider = screen.getByRole('slider', { name: `${kind} volume` });
    expect(slider.getAttribute('aria-valuetext')).toBe('60%');
    fireEvent.change(slider, { target: { value: '25' } });
    expect(change).toHaveBeenCalledWith(.25);
  });
}
