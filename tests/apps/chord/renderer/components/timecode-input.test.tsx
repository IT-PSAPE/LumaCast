import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimecodeInput } from '../../../../../apps/chord/renderer/components/timecode-input';

afterEach(cleanup);

describe('TimecodeInput', () => {
  it('formats milliseconds as MM:SS.mmm', () => {
    render(<TimecodeInput ms={65_250} onCommit={vi.fn()} ariaLabel="Start" />);
    expect(screen.getByLabelText('Start')).toHaveValue('01:05.250');
  });

  it('shows "Auto" when ms is null and allowAuto is set', () => {
    render(<TimecodeInput ms={null} allowAuto onCommit={vi.fn()} ariaLabel="End" />);
    expect(screen.getByLabelText('End')).toHaveValue('Auto');
  });

  it('commits a parsed value on blur', () => {
    const onCommit = vi.fn();
    render(<TimecodeInput ms={0} onCommit={onCommit} ariaLabel="Start" />);
    const input = screen.getByLabelText('Start');
    fireEvent.change(input, { target: { value: '01:02.500' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(62_500);
  });

  it('commits null when the field is set to "Auto" and allowAuto is set', () => {
    const onCommit = vi.fn();
    render(<TimecodeInput ms={5000} allowAuto onCommit={onCommit} ariaLabel="End" />);
    const input = screen.getByLabelText('End');
    fireEvent.change(input, { target: { value: 'auto' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it('reverts to the last valid value on unparsable input', () => {
    const onCommit = vi.fn();
    render(<TimecodeInput ms={1000} onCommit={onCommit} ariaLabel="Start" />);
    const input = screen.getByLabelText('Start');
    fireEvent.change(input, { target: { value: 'not a time' } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveValue('00:01.000');
  });

  it('commits on Enter (which blurs the field)', () => {
    const onCommit = vi.fn();
    render(<TimecodeInput ms={0} onCommit={onCommit} ariaLabel="Start" />);
    const input = screen.getByLabelText('Start');
    // `.blur()` (called by the Enter handler) only fires in jsdom when the
    // element is actually focused first.
    input.focus();
    fireEvent.change(input, { target: { value: '00:10.000' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(10_000);
  });
});
