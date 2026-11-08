import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DropdownMenu } from '@lumacast/ui';

async function settle() {
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 50); }); });
}

afterEach(cleanup);

async function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  await settle();
}

describe('DropdownMenu', () => {
  it('renders entries as a normal menu and keeps the trigger ARIA', async () => {
    render(<DropdownMenu trigger={<button type="button">Open</button>} entries={[{ id: 'a', label: 'Alpha' }]} />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await openMenu();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu', { name: 'Open' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Alpha' })).toBeTruthy();
  });

  it('uses an explicit popup label while preserving the trigger name', async () => {
    render(<DropdownMenu label="Source actions" trigger={<button type="button" aria-label="More source actions" />} entries={[{ id: 'a', label: 'Alpha' }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'More source actions' }));
    await settle();
    expect(screen.getByRole('menu', { name: 'Source actions' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'More source actions' })).toBeTruthy();
  });

  it('renders MenuItem.icon', async () => {
    render(<DropdownMenu trigger={<button type="button">Open</button>} entries={[{ id: 'a', label: 'Alpha', icon: <svg data-testid="icon" /> }]} />);
    await openMenu();
    expect(screen.getByTestId('icon')).toBeTruthy();
  });

  it('renders children inside the same menu surface', async () => {
    render(<DropdownMenu trigger={<button type="button">Open</button>}><p>Preview row</p></DropdownMenu>);
    await openMenu();
    const content = screen.getByText('Preview row');
    expect(content.closest('[role="menu"]')).toBeTruthy();
  });

  it('render-prop close dismisses the menu', async () => {
    render(
      <DropdownMenu trigger={<button type="button">Open</button>}>
        {({ close }) => <button type="button" onClick={close}>Done</button>}
      </DropdownMenu>,
    );
    await openMenu();
    fireEvent.click(screen.getByText('Done'));
    await settle();
    expect(screen.queryByText('Done')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open' }).getAttribute('aria-expanded')).toBe('false');
  });
});
