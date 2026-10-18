import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createDefaultStreamServiceSettings, type StreamRuntimeStatus, type StreamServiceSettings } from '../../../../apps/stream/shared/desktop-api';
import { YouTubeDock } from '../../../../apps/stream/renderer/docks/youtube-dock';

afterEach(cleanup);

const OFFLINE_STATUS: StreamRuntimeStatus = { state: 'stopped' };

function renderDock(overrides: {
  settings?: Partial<StreamServiceSettings>;
  status?: StreamRuntimeStatus;
  streamingStartedAt?: number | null;
  now?: number;
  working?: boolean;
  onGoLive?: () => void;
  onStopStreaming?: () => void;
  onOpenDashboard?: () => void;
  onHide?: () => void;
} = {}) {
  const settings: StreamServiceSettings = { ...createDefaultStreamServiceSettings(), ...overrides.settings };
  const onChange = vi.fn();
  const onGoLive = overrides.onGoLive ?? vi.fn();
  const onStopStreaming = overrides.onStopStreaming ?? vi.fn();
  const onOpenDashboard = overrides.onOpenDashboard ?? vi.fn();
  const onHide = overrides.onHide ?? vi.fn();
  render(
    <YouTubeDock
      settings={settings}
      onChange={onChange}
      status={overrides.status ?? OFFLINE_STATUS}
      streamingStartedAt={overrides.streamingStartedAt ?? null}
      now={overrides.now ?? Date.now()}
      working={overrides.working ?? false}
      onGoLive={onGoLive}
      onStopStreaming={onStopStreaming}
      onOpenDashboard={onOpenDashboard}
      onHide={onHide}
    />,
  );
  return { settings, onChange, onGoLive, onStopStreaming, onOpenDashboard, onHide };
}

describe('YouTubeDock', () => {
  it('disables Go Live and shows inline validation when the stream key is empty', () => {
    renderDock({ settings: { streamKey: '' } });
    expect(screen.getByRole('button', { name: /go live/i })).toBeDisabled();
    expect(screen.getByText('Enter a stream key.')).toBeInTheDocument();
  });

  it('enables Go Live once a server and key are set, and fires onGoLive when clicked', () => {
    const { onGoLive } = renderDock({ settings: { service: 'youtube', serverId: 'primary', streamKey: 'abcd-1234' } });
    const button = screen.getByRole('button', { name: /go live/i });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onGoLive).toHaveBeenCalledTimes(1);
  });

  it('shows the elapsed time and bitrate, and an End Stream action, while live', () => {
    const now = 1_000_000;
    renderDock({
      settings: { streamKey: 'abcd-1234' },
      status: { state: 'live', bitrateKbps: 4200 },
      streamingStartedAt: now - 65_000,
      now,
    });
    expect(screen.getByText('4200 kb/s')).toBeInTheDocument();
    expect(screen.getByText('01:05')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /end stream/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /^go live$/i })).not.toBeInTheDocument();
  });

  it('calls onStopStreaming from the End Stream action', () => {
    const { onStopStreaming } = renderDock({
      settings: { streamKey: 'abcd-1234' },
      status: { state: 'live', bitrateKbps: 1000 },
      streamingStartedAt: Date.now() - 1000,
    });
    fireEvent.click(screen.getByRole('button', { name: /end stream/i }));
    expect(onStopStreaming).toHaveBeenCalledTimes(1);
  });

  it('calls onOpenDashboard from the Open YouTube Studio action', () => {
    const { onOpenDashboard } = renderDock();
    fireEvent.click(screen.getByRole('button', { name: /open youtube studio/i }));
    expect(onOpenDashboard).toHaveBeenCalledTimes(1);
  });

  it('calls onHide from the title row hide action', () => {
    const { onHide } = renderDock();
    fireEvent.click(screen.getByRole('button', { name: /hide youtube live control panel/i }));
    expect(onHide).toHaveBeenCalledTimes(1);
  });
});
