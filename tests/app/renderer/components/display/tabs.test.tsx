import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Tabs } from '../../../../../app/renderer/components/display/tabs';

afterEach(cleanup);

function FruitTabs({ activationMode, onValueChange }: { activationMode?: 'automatic' | 'manual'; onValueChange?: (value: string) => void }) {
  const [value, setValue] = useState('a');
  return (
    <Tabs.Root
      value={value}
      activationMode={activationMode}
      onValueChange={(next) => {
        setValue(next);
        onValueChange?.(next);
      }}
    >
      <Tabs.List label="Fruit tabs">
        <Tabs.Trigger value="a">Apple</Tabs.Trigger>
        <Tabs.Trigger value="b">Banana</Tabs.Trigger>
        <Tabs.Trigger value="c">Cherry</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Panel value="a">Apple panel</Tabs.Panel>
      <Tabs.Panel value="b">Banana panel</Tabs.Panel>
      <Tabs.Panel value="c">Cherry panel</Tabs.Panel>
    </Tabs.Root>
  );
}

describe('Tabs', () => {
  it('renders tablist/tab/tabpanel roles with the active tab selected', () => {
    render(<FruitTabs />);
    expect(screen.getByRole('tablist', { name: 'Fruit tabs' })).toBeTruthy();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Apple', 'Banana', 'Cherry']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tabpanel').textContent).toBe('Apple panel');
  });

  it('clicking a trigger activates its panel and fires onValueChange with a plain string', () => {
    const onValueChange = vi.fn();
    render(<FruitTabs onValueChange={onValueChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Banana' }));
    expect(onValueChange).toHaveBeenCalledWith('b');
    expect(screen.getByRole('tab', { name: 'Banana' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('Banana panel');
  });

  it('automatic activation: arrow-key navigation moves focus and switches the active tab', async () => {
    render(<FruitTabs />);
    const apple = screen.getByRole('tab', { name: 'Apple' });
    apple.focus();
    fireEvent.keyDown(apple, { key: 'ArrowRight' });
    // Base UI's composite roving focus moves the actual DOM focus in a queued
    // microtask (it waits for its FocusManager's `returnFocus` to run first).
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Banana'));
    expect(screen.getByRole('tab', { name: 'Banana' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('Banana panel');
  });

  it('automatic activation: Home/End jump to the first/last tab', async () => {
    render(<FruitTabs />);
    const apple = screen.getByRole('tab', { name: 'Apple' });
    apple.focus();
    fireEvent.keyDown(apple, { key: 'End' });
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Cherry'));
    fireEvent.keyDown(document.activeElement as Element, { key: 'Home' });
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Apple'));
  });

  it('manual activation: arrow keys move focus without switching tabs; Space activates the focused tab', async () => {
    const onValueChange = vi.fn();
    render(<FruitTabs activationMode="manual" onValueChange={onValueChange} />);
    const apple = screen.getByRole('tab', { name: 'Apple' });
    apple.focus();
    fireEvent.keyDown(apple, { key: 'ArrowRight' });
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Banana'));
    // Focus moved but the selection (and onValueChange) must not have followed it.
    expect(screen.getByRole('tab', { name: 'Apple' }).getAttribute('aria-selected')).toBe('true');
    expect(onValueChange).not.toHaveBeenCalled();

    // Real buttons activate on Enter too, via the browser's native click-on-Enter
    // behaviour; jsdom doesn't simulate that default action, so Space (which Base
    // UI's composite items dispatch a click for explicitly) is what this test can
    // drive directly.
    fireEvent.keyDown(document.activeElement as Element, { key: ' ' });
    expect(onValueChange).toHaveBeenCalledWith('b');
    expect(screen.getByRole('tab', { name: 'Banana' }).getAttribute('aria-selected')).toBe('true');
  });
});
