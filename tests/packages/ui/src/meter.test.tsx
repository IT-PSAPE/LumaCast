import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Meter, type MeterProps, type MeterZone } from '@lumacast/ui';

afterEach(cleanup);

type MeterTick = NonNullable<MeterProps['ticks']>[number];

const ZONES: MeterZone[] = [
  { from: -60, tone: 'success' },
  { from: -20, tone: 'warning' },
  { from: -9, tone: 'error' },
];
const TICKS: MeterTick[] = [{ value: -60, label: '-60' }, { value: -20, label: '-20' }, { value: 0, label: '0' }];
const fillOf = () => screen.getByRole('meter').firstElementChild as HTMLElement;

describe('Meter ARIA contract', () => {
  it('exposes role=meter with value bounds and label', () => {
    render(<Meter value={-30} min={-60} max={0} label="Audio level" zones={ZONES} fill="banded" ticks={TICKS} />);
    const m = screen.getByRole('meter', { name: 'Audio level' });
    expect(m.getAttribute('aria-valuemin')).toBe('-60');
    expect(m.getAttribute('aria-valuemax')).toBe('0');
    expect(m.getAttribute('aria-valuenow')).toBe('-30');
  });

  it('clamps aria-valuenow', () => {
    render(<Meter value={500} />);
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('100');
  });
});

describe('Meter solid (default)', () => {
  it('colours the whole fill by the current zone and scales it', () => {
    render(<Meter value={-30} min={-60} max={0} zones={ZONES} />);
    const fill = fillOf();
    expect(fill.className).toContain('bg-success');
    expect(fill.style.transform).toBe('scaleX(0.5)');
    expect(fill.style.clipPath).toBe('');
    expect(fill.style.backgroundImage).toBe('');
  });

  it('switches colour with the zone', () => {
    render(<Meter value={-5} min={-60} max={0} zones={ZONES} />);
    expect(fillOf().className).toContain('bg-error');
  });

  it('has no transition by default', () => {
    render(<Meter value={10} />);
    expect(fillOf().className).not.toContain('transition');
    expect(fillOf().style.transitionDuration).toBe('');
  });
});

describe('Meter banded', () => {
  const renderBanded = (value: number, extra: Partial<MeterProps> = {}) => {
    render(<Meter value={value} min={-60} max={0} zones={ZONES} fill="banded" {...extra} />);
    return fillOf();
  };

  it('paints every zone in its own colour via one static gradient', () => {
    const fill = renderBanded(-30);
    const bg = fill.style.backgroundImage;
    expect(bg).toContain('var(--color-success)');
    expect(bg).toContain('var(--color-warning)');
    expect(bg).toContain('var(--color-error)');
    // -20 is 2/3 of the way up the -60..0 axis, -9 is 85%.
    expect(bg).toContain('66.666');
    expect(bg).toContain('85%');
    expect(fill.style.transform).toBe('');
  });

  it('reveals only up to the level, leaving the gradient unchanged', () => {
    const a = renderBanded(-30);
    const bgA = a.style.backgroundImage;
    const clipA = a.style.clipPath;
    cleanup();
    const b = renderBanded(-5);
    expect(clipA).toBe('inset(0 50% 0 0)');
    expect(b.style.clipPath).toMatch(/^inset\(0 8\.3\d*% 0 0\)$/);
    expect(b.style.backgroundImage).toBe(bgA);
  });

  it('reveals nothing at min and everything at max', () => {
    expect(renderBanded(-60).style.clipPath).toBe('inset(0 100% 0 0)');
    cleanup();
    expect(renderBanded(0).style.clipPath).toBe('inset(0 0% 0 0)');
  });

  it('reveals from the bottom when vertical', () => {
    const fill = renderBanded(-30, { orientation: 'vertical' });
    expect(fill.style.clipPath).toBe('inset(50% 0 0 0)');
    expect(fill.style.backgroundImage).toContain('to top');
  });
});

describe('Meter zoneGap', () => {
  it('adds transparent gaps at interior zone boundaries only when set', () => {
    render(<Meter value={-5} min={-60} max={0} zones={ZONES} fill="banded" />);
    expect(fillOf().style.backgroundImage).not.toContain('transparent');
    cleanup();
    render(<Meter value={-5} min={-60} max={0} zones={ZONES} fill="banded" zoneGap={2} />);
    const bg = fillOf().style.backgroundImage;
    expect(bg.match(/transparent/g)?.length).toBe(2);
    expect(bg).toContain('1px');
  });
});

describe('Meter ticks', () => {
  it('renders labels hidden from the accessibility tree', () => {
    const { container } = render(<Meter value={-30} min={-60} max={0} ticks={TICKS} label="L" />);
    const hidden = container.querySelector('[aria-hidden="true"]');
    expect(hidden?.textContent).toContain('-60');
    expect(hidden?.textContent).toContain('-20');
    expect(hidden?.textContent).toContain('0');
    expect(screen.getByRole('meter').textContent).toBe('');
    expect(screen.queryByText('-20')).not.toBeNull();
    expect(screen.queryByText('-20', { selector: '[aria-hidden="true"] *' })).not.toBeNull();
  });

  it('positions ticks along the axis', () => {
    const { container } = render(<Meter value={0} min={-60} max={0} ticks={TICKS} />);
    const spans = container.querySelectorAll<HTMLElement>('[aria-hidden="true"] > span');
    expect(spans[0]?.style.left).toBe('0%');
    expect(spans[2]?.style.left).toBe('100%');
  });

  it('renders no tick container without ticks', () => {
    const { container } = render(<Meter value={0} />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });
});

describe('Meter smoothing', () => {
  it('is on only when asked, with a default and custom duration', () => {
    render(<Meter value={10} smoothing />);
    expect(fillOf().style.transitionDuration).toBe('80ms');
    cleanup();
    render(<Meter value={10} fill="banded" smoothing={200} />);
    expect(fillOf().style.transitionDuration).toBe('200ms');
  });

  it('is disabled under prefers-reduced-motion via motion-reduce', () => {
    render(<Meter value={10} smoothing />);
    expect(fillOf().className).toContain('motion-reduce:transition-none');
  });

  it('treats 0 and false as off', () => {
    render(<Meter value={10} smoothing={0} />);
    expect(fillOf().className).not.toContain('transition');
  });
});

describe('Meter segments', () => {
  it('lights half the blocks at the midpoint', () => {
    render(<Meter value={50} segments={10} />);
    const blocks = Array.from(screen.getByRole('meter').firstElementChild?.children ?? []);
    expect(blocks).toHaveLength(10);
    expect(blocks.filter((b) => b.className.includes('bg-brand'))).toHaveLength(5);
    expect(blocks.filter((b) => b.className.includes('bg-tertiary'))).toHaveLength(5);
  });

  it('ignores fill=banded', () => {
    render(<Meter value={100} min={-60} max={0} segments={4} zones={ZONES} fill="banded" />);
    const first = screen.getByRole('meter').firstElementChild as HTMLElement;
    expect(first.style.clipPath).toBe('');
    expect(first.children).toHaveLength(4);
  });
});
