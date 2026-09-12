import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SlideTimingModal } from '../../../../../app/renderer/features/items/slide-timing-modal';
const state = vi.hoisted(() => ({ save: vi.fn(), schedules: [] as any[], slides: [{ id: 's1', order: 0 }, { id: 's2', order: 1 }] }));
vi.mock('../../../../../app/renderer/contexts/navigation-context', () => ({ useNavigation: () => ({ currentItemRef: { type: 'lyric', id: 'song' } }) }));
vi.mock('../../../../../app/renderer/contexts/playback-schedules-context', () => ({ usePlaybackSchedules: () => ({ schedules: state.schedules, saveSchedule: state.save }) }));
vi.mock('../../../../../app/renderer/contexts/use-project-content', () => ({ useProjectContent: () => ({ slidesForItemRef: () => state.slides }) }));
vi.mock('../../../../../app/renderer/contexts/canvas/canvas-context', () => ({ useThumbnailScene: () => () => null }));
vi.mock('../../../../../app/renderer/contexts/workbench-context', () => ({
  useWorkbench: () => ({
    overlayStack: {
      rootElement: undefined,
      stack: [],
      baseZIndex: 100,
      register: vi.fn(),
      unregister: vi.fn(),
    },
  }),
}));
vi.mock('../../../../../app/renderer/components/overlays/confirm-dialog', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }));
vi.mock('../../../../../app/renderer/components/display/lazy-scene-stage', () => ({ LazySceneStage: () => null }));
describe('slide timing editor', () => {
  beforeEach(() => { state.save.mockReset().mockResolvedValue(undefined); state.schedules = []; });
  it('saves all durations together in a separate item-referencing schedule', async () => {
    const close = vi.fn();
    render(<SlideTimingModal isOpen onClose={close} />);
    fireEvent.change(screen.getByLabelText('Slide 1 duration in seconds'), { target: { value: '2.5' } });
    fireEvent.click(screen.getByLabelText('Enable slide timing'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.save).toHaveBeenCalledWith(expect.objectContaining({
      id: 'timing:lyric:song', enabled: true, kind: 'slide-timing', itemRef: { type: 'lyric', id: 'song' },
      steps: [{ slideId: 's1', durationMs: 2500 }, { slideId: 's2', durationMs: 5000 }],
    })));
    expect(close).toHaveBeenCalled();
  });
  it('retains saved playback order and durations when reopened', () => {
    state.schedules = [{ id: 'timing:lyric:song', kind: 'slide-timing', enabled: true, itemRef: { type: 'lyric', id: 'song' }, steps: [{ slideId: 's2', durationMs: 7000 }, { slideId: 's1', durationMs: 3000 }] }];
    render(<SlideTimingModal isOpen onClose={() => {}} />);
    expect((screen.getByLabelText('Slide 1 duration in seconds') as HTMLInputElement).value).toBe('7');
    expect((screen.getByLabelText('Slide 2 duration in seconds') as HTMLInputElement).value).toBe('3');
  });
  it('keeps the editor open after a failed save', async () => {
    state.save.mockRejectedValue(new Error('Save failed'));
    const close = vi.fn();
    render(<SlideTimingModal isOpen onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Save failed');
    expect(close).not.toHaveBeenCalled();
  });
  it('rejects empty or zero duration without persisting', async () => {
    render(<SlideTimingModal isOpen onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Slide 1 duration in seconds'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toContain('positive');
    expect(state.save).not.toHaveBeenCalled();
  });
});
