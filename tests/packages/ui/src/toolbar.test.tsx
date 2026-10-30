import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Toolbar } from '@lumacast/ui';

afterEach(cleanup);

describe('Toolbar', () => {
  it('is a named toolbar', () => {
    render(<Toolbar label="Actions">x</Toolbar>);
    expect(screen.getByRole('toolbar', { name: 'Actions' })).toBeTruthy();
  });

  it('maps each size to one height', () => {
    const heights = { sm: 'h-9', md: 'h-12', lg: 'h-16' } as const;
    for (const size of ['sm', 'md', 'lg'] as const) {
      const { unmount } = render(<Toolbar label="t" size={size}>x</Toolbar>);
      expect(screen.getByRole('toolbar').className).toContain(heights[size]);
      unmount();
    }
  });

  it('defaults to md plain; bordered adds a bottom border', () => {
    const { rerender } = render(<Toolbar label="t">x</Toolbar>);
    const bar = () => screen.getByRole('toolbar');
    expect(bar().className).toContain('h-12');
    expect(bar().className).not.toContain('border-b');
    rerender(<Toolbar label="t" variant="bordered">x</Toolbar>);
    expect(bar().className).toContain('border-b');
  });

  it('floating reproduces the button-group pill and drops the fixed height', () => {
    render(<Toolbar label="t" variant="floating" size="lg">x</Toolbar>);
    const cls = screen.getByRole('toolbar').className;
    for (const c of ['p-1', 'gap-0.5', 'rounded-surface', 'border', 'bg-tertiary/90', 'backdrop-blur-sm', 'shadow-lg']) {
      expect(cls).toContain(c);
    }
    expect(cls).not.toContain('h-16');
  });

  it('places start, center and end segments', () => {
    render(
      <Toolbar label="t">
        <Toolbar.Start>s</Toolbar.Start>
        <Toolbar.Center>c</Toolbar.Center>
        <Toolbar.End>e</Toolbar.End>
      </Toolbar>,
    );
    expect(screen.getByText('s').className).toContain('justify-start');
    expect(screen.getByText('c').className).toContain('justify-center');
    expect(screen.getByText('e').className).toContain('justify-end');
  });

  it('groups are marked and carry the adjacent-group rule, so no manual separators are needed', () => {
    render(
      <Toolbar label="t">
        <Toolbar.Group label="One">a</Toolbar.Group>
        <Toolbar.Group label="Two">b</Toolbar.Group>
      </Toolbar>,
    );
    const groups = screen.getAllByRole('group');
    expect(groups).toHaveLength(2);
    for (const g of groups) {
      expect(g.hasAttribute('data-toolbar-group')).toBe(true);
      expect(g.className).toContain('[[data-toolbar-group]+&]:border-l');
    }
  });

  it('renders a separator and an aria-hidden spacer', () => {
    const { container } = render(
      <Toolbar label="t">
        <Toolbar.Separator />
        <Toolbar.Spacer />
      </Toolbar>,
    );
    expect(screen.getByRole('separator')).toBeTruthy();
    expect(container.querySelector('[aria-hidden="true"].flex-1')).not.toBeNull();
  });

  it('plain is transparent; surface and bordered paint bg-secondary', () => {
    const bar = () => screen.getByRole('toolbar');
    const { rerender } = render(<Toolbar label="t">x</Toolbar>);
    expect(bar().className).not.toContain('bg-secondary');
    rerender(<Toolbar label="t" variant="surface">x</Toolbar>);
    expect(bar().className).toContain('bg-secondary');
    expect(bar().className).not.toContain('border-b');
    rerender(<Toolbar label="t" variant="bordered">x</Toolbar>);
    expect(bar().className).toContain('bg-secondary');
    expect(bar().className).toContain('border-b');
  });
});
