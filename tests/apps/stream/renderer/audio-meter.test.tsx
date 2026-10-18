import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AudioMeter } from '../../../../apps/stream/renderer/audio-meter';
import { dbToFraction } from '../../../../apps/stream/renderer/audio-meter-model';

afterEach(cleanup);

function zoneFillPercent(container: HTMLElement, tone: 'ok' | 'warn' | 'hot'): number {
  const fill = container.querySelector(`.audio-meter-zone--${tone} .audio-meter-zone-fill`) as HTMLElement | null;
  expect(fill).not.toBeNull();
  return parseFloat(fill!.style.width);
}

describe('AudioMeter', () => {
  it('exposes level and range through the meter role', () => {
    render(<AudioMeter levelDb={-18} peakDb={-6} label="Microphone level" />);
    const meter = screen.getByRole('meter', { name: 'Microphone level' });
    expect(meter).toHaveAttribute('aria-valuenow', '-18');
    expect(meter).toHaveAttribute('aria-valuemin', '-60');
    expect(meter).toHaveAttribute('aria-valuemax', '0');
  });

  it('defaults the accessible name to "Audio level"', () => {
    render(<AudioMeter levelDb={-60} peakDb={-60} />);
    expect(screen.getByRole('meter', { name: 'Audio level' })).toBeInTheDocument();
  });

  it('clamps an out-of-range level for the aria value', () => {
    render(<AudioMeter levelDb={6} peakDb={6} label="Clamped" />);
    const meter = screen.getByRole('meter', { name: 'Clamped' });
    expect(meter).toHaveAttribute('aria-valuenow', '0');
  });

  it('fills only the green zone at -30dB', () => {
    const { container } = render(<AudioMeter levelDb={-30} peakDb={-30} />);
    expect(zoneFillPercent(container, 'ok')).toBeCloseTo(75, 1); // (-30 - -60) / (-20 - -60)
    expect(zoneFillPercent(container, 'warn')).toBeCloseTo(0, 1);
    expect(zoneFillPercent(container, 'hot')).toBeCloseTo(0, 1);
  });

  it('fills green fully and partially fills yellow at -15dB', () => {
    const { container } = render(<AudioMeter levelDb={-15} peakDb={-15} />);
    expect(zoneFillPercent(container, 'ok')).toBeCloseTo(100, 1);
    expect(zoneFillPercent(container, 'warn')).toBeCloseTo((5 / 11) * 100, 1); // (-15 - -20) / (-9 - -20)
    expect(zoneFillPercent(container, 'hot')).toBeCloseTo(0, 1);
  });

  it('fills green and yellow fully and partially fills red at -3dB', () => {
    const { container } = render(<AudioMeter levelDb={-3} peakDb={-3} />);
    expect(zoneFillPercent(container, 'ok')).toBeCloseTo(100, 1);
    expect(zoneFillPercent(container, 'warn')).toBeCloseTo(100, 1);
    expect(zoneFillPercent(container, 'hot')).toBeCloseTo((6 / 9) * 100, 1); // (-3 - -9) / (0 - -9)
  });

  it('positions the peak-hold marker proportionally to its dB value', () => {
    const { container } = render(<AudioMeter levelDb={-30} peakDb={-9} />);
    const peak = container.querySelector('.audio-meter-peak') as HTMLElement;
    expect(parseFloat(peak.style.left)).toBeCloseTo(dbToFraction(-9) * 100, 1);
  });

  it('renders vertical orientation with a bottom-anchored peak marker', () => {
    const { container } = render(<AudioMeter levelDb={-20} peakDb={-10} orientation="vertical" />);
    expect(container.querySelector('.audio-meter--vertical')).not.toBeNull();
    const peak = container.querySelector('.audio-meter-peak') as HTMLElement;
    expect(peak.style.bottom).not.toBe('');
    expect(peak.style.left).toBe('');
  });

  it('omits tick labels by default and renders them when requested', () => {
    const { container, rerender } = render(<AudioMeter levelDb={-20} peakDb={-20} />);
    expect(container.querySelector('.audio-meter-ticks')).toBeNull();

    rerender(<AudioMeter levelDb={-20} peakDb={-20} ticks />);
    const ticks = container.querySelectorAll('.audio-meter-tick');
    expect(Array.from(ticks).map((tick) => tick.textContent)).toEqual(['−60', '−40', '−20', '−9', '0']);
  });
});
