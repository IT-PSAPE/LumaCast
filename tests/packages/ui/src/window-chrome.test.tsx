import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TITLE_BAR_HEIGHT, TITLE_BAR_INSET_LEFT_DARWIN, TITLE_BAR_INSET_RIGHT_OVERLAY } from '@lumacast/kernel';
import { WindowChrome } from '@lumacast/ui';

afterEach(cleanup);

const bar = () => screen.getByRole('banner');

function renderBar(platform: 'darwin' | 'win32' | 'linux', height?: number) {
  return render(
    <WindowChrome platform={platform} height={height}>
      <WindowChrome.Start><button type="button">Menu</button></WindowChrome.Start>
      <WindowChrome.Center>Title</WindowChrome.Center>
      <WindowChrome.End><button type="button">Chip</button></WindowChrome.End>
    </WindowChrome>,
  );
}

describe('WindowChrome', () => {
  it('darwin clears the traffic lights at the start only', () => {
    renderBar('darwin');
    expect(bar().style.paddingLeft).toBe(`${TITLE_BAR_INSET_LEFT_DARWIN}px`);
    expect(bar().style.paddingRight).toBe('12px');
  });

  it.each(['win32', 'linux'] as const)('%s clears the caption buttons at the end', (platform) => {
    renderBar(platform);
    expect(bar().style.paddingLeft).toBe('8px');
    expect(bar().style.paddingRight).toBe(`${TITLE_BAR_INSET_RIGHT_OVERLAY}px`);
    expect(bar().getAttribute('data-platform')).toBe(platform);
  });

  it('is a drag region while interactive slots are no-drag', () => {
    renderBar('win32');
    expect(bar().className).toContain('[-webkit-app-region:drag]');
    expect(bar().className).not.toContain('no-drag');
    expect(screen.getByRole('button', { name: 'Menu' }).parentElement?.className).toContain('no-drag');
    expect(screen.getByRole('button', { name: 'Chip' }).parentElement?.className).toContain('no-drag');
    expect(screen.getByText('Title').className).toContain('[-webkit-app-region:drag]');
  });

  it('offers escape hatches per slot', () => {
    render(
      <WindowChrome platform="linux">
        <WindowChrome.Start draggable>Text</WindowChrome.Start>
        <WindowChrome.Center interactive>Search</WindowChrome.Center>
      </WindowChrome>,
    );
    expect(screen.getByText('Text').className).not.toContain('no-drag');
    expect(screen.getByText('Search').className).toContain('no-drag');
  });

  it('places Start, Center, End in order', () => {
    renderBar('darwin');
    const slots = Array.from(bar().children).map((c) => c.getAttribute('data-slot'));
    expect(slots).toEqual(['start', 'center', 'end']);
    expect(screen.getByRole('button', { name: 'Chip' }).parentElement?.className).toContain('ml-auto');
  });

  it('defaults and overrides height', () => {
    const { unmount } = renderBar('win32');
    expect(bar().style.height).toBe(`${TITLE_BAR_HEIGHT}px`);
    unmount();
    renderBar('win32', 48);
    expect(bar().style.height).toBe('48px');
    expect(bar().style.minHeight).toBe('48px');
  });
});
