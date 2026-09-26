import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { confirmChoice, ConfirmHost } from '../../../../../apps/chord/renderer/components/confirm-dialog';

afterEach(cleanup);

describe('confirmChoice / ConfirmHost', () => {
  it('renders the title, message and choices, and resolves with the clicked choice', async () => {
    render(<ConfirmHost />);
    const pending = confirmChoice(
      'Import lyrics',
      [
        { value: 'append', label: 'Append' },
        { value: 'replace', label: 'Replace', variant: 'danger' },
      ],
      'This project already has lyrics.',
    );

    expect(await screen.findByText('Import lyrics')).toBeInTheDocument();
    expect(screen.getByText('This project already has lyrics.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Append' }));
    await expect(pending).resolves.toBe('append');
  });

  it('resolves null when dismissed without a choice', async () => {
    render(<ConfirmHost />);
    const pending = confirmChoice('Delete cue?', [{ value: 'delete', label: 'Delete' }]);
    await screen.findByText('Delete cue?');

    fireEvent.click(screen.getByLabelText('Close dialog'));
    await expect(pending).resolves.toBeNull();
  });

  it('renders nothing when no confirm is pending', () => {
    const { container } = render(<ConfirmHost />);
    expect(container).toBeEmptyDOMElement();
  });
});
