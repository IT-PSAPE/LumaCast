import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  outputState: {
    audience: false,
    stage: false,
  },
  setNdiAudioEnabledOutputs: vi.fn(),
}));

vi.mock('../../contexts/app-context', () => ({
  useNdi: () => ({
    state: { outputState: mocks.outputState },
  }),
}));

vi.mock('./ndi-audio-capture', () => ({
  setNdiAudioEnabledOutputs: mocks.setNdiAudioEnabledOutputs,
}));

vi.mock('./ndi-outputs', () => ({
  NdiOutputs: () => <div data-testid="ndi-outputs" />,
}));

const { NdiOutputsGate } = await import('./ndi-outputs-gate');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.outputState.audience = false;
  mocks.outputState.stage = false;
});

afterEach(() => {
  cleanup();
});

describe('NdiOutputsGate', () => {
  it('skips the lazy capture tree while all NDI outputs are disabled', () => {
    const { queryByTestId } = render(<NdiOutputsGate />);
    expect(queryByTestId('ndi-outputs')).toBeNull();
    expect(Array.from(mocks.setNdiAudioEnabledOutputs.mock.calls[0][0] as Set<string>)).toEqual([]);
  });

  it('mounts the lazy capture tree once any output is enabled and unmounts it again when all outputs go idle', async () => {
    mocks.outputState.audience = true;
    const view = render(<NdiOutputsGate />);

    await waitFor(() => expect(view.queryByTestId('ndi-outputs')).not.toBeNull());
    expect(Array.from(mocks.setNdiAudioEnabledOutputs.mock.calls.at(-1)?.[0] as Set<string>)).toEqual(['audience']);

    mocks.outputState.audience = false;
    view.rerender(<NdiOutputsGate />);

    await waitFor(() => expect(view.queryByTestId('ndi-outputs')).toBeNull());
    expect(Array.from(mocks.setNdiAudioEnabledOutputs.mock.calls.at(-1)?.[0] as Set<string>)).toEqual([]);
  });

  it('clears audience audio routing when the gate unmounts from an enabled state', async () => {
    mocks.outputState.audience = true;
    const view = render(<NdiOutputsGate />);

    await waitFor(() => expect(view.queryByTestId('ndi-outputs')).not.toBeNull());
    view.unmount();

    expect(Array.from(mocks.setNdiAudioEnabledOutputs.mock.calls.at(-1)?.[0] as Set<string>)).toEqual([]);
  });
});
