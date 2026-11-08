import { describe, expect, it, vi } from 'vitest';
import { useAppMenu, type UseAppMenuParams } from '../../../../apps/stream/renderer/features/chrome/use-app-menu';
import { buildAppMenus, collectMenuActions } from '../../../../apps/stream/renderer/shared/app-menu';
import { resetWorkbenchLayout } from '../../../../apps/stream/renderer/workbench-layout';

describe('Stream menu quit authority', () => {
  it('dispatches File Quit through the supplied main-owned quit port, including before project load', () => {
    const onQuit = vi.fn();
    const params = {
      platform: 'darwin', project: null, selectedSource: null,
      workbenchLayout: resetWorkbenchLayout(), collections: [], profiles: [], onQuit,
    } as unknown as UseAppMenuParams;
    const context = useAppMenu(params);
    const actions = collectMenuActions(buildAppMenus(context));
    actions.get('file.quit')?.();
    expect(onQuit).toHaveBeenCalledTimes(1);
  });
});
