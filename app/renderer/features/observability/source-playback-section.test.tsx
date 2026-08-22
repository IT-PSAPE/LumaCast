import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useMetricsStore } from './metrics-store';
import { SourcePlaybackSection } from './source-playback-section';

describe('SourcePlaybackSection', () => {
  beforeEach(() => {
    useMetricsStore.setState({
      videoQualities: {},
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders with an empty DOM-video list without resubscribing into a render loop', () => {
    const { getByText } = render(<SourcePlaybackSection />);

    expect(getByText('Source playback')).not.toBeNull();
    expect(getByText('No video elements in the DOM.')).not.toBeNull();
    expect(getByText('DOM videos mounted')).not.toBeNull();
    expect(getByText('Canvas layer videos')).not.toBeNull();
    expect(getByText('Canvas warm resident')).not.toBeNull();
    expect(getByText('Canvas warm hits')).not.toBeNull();
  });
});
