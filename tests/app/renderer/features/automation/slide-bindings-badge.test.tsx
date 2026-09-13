import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SlideBindingsBadge } from '../../../../../app/renderer/features/automation/slide-bindings-badge';

const mocks = vi.hoisted(() => ({
  getBindingsForSourceTriggers: vi.fn(),
}));

vi.mock('../../../../../app/renderer/contexts/use-project-content', () => ({
  useProjectContent: () => ({ mediaAssets: [] }),
}));

vi.mock('../../../../../app/renderer/features/automation/automation-context', () => ({
  useAutomation: () => ({
    state: {
      cues: [{ id: 'cue-1', kind: 'stage.clear', payload: {} }],
      macros: [{ id: 'macro-1', name: 'Fade macro' }],
    },
    actions: { getBindingsForSourceTriggers: mocks.getBindingsForSourceTriggers },
  }),
}));

vi.mock('../../../../../app/renderer/features/automation/cue-icons', () => ({
  CueIcon: () => <span data-testid="cue-icon" />,
  MacroIcon: () => <span data-testid="macro-icon" />,
}));

function binding(overrides: Partial<{ id: string; triggerType: string; targetType: string; targetId: string }>) {
  return {
    id: 'binding-1',
    triggerType: 'slide.activate',
    sourceId: 'slide-1',
    targetType: 'cue',
    targetId: 'cue-1',
    config: {},
    enabled: true,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  } as any;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SlideBindingsBadge', () => {
  it('renders nothing when there are no bindings for the slide', () => {
    mocks.getBindingsForSourceTriggers.mockReturnValue([]);
    const { container } = render(<SlideBindingsBadge slideId="slide-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('asks for bindings across both slide.activate and slide.take', () => {
    mocks.getBindingsForSourceTriggers.mockReturnValue([]);
    render(<SlideBindingsBadge slideId="slide-1" />);
    expect(mocks.getBindingsForSourceTriggers).toHaveBeenCalledWith(['slide.activate', 'slide.take'], 'slide-1');
  });

  it('counts an activate-only binding (unchanged behaviour)', () => {
    mocks.getBindingsForSourceTriggers.mockReturnValue([
      binding({ id: 'b1', triggerType: 'slide.activate', targetType: 'cue', targetId: 'cue-1' }),
    ]);
    render(<SlideBindingsBadge slideId="slide-1" />);
    expect(screen.getAllByTestId('cue-icon')).toHaveLength(1);
    expect(screen.queryByTestId('macro-icon')).not.toBeInTheDocument();
  });

  it('counts a take-only binding', () => {
    mocks.getBindingsForSourceTriggers.mockReturnValue([
      binding({ id: 'b1', triggerType: 'slide.take', targetType: 'macro', targetId: 'macro-1' }),
    ]);
    render(<SlideBindingsBadge slideId="slide-1" />);
    expect(screen.getAllByTestId('macro-icon')).toHaveLength(1);
    expect(screen.queryByTestId('cue-icon')).not.toBeInTheDocument();
  });

  it('counts activate and take bindings together', () => {
    mocks.getBindingsForSourceTriggers.mockReturnValue([
      binding({ id: 'b1', triggerType: 'slide.activate', targetType: 'cue', targetId: 'cue-1' }),
      binding({ id: 'b2', triggerType: 'slide.take', targetType: 'macro', targetId: 'macro-1' }),
    ]);
    render(<SlideBindingsBadge slideId="slide-1" />);
    expect(screen.getAllByTestId('cue-icon')).toHaveLength(1);
    expect(screen.getAllByTestId('macro-icon')).toHaveLength(1);
  });
});
