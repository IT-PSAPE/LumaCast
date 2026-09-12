import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Accordion, useAccordionItem } from '../../../../../app/renderer/components/display/accordion';

afterEach(cleanup);

function ItemStateProbe() {
  const { value, isOpen } = useAccordionItem();
  return <span data-testid={`probe-${value}`}>{isOpen ? 'open' : 'closed'}</span>;
}

function TwoSections({ type = 'single', onValueChange }: { type?: 'single' | 'multiple'; onValueChange?: (value: string | string[]) => void }) {
  const [value, setValue] = useState<string | string[]>(type === 'multiple' ? [] : '');
  return (
    <Accordion
      type={type}
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onValueChange?.(next);
      }}
    >
      <Accordion.Item value="one">
        <Accordion.Trigger>Section One</Accordion.Trigger>
        <Accordion.Content>Content one</Accordion.Content>
        <ItemStateProbe />
      </Accordion.Item>
      <Accordion.Item value="two">
        <Accordion.Trigger>Section Two</Accordion.Trigger>
        <Accordion.Content>Content two</Accordion.Content>
        <ItemStateProbe />
      </Accordion.Item>
    </Accordion>
  );
}

describe('Accordion', () => {
  it('renders a button per trigger with aria-expanded and a labelled region panel', () => {
    render(<TwoSections />);
    const trigger = screen.getByRole('button', { name: 'Section One' });
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    const region = screen.getAllByRole('region', { hidden: true })[0];
    expect(region.getAttribute('aria-labelledby')).toBe(trigger.id);
    expect(region.textContent).toBe('Content one');
  });

  it('single mode: opening one item closes the other', () => {
    render(<TwoSections />);
    fireEvent.click(screen.getByRole('button', { name: 'Section One' }));
    expect(screen.getByRole('button', { name: 'Section One' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('probe-one').textContent).toBe('open');

    fireEvent.click(screen.getByRole('button', { name: 'Section Two' }));
    expect(screen.getByRole('button', { name: 'Section One' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: 'Section Two' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('probe-one').textContent).toBe('closed');
    expect(screen.getByTestId('probe-two').textContent).toBe('open');
  });

  it('multiple mode: both items can stay open at once', () => {
    const onValueChange = vi.fn();
    render(<TwoSections type="multiple" onValueChange={onValueChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Section One' }));
    fireEvent.click(screen.getByRole('button', { name: 'Section Two' }));
    expect(screen.getByRole('button', { name: 'Section One' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Section Two' }).getAttribute('aria-expanded')).toBe('true');
    expect(onValueChange).toHaveBeenLastCalledWith(['one', 'two']);
  });

  it('useAccordionItem throws when called outside Accordion.Item', () => {
    function Bare() {
      useAccordionItem();
      return null;
    }
    expect(() => render(<Bare />)).toThrow('Accordion.Trigger/Content must be used within Accordion.Item');
  });
});
