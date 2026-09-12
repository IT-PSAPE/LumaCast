import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { VideoFilmstripTrack } from '../../../../../app/renderer/features/playback/video-filmstrip-track';

vi.mock('../../../../../app/renderer/features/playback/use-video-filmstrip', () => ({
  useVideoFilmstrip: () => ({ frames: ['frame-1', 'frame-2', 'frame-3'], status: 'ready' }),
}));

afterEach(cleanup);

it('renders sampled frames and uses the filmstrip as the scrubber', () => {
  const onSeek = vi.fn();
  const onScrubStart = vi.fn();
  const onScrubEnd = vi.fn();
  const view = render(
    <VideoFilmstripTrack
      src="cast-media://video"
      duration={20}
      currentTime={5}
      disabled={false}
      onSeek={onSeek}
      onScrubStart={onScrubStart}
      onScrubEnd={onScrubEnd}
    />,
  );

  const frames = [...view.container.querySelectorAll('img')];
  expect(frames).toHaveLength(3);
  for (const frame of frames) {
    expect(frame.className).toContain('object-contain');
    expect(frame.className).not.toContain('object-cover');
  }
  const scrubber = screen.getByRole('slider', { name: 'Video scrubber' });
  fireEvent.pointerDown(scrubber, { pointerId: 7 });
  fireEvent.change(scrubber, { target: { value: '12.5' } });
  fireEvent.pointerUp(scrubber, { pointerId: 7 });
  expect(onScrubStart).toHaveBeenCalledTimes(1);
  expect(onSeek).toHaveBeenCalledWith(12.5);
  expect(onScrubEnd).toHaveBeenCalledTimes(1);
  expect(screen.getByText('0:05')).not.toBeNull();
  expect(screen.getByText('0:20')).not.toBeNull();
});
