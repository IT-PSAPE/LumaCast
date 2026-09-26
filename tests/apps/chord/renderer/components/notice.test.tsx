import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { dismissNotice, NoticeStack, pushNotice } from '../../../../../apps/chord/renderer/components/notice';

afterEach(cleanup);

describe('NoticeStack', () => {
  it('renders nothing with no notices', () => {
    const { container } = render(<NoticeStack />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a pushed notice and lets it be dismissed', () => {
    const id = pushNotice('Something happened');
    render(<NoticeStack />);
    expect(screen.getByText('Something happened')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(screen.queryByText('Something happened')).not.toBeInTheDocument();
    dismissNotice(id); // idempotent
  });

  it('renders several notices and dismissing one leaves the others', () => {
    pushNotice('First');
    pushNotice('Second', 'error');
    render(<NoticeStack />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();

    fireEvent.click(screen.getAllByLabelText('Dismiss')[0]!);
    expect(screen.queryByText('First')).not.toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();

    fireEvent.click(screen.getAllByLabelText('Dismiss')[0]!);
    expect(screen.queryByText('Second')).not.toBeInTheDocument();
  });
});
