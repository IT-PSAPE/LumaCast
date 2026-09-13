import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SlideBindingsMenu } from '../../../../../app/renderer/features/automation/slide-bindings-menu';

const mocks = vi.hoisted(() => ({
  getBindingsForSourceTriggers: vi.fn(),
  deleteBinding: vi.fn(),
  setCurrentMacroId: vi.fn(),
}));

vi.mock('../../../../../app/renderer/components/overlays/context-menu', () => ({
  ContextMenu: {
    Submenu: ({ label, children, disabled }: { label: React.ReactNode; children: React.ReactNode; disabled?: boolean }) => (
      <section data-disabled={disabled ? 'true' : undefined}>
        <div data-testid="submenu-label">{label}</div>
        {children}
      </section>
    ),
    Item: ({ children, onSelect, disabled }: { children: React.ReactNode; onSelect?: () => void; disabled?: boolean }) => (
      <button type="button" disabled={disabled} onClick={onSelect}>{children}</button>
    ),
    Separator: () => <hr />,
  },
}));

vi.mock('../../../../../app/renderer/contexts/asset-editor/asset-editor-context', () => ({
  useOverlayEditor: () => ({ setCurrentOverlayId: vi.fn() }),
  useStageEditor: () => ({ setCurrentStageId: vi.fn() }),
}));

vi.mock('../../../../../app/renderer/contexts/use-project-content', () => ({
  useProjectContent: () => ({ overlays: [], stages: [], mediaAssets: [] }),
}));

vi.mock('../../../../../app/renderer/contexts/workbench-context', () => ({
  useWorkbench: () => ({ actions: { setWorkbenchMode: vi.fn() } }),
}));

vi.mock('../../../../../app/renderer/features/automation/automation-context', () => ({
  useAutomation: () => ({
    state: {
      cues: [{ id: 'cue-1', kind: 'stage.clear', payload: {} }],
      macros: [{ id: 'macro-1', name: 'Fade macro' }],
    },
    actions: {
      deleteBinding: mocks.deleteBinding,
      getBindingsForSourceTriggers: mocks.getBindingsForSourceTriggers,
      setCurrentMacroId: mocks.setCurrentMacroId,
    },
  }),
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

describe('SlideBindingsMenu', () => {
  it('renders nothing when there are no bindings for the slide', () => {
    mocks.getBindingsForSourceTriggers.mockReturnValue([]);
    const { container } = render(<SlideBindingsMenu slideId="slide-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('asks for bindings across both slide.activate and slide.take', () => {
    mocks.getBindingsForSourceTriggers.mockReturnValue([]);
    render(<SlideBindingsMenu slideId="slide-1" />);
    expect(mocks.getBindingsForSourceTriggers).toHaveBeenCalledWith(['slide.activate', 'slide.take'], 'slide-1');
  });

  it('lists an activate-only cue binding without a take suffix (unchanged behaviour)', () => {
    mocks.getBindingsForSourceTriggers.mockReturnValue([
      binding({ id: 'b1', triggerType: 'slide.activate', targetType: 'cue', targetId: 'cue-1' }),
    ]);
    render(<SlideBindingsMenu slideId="slide-1" />);
    const label = screen.getByTestId('submenu-label');
    expect(label.textContent).toContain('Clear stage');
    expect(label.textContent).not.toContain('take');
  });

  it('lists a take-only macro binding with a distinguishing suffix', () => {
    mocks.getBindingsForSourceTriggers.mockReturnValue([
      binding({ id: 'b1', triggerType: 'slide.take', targetType: 'macro', targetId: 'macro-1' }),
    ]);
    render(<SlideBindingsMenu slideId="slide-1" />);
    const label = screen.getByTestId('submenu-label');
    expect(label.textContent).toContain('Fade macro');
    expect(label.textContent).toContain('take');
  });

  it('lists both activate and take bindings together, distinguishing them', () => {
    mocks.getBindingsForSourceTriggers.mockReturnValue([
      binding({ id: 'b1', triggerType: 'slide.activate', targetType: 'cue', targetId: 'cue-1' }),
      binding({ id: 'b2', triggerType: 'slide.take', targetType: 'macro', targetId: 'macro-1' }),
    ]);
    render(<SlideBindingsMenu slideId="slide-1" />);
    const labels = screen.getAllByTestId('submenu-label').map((el) => el.textContent ?? '');
    expect(labels).toHaveLength(2);
    expect(labels.some((text) => text.includes('Clear stage') && !text.includes('take'))).toBe(true);
    expect(labels.some((text) => text.includes('Fade macro') && text.includes('take'))).toBe(true);
  });

  it('removes a binding via the Remove item', () => {
    mocks.getBindingsForSourceTriggers.mockReturnValue([
      binding({ id: 'b1', triggerType: 'slide.take', targetType: 'macro', targetId: 'macro-1' }),
    ]);
    render(<SlideBindingsMenu slideId="slide-1" />);
    screen.getByRole('button', { name: 'Remove' }).click();
    expect(mocks.deleteBinding).toHaveBeenCalledWith('b1');
  });
});
