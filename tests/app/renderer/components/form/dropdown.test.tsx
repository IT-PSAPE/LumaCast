import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Dropdown } from '../../../../../app/renderer/components/form/dropdown';

const overlayStack = {
  rootElement: null as HTMLElement | null,
  stack: [] as string[],
  baseZIndex: 1000,
  register: vi.fn(),
  unregister: vi.fn(),
};

vi.mock('@renderer/contexts/workbench-context', () => ({
  useWorkbench: () => ({ state: {}, actions: {}, overlayStack }),
}));

// Base UI moves focus on an animation frame, so keyboard assertions have to let
// the frame (and any queued microtasks) run first.
async function settle() {
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 50); }); });
}

function pressKey(key: string) {
  fireEvent.keyDown(document.activeElement ?? document.body, { key });
}

function Harness({ onPick = () => undefined }: { onPick?: (label: string) => void }) {
  return (
    <Dropdown className="w-full">
      <Dropdown.Trigger aria-label="Sort by">Newest</Dropdown.Trigger>
      <Dropdown.Panel placement="bottom-end" className="min-w-64">
        <Dropdown.Item onClick={() => onPick('Newest')}>Newest</Dropdown.Item>
        <Dropdown.Item onClick={() => onPick('Oldest')}>Oldest</Dropdown.Item>
        <Dropdown.Separator />
        <Dropdown.Item disabled onClick={() => onPick('Name')}>Name</Dropdown.Item>
      </Dropdown.Panel>
    </Dropdown>
  );
}

beforeEach(() => {
  overlayStack.register.mockClear();
  overlayStack.unregister.mockClear();
  overlayStack.rootElement = null;
});

afterEach(cleanup);

describe('Dropdown', () => {
  it('gives the trigger menu-button semantics', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Sort by' });

    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not open a disabled trigger', async () => {
    render(<Dropdown><Dropdown.Trigger disabled aria-label="Model">Selected</Dropdown.Trigger><Dropdown.Panel><Dropdown.Item>Other</Dropdown.Item></Dropdown.Panel></Dropdown>);
    const trigger = screen.getByRole('button', { name: 'Model' });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    await settle();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens on click with menu/menuitem roles and the app overlay conventions', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Sort by' }));
    await settle();

    const panel = screen.getByRole('menu');
    expect(panel.dataset.popoverContent).toBe('true');
    expect(panel.className).toContain('pointer-events-auto');
    expect(panel.className).toContain('min-w-64');
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Newest', 'Oldest', 'Name']);
    expect(screen.getByRole('separator')).not.toBeNull();
    expect(screen.getByText('Name').getAttribute('data-disabled')).toBe('');
    expect(overlayStack.register).toHaveBeenCalledTimes(1);
  });

  it('portals into the overlay root on a pointer-events-none layer', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    overlayStack.rootElement = root;

    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Sort by' }));
    await settle();

    expect(root.contains(screen.getByRole('menu'))).toBe(true);
    expect(root.querySelector('[data-base-ui-portal]')?.className).toContain('pointer-events-none');

    root.remove();
  });

  it('opens from the keyboard and navigates with the arrow keys', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Sort by' });
    trigger.focus();

    pressKey('ArrowDown');
    await settle();
    expect(screen.getByRole('menu')).not.toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    pressKey('ArrowDown');
    await settle();
    expect(document.activeElement?.textContent).toBe('Oldest');

    pressKey('Home');
    await settle();
    expect(document.activeElement?.textContent).toBe('Newest');
  });

  it('runs the item callback and closes', async () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sort by' }));
    await settle();

    fireEvent.click(screen.getByText('Oldest'));
    await settle();

    expect(onPick).toHaveBeenCalledWith('Oldest');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('ignores a disabled item', async () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sort by' }));
    await settle();

    fireEvent.click(screen.getByText('Name'));
    await settle();

    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).not.toBeNull();
  });

  it('closes on Escape, returns focus to the trigger and leaves the overlay stack', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Sort by' });
    trigger.focus();
    fireEvent.click(trigger);
    await settle();

    pressKey('Escape');
    await settle();

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(overlayStack.unregister).toHaveBeenCalledTimes(1);
  });
});
