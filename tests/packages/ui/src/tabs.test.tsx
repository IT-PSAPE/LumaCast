import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Tabs } from '@lumacast/ui';

afterEach(cleanup);

function Fixture() {
  return (
    <Tabs value="a" onValueChange={() => {}} aria-label="Root name" aria-describedby="hint">
      <Tabs.List aria-label="List">
        <Tabs.Tab value="a" aria-label="Tab A" aria-describedby="hint">A</Tabs.Tab>
        <Tabs.Tab value="b">B</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="a" aria-describedby="hint">Panel A</Tabs.Panel>
    </Tabs>
  );
}

describe('Tabs aria passthrough', () => {
  it('forwards aria props to root, tab and panel', () => {
    render(<Fixture />);
    expect(screen.getByRole('tab', { name: 'Tab A' }).getAttribute('aria-describedby')).toBe('hint');
    expect(screen.getByRole('tabpanel').getAttribute('aria-describedby')).toBe('hint');
    expect(document.querySelector('[aria-label="Root name"]')).not.toBeNull();
  });

  it('keeps the Base UI tab/panel pairing intact', () => {
    render(<Fixture />);
    const tab = screen.getByRole('tab', { name: 'Tab A' });
    const panel = screen.getByRole('tabpanel');
    expect(panel.id).toBeTruthy();
    expect(tab.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(tab.id);
  });

  it('a caller aria-labelledby on the panel replaces the tab label', () => {
    render(
      <Tabs value="a" onValueChange={() => {}}>
        <Tabs.List aria-label="L"><Tabs.Tab value="a">A</Tabs.Tab></Tabs.List>
        <Tabs.Panel value="a" aria-labelledby="custom">P</Tabs.Panel>
      </Tabs>,
    );
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('custom');
  });
});
