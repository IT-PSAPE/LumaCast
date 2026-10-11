import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TriggersInspector } from '../../../../../../apps/cast/renderer/screens/macro-editor/triggers-inspector';

const mocks = vi.hoisted(() => ({ triggerType: 'slide.exit' }));
vi.mock('../../../../../../apps/cast/renderer/screens/macro-editor/screen-context', () => ({
  useMacroEditorScreen: () => ({ state: { currentMacro: { id: 'macro' } } }),
}));
vi.mock('../../../../../../apps/cast/renderer/contexts/slide-context', () => ({ useSlides: () => ({ slides: [{ id: 'slide' }] }) }));
vi.mock('../../../../../../apps/cast/renderer/features/automation/automation-context', () => ({
  useAutomation: () => ({ actions: {
    getBindingsForMacro: () => [{ id: 'binding', triggerType: mocks.triggerType, sourceId: 'slide' }], deleteBinding: vi.fn(),
  } }),
}));

afterEach(cleanup);

describe('TriggersInspector', () => {
  it.each([['slide.activate', 'on Activate'], ['slide.take', 'on Take'], ['slide.exit', 'on Exit']])('labels %s', (triggerType, label) => {
    mocks.triggerType = triggerType;
    render(<TriggersInspector />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
