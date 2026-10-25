import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({
  status: { isRunningOperation: false, operationText: undefined as string | undefined, statusText: 'Ready' },
  live: { audienceLive: false, stageLive: false },
}));

vi.mock('../../../../../../apps/cast/renderer/contexts/app-context', () => ({
  useStatusBarState: () => state.status,
  useNdiLiveState: () => state.live,
}));
vi.mock('../../../../../../apps/cast/renderer/features/agent/chat/agent-chat-trigger', () => ({
  AgentChatTrigger: () => <button type="button">Assistant</button>,
}));

import { StatusBar } from '../../../../../../apps/cast/renderer/features/workbench/status-bar';

const dotOf = (label: string) => screen.getByText(label).querySelector('span[aria-hidden="true"]');

describe('cast StatusBar', () => {
  beforeEach(() => {
    state.status = { isRunningOperation: false, operationText: undefined, statusText: 'Ready' };
    state.live = { audienceLive: false, stageLive: false };
  });

  it('is the package status bar landmark and keeps data-ui-region', () => {
    render(<StatusBar />);
    const bar = document.querySelector('[data-ui-region="status-bar"]');
    expect(bar?.tagName).toBe('FOOTER');
    expect(screen.getByRole('contentinfo', { name: 'Status' })).toBe(bar);
    expect(screen.getByText('Ready')).not.toBeNull();
    expect(screen.getByText('Assistant')).not.toBeNull();
  });

  it('shows idle labels and green ready dots when nothing is live', () => {
    render(<StatusBar />);
    // Tally contract: red = on-air, green = ready. Idle is `success`, not
    // `neutral` — a neutral dot resolves to the tertiary surface colour, one
    // step from the bar's own bg-secondary, so it was invisible in the app.
    expect(dotOf('Audience idle')?.classList.contains('bg-success')).toBe(true);
    expect(dotOf('Stage idle')?.classList.contains('bg-success')).toBe(true);
  });

  it('turns each on-air dot red independently with its live label', () => {
    state.live = { audienceLive: true, stageLive: false };
    render(<StatusBar />);
    expect(dotOf('Audience live')?.classList.contains('bg-error')).toBe(true);
    expect(dotOf('Stage idle')?.classList.contains('bg-success')).toBe(true);
  });

  it('shows the operation text with a spinner while an operation runs', () => {
    state.status = { isRunningOperation: true, operationText: 'Exporting', statusText: 'Ready' };
    render(<StatusBar />);
    expect(screen.getByText('Exporting')).not.toBeNull();
    expect(screen.queryByText('Ready')).toBeNull();
    expect(document.querySelector('[data-ui-region="status-bar"] [role="status"], [data-ui-region="status-bar"] svg, [data-ui-region="status-bar"] [class*="animate-spin"]')).not.toBeNull();
  });

  it('falls back to Processing... when the operation has no text', () => {
    state.status = { isRunningOperation: true, operationText: undefined, statusText: 'Ready' };
    render(<StatusBar />);
    expect(screen.getByText('Processing...')).not.toBeNull();
  });
});
