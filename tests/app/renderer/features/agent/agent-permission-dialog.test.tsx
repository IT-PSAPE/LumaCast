import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ActionRiskClass } from '@lumacast/commands';
import { overlayRoot, overlayStackStore } from '../../components/overlays/workbench-overlay-stack';
import {
  AgentPermissionDialog,
  denyAllAgentPermissionPrompts,
  requestAgentPermission,
  type AgentPermissionAnswer,
  type AgentPermissionPrompt,
} from '@renderer/features/agent/agent-permission-dialog';

vi.mock('@renderer/contexts/workbench-context', () => import('../../components/overlays/workbench-overlay-stack'));

const answers: AgentPermissionAnswer[] = [];

function makePrompt(overrides: Partial<AgentPermissionPrompt> = {}): AgentPermissionPrompt {
  return {
    principal: { kind: 'in-app', threadId: 'thread-1' },
    actionId: 'playlist.delete',
    title: 'Delete playlist',
    risk: 'destructive',
    params: { id: 'pl-1' },
    interlock: false,
    ...overrides,
  };
}

async function ask(overrides: Partial<AgentPermissionPrompt> = {}) {
  render(<AgentPermissionDialog />);
  await act(async () => {
    void requestAgentPermission(makePrompt(overrides)).then((answer) => answers.push(answer));
  });
  await screen.findByRole('dialog');
}

afterEach(async () => {
  // Inside act so the deny resolutions land before `answers` is cleared —
  // otherwise a leftover prompt's answer arrives in the next test.
  await act(async () => { denyAllAgentPermissionPrompts(); });
  cleanup();
  answers.length = 0;
  overlayStackStore.reset();
});

describe('AgentPermissionDialog', () => {
  it('renders nothing until a prompt is queued', () => {
    render(<AgentPermissionDialog />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('names the asker, the action, and its parameters, inside the overlay root', async () => {
    await ask();
    const dialog = screen.getByRole('dialog');

    expect(overlayRoot().contains(dialog)).toBe(true);
    expect(screen.getByText('Delete playlist')).toBeInTheDocument();
    expect(screen.getByText('Assistant')).toBeInTheDocument();
    expect(screen.getByText('id')).toBeInTheDocument();
    expect(screen.getByText('pl-1')).toBeInTheDocument();
  });

  it('names an MCP client rather than the assistant', async () => {
    await ask({ principal: { kind: 'mcp', clientId: 'c1', clientName: 'Claude Desktop' } });
    expect(screen.getByText('Claude Desktop')).toBeInTheDocument();
  });

  it('resolves allow-once, always-allow, and deny from their buttons', async () => {
    await ask({ risk: 'write' });
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    await waitFor(() => expect(answers).toEqual(['allow-once']));

    await act(async () => {
      void requestAgentPermission(makePrompt({ risk: 'write' })).then((answer) => answers.push(answer));
    });
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Always allow write' }));
    await waitFor(() => expect(answers).toEqual(['allow-once', 'always-allow']));

    await act(async () => {
      void requestAgentPermission(makePrompt()).then((answer) => answers.push(answer));
    });
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(answers).toEqual(['allow-once', 'always-allow', 'deny']));
  });

  it('labels the standing grant with the risk class it would cover', async () => {
    await ask({ risk: 'filesystem' });
    expect(screen.getByRole('button', { name: 'Always allow filesystem' })).toBeInTheDocument();
  });

  it('denies on Escape', async () => {
    await ask();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(answers).toEqual(['deny']));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('allows once on Enter', async () => {
    await ask();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
    await waitFor(() => expect(answers).toEqual(['allow-once']));
  });

  it('leaves Enter to a focused button rather than answering twice', async () => {
    await ask();
    const deny = screen.getByRole('button', { name: 'Deny' });
    // A real Enter on a focused button dispatches the keydown and the click.
    fireEvent.keyDown(deny, { key: 'Enter' });
    fireEvent.click(deny);
    await waitFor(() => expect(answers).toEqual(['deny']));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  describe('risk presentation', () => {
    const cases: [ActionRiskClass, string, boolean][] = [
      ['read', 'Read', false],
      ['write', 'Write', false],
      ['destructive', 'Destructive', true],
      ['broadcast', 'Broadcast', true],
      ['filesystem', 'Filesystem', false],
    ];

    it.each(cases)('marks %s risk with the right chip', async (risk, label, severe) => {
      await ask({ risk });
      const chip = screen.getByText(label);
      expect(chip.className.includes('text-error')).toBe(severe);
    });
  });

  describe('interlock', () => {
    it('says an output is live and withholds the standing grant', async () => {
      await ask({ risk: 'broadcast', title: 'Take slide', interlock: true });

      expect(screen.getByText('An output is live.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Always allow/ })).toBeNull();
      expect(screen.getByRole('button', { name: 'Allow once' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
    });

    it('says nothing about outputs when the interlock did not fire', async () => {
      await ask({ risk: 'broadcast' });
      expect(screen.queryByText('An output is live.')).toBeNull();
    });
  });

  it('truncates a long parameter value but keeps it in full on the title', async () => {
    const long = 'x'.repeat(400);
    await ask({ params: { note: long } });

    const value = screen.getByTitle(long);
    expect(value.textContent).toHaveLength(161);
    expect(value.textContent?.endsWith('…')).toBe(true);
  });

  it('renders no parameter list when the action takes none', async () => {
    await ask({ params: {} });
    expect(screen.getByRole('dialog').querySelector('dl')).toBeNull();
  });

  it('denies everything still queued when the dispatcher goes away', async () => {
    render(<AgentPermissionDialog />);
    await act(async () => {
      void requestAgentPermission(makePrompt()).then((answer) => answers.push(answer));
      void requestAgentPermission(makePrompt()).then((answer) => answers.push(answer));
    });
    await screen.findByRole('dialog');

    await act(async () => { denyAllAgentPermissionPrompts(); });
    await waitFor(() => expect(answers).toEqual(['deny', 'deny']));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
