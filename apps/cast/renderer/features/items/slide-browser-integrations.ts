import type { ReactNode } from 'react';
import type { Id } from '@lumacast/kernel';

/** Screen-owned UI added to each slide by the containing workflow. */
export interface SlideBrowserIntegrations {
  renderBindingsBadge: (slideId: Id) => ReactNode;
  renderActionsMenu: (slideIds: Id[]) => ReactNode;
}
