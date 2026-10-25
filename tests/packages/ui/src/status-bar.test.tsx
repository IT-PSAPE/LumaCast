import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StatusBar } from '@lumacast/ui';

afterEach(cleanup);

describe('StatusBar', () => {
  it('is a named contentinfo landmark with one fixed height and a top border', () => {
    render(
      <StatusBar>
        <StatusBar.Start>a</StatusBar.Start>
      </StatusBar>,
    );
    const bar = screen.getByRole('contentinfo', { name: 'Status' });
    expect(bar.className).toContain('h-7');
    expect(bar.className).toContain('border-t');
    expect(bar.className).toContain('bg-secondary');
  });

  it('accepts a custom label', () => {
    render(<StatusBar label="Stream status">x</StatusBar>);
    expect(screen.getByRole('contentinfo', { name: 'Stream status' })).toBeTruthy();
  });

  it('places start, center and end segments', () => {
    render(
      <StatusBar>
        <StatusBar.Start>s</StatusBar.Start>
        <StatusBar.Center>c</StatusBar.Center>
        <StatusBar.End>e</StatusBar.End>
      </StatusBar>,
    );
    expect(screen.getByText('s').className).toContain('justify-start');
    expect(screen.getByText('c').className).toContain('justify-center');
    expect(screen.getByText('e').className).toContain('justify-end');
  });

  it('renders plain text when static and a real button when onClick is given', () => {
    const onClick = vi.fn();
    render(
      <StatusBar>
        <StatusBar.Item>static</StatusBar.Item>
        <StatusBar.Item onClick={onClick}>action</StatusBar.Item>
      </StatusBar>,
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'action' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByText('static').tagName).toBe('SPAN');
  });

  it('applies tone classes', () => {
    render(<StatusBar.Item tone="error">bad</StatusBar.Item>);
    expect(screen.getByText('bad').className).toContain('text-error');
  });

  it('shows a spinner only when busy, replacing the icon', () => {
    const { container, rerender } = render(<StatusBar.Item icon={<i data-testid="ic" />}>work</StatusBar.Item>);
    expect(container.querySelector('.animate-spin, [class*="animate-spin"]')).toBeNull();
    expect(screen.getByTestId('ic')).toBeTruthy();
    rerender(<StatusBar.Item busy icon={<i data-testid="ic" />}>work</StatusBar.Item>);
    expect(container.querySelector('[class*="animate-spin"]')).not.toBeNull();
    expect(screen.queryByTestId('ic')).toBeNull();
  });

  it('is not live by default and is a polite status only when opted in', () => {
    const { rerender } = render(<StatusBar.Item>tick</StatusBar.Item>);
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<StatusBar.Item live>tick</StatusBar.Item>);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('renders a vertical divider', () => {
    render(<StatusBar.Divider />);
    expect(screen.getByRole('separator').getAttribute('aria-orientation')).toBe('vertical');
  });
});
