import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Sidebar } from '@lumacast/ui';

afterEach(cleanup);

describe('Sidebar', () => {
  it('is an aside landmark with a named Destinations nav', () => {
    render(
      <Sidebar>
        <Sidebar.Nav>
          <button type="button">Apps</button>
        </Sidebar.Nav>
      </Sidebar>,
    );
    const aside = screen.getByRole('complementary');
    expect(aside.tagName).toBe('ASIDE');
    expect(screen.getByRole('navigation', { name: 'Destinations' })).toBeTruthy();
  });

  it('lets Nav take a custom label', () => {
    render(
      <Sidebar>
        <Sidebar.Nav aria-label="Sound boards">x</Sidebar.Nav>
      </Sidebar>,
    );
    expect(screen.getByRole('navigation', { name: 'Sound boards' })).toBeTruthy();
  });

  it('defaults to 220px and honours an override', () => {
    const { rerender } = render(<Sidebar>x</Sidebar>);
    expect(screen.getByRole('complementary').style.width).toBe('220px');
    rerender(<Sidebar width={258}>x</Sidebar>);
    expect(screen.getByRole('complementary').style.width).toBe('258px');
  });

  it('does not render a handle unless resizable', () => {
    render(<Sidebar>x</Sidebar>);
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('resizable renders a scalar separator wired to width, min and max', () => {
    const onWidthChange = vi.fn();
    render(
      <Sidebar resizable width={240} min={180} max={300} onWidthChange={onWidthChange}>
        x
      </Sidebar>,
    );
    const handle = screen.getByRole('separator', { name: 'Resize sidebar' });
    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle).toHaveAttribute('aria-valuenow', '240');
    expect(handle).toHaveAttribute('aria-valuemin', '180');
    expect(handle).toHaveAttribute('aria-valuemax', '300');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onWidthChange).toHaveBeenLastCalledWith(250);
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    expect(onWidthChange).toHaveBeenLastCalledWith(300);
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(onWidthChange).toHaveBeenLastCalledWith(180);
  });

  it('reports width changes from a pointer drag', () => {
    const onWidthChange = vi.fn();
    render(
      <Sidebar resizable width={200} onWidthChange={onWidthChange}>
        x
      </Sidebar>,
    );
    const handle = screen.getByRole('separator');
    fireEvent.pointerDown(handle, { clientX: 200, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 230 });
    expect(onWidthChange).toHaveBeenLastCalledWith(230);
    fireEvent.pointerMove(handle, { clientX: 900 });
    expect(onWidthChange).toHaveBeenLastCalledWith(400);
    fireEvent.pointerUp(handle);
  });

  it('labels a Group with a real, non-uppercase heading', () => {
    render(
      <Sidebar>
        <Sidebar.Group label="Your boards" count={3}>
          <Sidebar.Nav aria-label="Sound boards">x</Sidebar.Nav>
        </Sidebar.Group>
      </Sidebar>,
    );
    const heading = screen.getByRole('heading', { name: 'Your boards' });
    expect(heading.tagName).toBe('H2');
    expect(heading.className).not.toContain('uppercase');
    expect(screen.getByRole('region', { name: 'Your boards' })).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('pins Footer below a scrolling body even when declared first', () => {
    render(
      <Sidebar>
        <Sidebar.Footer>footer</Sidebar.Footer>
        <Sidebar.Nav>nav</Sidebar.Nav>
      </Sidebar>,
    );
    const aside = screen.getByRole('complementary');
    const nav = screen.getByRole('navigation');
    const footer = screen.getByText('footer');
    const body = nav.parentElement as HTMLElement;
    expect(body.className).toContain('overflow-y-auto');
    expect(body.className).toContain('min-h-0');
    expect(body.className).toContain('flex-1');
    expect(footer.className).toContain('shrink-0');
    expect(footer.parentElement).toBe(aside);
    expect(footer.contains(nav)).toBe(false);
    expect(aside.lastElementChild).toBe(footer);
    expect(aside.className).not.toContain('overflow-y-auto');
    expect(aside.className).toContain('flex-col');
  });

  it('merges className and passes DOM props to the root', () => {
    render(
      <Sidebar className="custom" data-testid="s">
        x
      </Sidebar>,
    );
    expect(screen.getByTestId('s').className).toContain('custom');
  });
});
