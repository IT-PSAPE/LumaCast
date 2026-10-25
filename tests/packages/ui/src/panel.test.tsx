import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Panel } from '@lumacast/ui';

afterEach(cleanup);

const full = (density?: 'compact' | 'comfortable') => (
  <Panel aria-label="Scenes" density={density}>
    <Panel.Header>
      <Panel.HeaderTitle icon={<svg data-testid="icon" />}>Scenes</Panel.HeaderTitle>
      <Panel.HeaderActions><button>Add</button></Panel.HeaderActions>
    </Panel.Header>
    <Panel.Subheader>Filters</Panel.Subheader>
    <Panel.Body>Content</Panel.Body>
    <Panel.Footer>
      <Panel.Footer.Start>Left</Panel.Footer.Start>
      <Panel.Footer.End>Right</Panel.Footer.End>
    </Panel.Footer>
  </Panel>
);

describe('Panel', () => {
  it('renders every slot', () => {
    render(full());
    expect(screen.getByRole('heading', { name: 'Scenes' })).toBeTruthy();
    expect(screen.getByTestId('icon')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
    for (const text of ['Filters', 'Content', 'Left', 'Right']) expect(screen.getByText(text)).toBeTruthy();
  });

  it('is a named region with header and footer landmarks as real elements', () => {
    const { container } = render(full());
    expect(screen.getByRole('region', { name: 'Scenes' })).toBeTruthy();
    expect(container.querySelector('section > header')).not.toBeNull();
    expect(container.querySelector('section > footer')).not.toBeNull();
  });

  it('fills its container as a column', () => {
    render(full());
    const root = screen.getByRole('region');
    expect(root.className).toMatch(/\bflex-col\b/);
    expect(root.className).toMatch(/\bh-full\b/);
  });

  it('Body shrinks and scrolls in a flex column by default', () => {
    render(full());
    const body = screen.getByText('Content');
    expect(body.className).toMatch(/\bmin-h-0\b/);
    expect(body.className).toMatch(/\bflex-1\b/);
    expect(body.className).toMatch(/\boverflow-y-auto\b/);
  });

  it('Body can opt out of scrolling and add padding', () => {
    render(<Panel><Panel.Body scroll={false} padded>X</Panel.Body></Panel>);
    const body = screen.getByText('X');
    expect(body.className).not.toMatch(/overflow-y-auto/);
    expect(body.className).toMatch(/\boverflow-hidden\b/);
    expect(body.className).toMatch(/\bp-3\b/);
  });

  it('Subheader stacks directly below Header', () => {
    render(full());
    const header = screen.getByRole('heading').closest('header') as HTMLElement;
    expect(header.nextElementSibling?.textContent).toBe('Filters');
    expect(header.nextElementSibling?.tagName).toBe('DIV');
  });

  it('places footer segments start then end, end pushed trailing', () => {
    render(full());
    const left = screen.getByText('Left');
    const right = screen.getByText('Right');
    expect(left.nextElementSibling).toBe(right);
    expect(right.className).toMatch(/\bml-auto\b/);
    expect(left.parentElement?.tagName).toBe('FOOTER');
  });

  it('density changes header and subheader height', () => {
    const { rerender } = render(full('compact'));
    const header = () => screen.getByRole('heading').closest('header') as HTMLElement;
    expect(header().className).toMatch(/\bh-8\b/);
    expect(screen.getByText('Filters').className).toMatch(/\bh-7\b/);
    rerender(full('comfortable'));
    expect(header().className).toMatch(/\bh-10\b/);
    expect(screen.getByText('Filters').className).toMatch(/\bh-9\b/);
  });

  it('header border is optional', () => {
    render(<Panel><Panel.Header divided={false}><Panel.HeaderTitle>T</Panel.HeaderTitle></Panel.Header></Panel>);
    expect(screen.getByRole('heading').closest('header')?.className).not.toMatch(/border-b/);
  });

  // HeaderTitle deliberately has no `count`. A tally beside a title restates
  // the list below it, and once the prop existed it spread — soundboard showed
  // the same number four times on one screen.
  it('renders no count badge beside the title', () => {
    render(<Panel><Panel.Header><Panel.HeaderTitle>Scenes</Panel.HeaderTitle></Panel.Header></Panel>);
    const header = screen.getByRole('heading', { name: 'Scenes' }).closest('header')!;
    expect(header.textContent).toBe('Scenes');
  });

  it('root fills by default; fill={false} sizes to content', () => {
    const { rerender } = render(<Panel aria-label="p">x</Panel>);
    expect(screen.getByLabelText('p').className).toContain('h-full');
    rerender(<Panel aria-label="p" fill={false}>x</Panel>);
    expect(screen.getByLabelText('p').className).not.toContain('h-full');
  });

  it('header is fixed-height by default; height="auto" uses a min height', () => {
    const { rerender } = render(<Panel><Panel.Header>H</Panel.Header></Panel>);
    expect(screen.getByRole('banner').className).toContain('h-10');
    rerender(<Panel><Panel.Header height="auto">H</Panel.Header></Panel>);
    let cls = screen.getByRole('banner').className;
    expect(cls).toContain('min-h-10');
    expect(cls).not.toMatch(/(^|\s)h-10/);
    rerender(<Panel density="compact"><Panel.Header>H</Panel.Header></Panel>);
    expect(screen.getByRole('banner').className).toContain('h-8');
    rerender(<Panel density="compact"><Panel.Header height="auto">H</Panel.Header></Panel>);
    cls = screen.getByRole('banner').className;
    expect(cls).toContain('min-h-8');
    expect(cls).not.toMatch(/(^|\s)h-8/);
  });
});
