import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Section } from '@lumacast/ui';

afterEach(cleanup);

function Fixture(props: { collapsible?: boolean; defaultOpen?: boolean; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  return (
    <Section {...props}>
      <Section.Header>
        <Section.Title>Transform</Section.Title>
        <Section.Actions>
          <button type="button">Reset</button>
        </Section.Actions>
      </Section.Header>
      <Section.Body>
        <Section.Row label="Width" htmlFor="w">
          <input id="w" />
        </Section.Row>
      </Section.Body>
    </Section>
  );
}

describe('Section', () => {
  it('non-collapsible renders title, actions and body without a disclosure button', () => {
    render(<Fixture />);
    expect(screen.getByRole('heading', { name: 'Transform' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Transform' })).toBeNull();
    expect(screen.getByLabelText('Width')).toBeTruthy();
  });

  it('collapsible toggles through the shared Accordion trigger', () => {
    const onOpenChange = vi.fn();
    render(<Fixture collapsible onOpenChange={onOpenChange} />);
    const trigger = screen.getByRole('button', { name: 'Transform' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('honours defaultOpen=false', () => {
    render(<Fixture collapsible defaultOpen={false} />);
    expect(screen.getByRole('button', { name: 'Transform' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('controlled open wins until the parent changes it', () => {
    const { rerender } = render(<Fixture collapsible open={false} />);
    const trigger = screen.getByRole('button', { name: 'Transform' });
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    rerender(<Fixture collapsible open />);
    expect(screen.getByRole('button', { name: 'Transform' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('actions are not inside the collapse trigger', () => {
    render(<Fixture collapsible />);
    const reset = screen.getByRole('button', { name: 'Reset' });
    expect(reset.closest('[aria-expanded]')).toBeNull();
  });
});

describe('Section.Row', () => {
  it('inline: label names the control and sets the label width variable', () => {
    const { container } = render(
      <Section.Row label="Opacity" htmlFor="o" labelWidth={80}>
        <input id="o" />
      </Section.Row>,
    );
    expect(screen.getByLabelText('Opacity')).toBeTruthy();
    expect((container.firstElementChild as HTMLElement).style.getPropertyValue('--section-label-w')).toBe('80px');
  });

  it('stacked: label above control, no inline width class', () => {
    const { container } = render(
      <Section.Row label="Notes" htmlFor="n" layout="stacked">
        <input id="n" />
      </Section.Row>,
    );
    expect(container.querySelector('label')).toBeTruthy();
    expect(container.innerHTML).not.toContain('section-label-w)]');
    expect(container.querySelector('.flex-col')).toBeTruthy();
  });

  it('forwards error to Field with an alert', () => {
    render(
      <Section.Row label="Name" htmlFor="x" error="Required">
        <input id="x" />
      </Section.Row>,
    );
    expect(screen.getByRole('alert').textContent).toBe('Required');
  });

describe('Section.Row columns and label-less', () => {
  it('default single-control row has no grid', () => {
    const { container } = render(<Section.Row label="A" htmlFor="a"><input id="a" /></Section.Row>);
    expect(container.querySelector('.grid-cols-2')).toBeNull();
  });

  it('columns={2} lays children out in a two-column grid inside the Field', () => {
    const { container } = render(
      <Section.Row label="Pos" columns={2}>
        <input aria-label="x" />
        <input aria-label="y" />
      </Section.Row>,
    );
    const grid = container.querySelector('.grid-cols-2');
    expect(grid?.children.length).toBe(2);
    expect(screen.getByText('Pos')).toBeTruthy();
  });

  it('omitting label renders just the grid, with no label element', () => {
    const { container } = render(
      <Section.Row columns={2} className="extra">
        <input aria-label="font" />
        <input aria-label="weight" />
      </Section.Row>,
    );
    expect(container.querySelector('label')).toBeNull();
    expect(container.querySelector('.grid-cols-2')?.children.length).toBe(2);
    expect(container.firstElementChild?.className).toContain('extra');
  });
});
});
