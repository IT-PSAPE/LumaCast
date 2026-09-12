import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { CheckerboardBackdrop } from '../../../../../app/renderer/components/display/checkerboard-backdrop';
import { SceneFrame } from '../../../../../app/renderer/components/display/scene-frame';

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub);

afterEach(cleanup);

function checkerboardClassName(container: HTMLElement): string {
  const checkerboard = [...container.querySelectorAll('div')]
    .find((element) => element.className.includes('repeating-conic-gradient'));
  expect(checkerboard).toBeTruthy();
  return checkerboard?.className ?? '';
}

describe('SceneFrame checkerboard', () => {
  it.each(['fill', 'contain'] as const)(
    'alternates secondary and tertiary surfaces in %s mode',
    (fit) => {
      const { container } = render(
        <SceneFrame width={1920} height={1080} fit={fit} checkerboard>
          <div />
        </SceneFrame>,
      );

      const className = checkerboardClassName(container);
      expect(className).toContain('var(--background-color-secondary)');
      expect(className).toContain('var(--background-color-tertiary)');
    },
  );

  it('supports the compact checker size used by media previews', () => {
    const { container } = render(<CheckerboardBackdrop size={16} />);

    const className = checkerboardClassName(container);
    expect(className).toContain('var(--background-color-secondary)');
    expect(className).toContain('var(--background-color-tertiary)');
    expect(className).toContain('bg-[length:16px_16px]');
  });
});
