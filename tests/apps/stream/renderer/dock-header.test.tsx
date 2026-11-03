import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Clapperboard } from 'lucide-react';
import { DockHeader } from '../../../../apps/stream/renderer/docks/dock-header';

afterEach(cleanup);

async function settle() {
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 50); }); });
}

describe('DockHeader', () => {
  it('renders the shared icon, title suffix, action slot, drag handle, and ellipsis menu', () => {
    render(
      <DockHeader
        title="Scenes"
        icon={<Clapperboard data-testid="scenes-icon" />}
        titleSuffix={<span data-testid="title-suffix">STAGED</span>}
        actions={<button type="button" aria-label="Add scene">Add</button>}
        onHide={vi.fn()}
      />,
    );

    const header = screen.getByRole('banner');
    expect(header).toHaveAttribute('data-dock-handle');
    expect(screen.getByRole('heading', { name: 'ScenesSTAGED' })).toBeInTheDocument();
    expect(screen.getByTestId('scenes-icon')).toBeInTheDocument();
    expect(screen.getByTestId('title-suffix')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add scene' })).toBeInTheDocument();

    const menuTrigger = screen.getByRole('button', { name: 'Scenes actions' });
    expect(menuTrigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(menuTrigger).toHaveAttribute('aria-expanded', 'false');
    const actionContainer = document.querySelector('.stream-dock-header__actions');
    expect(actionContainer?.children[0]).toBe(screen.getByRole('button', { name: 'Add scene' }));
    expect(actionContainer?.children[1]).toBe(menuTrigger);
  });

  it('does not show an empty divider before Hide when there are no extra menu items', async () => {
    render(<DockHeader title="Controls" onHide={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Controls actions' }));
    await settle();

    expect(screen.getByRole('menuitem', { name: 'Hide Controls' })).toBeInTheDocument();
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('opens and selects Hide by keyboard from the default actions menu', async () => {
    const onHide = vi.fn();
    render(<DockHeader title="Sources" menuItems={[{ id: 'source.settings', label: 'Settings' }]} onHide={onHide} />);

    const trigger = screen.getByRole('button', { name: 'Sources actions' });
    await act(async () => {
      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      await new Promise((resolve) => { setTimeout(resolve, 50); });
    });

    expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeInTheDocument();
    const hideItem = screen.getByRole('menuitem', { name: 'Hide Sources' });
    expect(hideItem).toBeInTheDocument();

    await act(async () => {
      hideItem.focus();
      fireEvent.keyDown(hideItem, { key: ' ' });
      await new Promise((resolve) => { setTimeout(resolve, 50); });
    });

    expect(onHide).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menuitem', { name: 'Hide Sources' })).toBeNull();
  });

  it('uses the supplied complex-menu trigger instead of adding a second menu', () => {
    render(<DockHeader title="Audio Mixer" menuTrigger={<button type="button" aria-label="Mixer actions">More</button>} onHide={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Mixer actions' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Audio Mixer actions' })).toBeNull();
  });
});
