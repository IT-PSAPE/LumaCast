import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PlainButton } from '@lumacast/ui';

afterEach(cleanup);

describe('PlainButton', () => {
  it('always carries the btn class and merges caller classes after it', () => {
    render(<PlainButton>Take</PlainButton>);
    const button = screen.getByRole('button', { name: 'Take' });
    expect(button).toHaveClass('btn');
  });

  it('keeps extra classes alongside btn', () => {
    render(<PlainButton className="danger wide">Take</PlainButton>);
    const button = screen.getByRole('button', { name: 'Take' });
    expect(button).toHaveClass('btn');
    expect(button).toHaveClass('danger');
    expect(button).toHaveClass('wide');
  });

  it('forwards native button props and click handling', () => {
    const onClick = vi.fn();
    render(
      <PlainButton type="button" disabled={false} onClick={onClick}>
        Take
      </PlainButton>,
    );
    const button = screen.getByRole('button', { name: 'Take' });
    expect(button.tagName).toBe('BUTTON');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps btn alongside classes from a Base UI state callback', () => {
    render(
      <PlainButton className={(state) => (state.disabled ? 'is-disabled' : 'is-live')}>
        Take
      </PlainButton>,
    );
    const button = screen.getByRole('button', { name: 'Take' });
    expect(button).toHaveClass('btn');
    expect(button).toHaveClass('is-live');

    cleanup();
    render(
      <PlainButton disabled className={(state) => (state.disabled ? 'is-disabled' : 'is-live')}>
        Take
      </PlainButton>,
    );
    const disabledButton = screen.getByRole('button', { name: 'Take' });
    expect(disabledButton).toHaveClass('btn');
    expect(disabledButton).toHaveClass('is-disabled');
  });
});
