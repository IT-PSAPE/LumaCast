// The Trigger event contract (issue #219, wave W8). `slide-context.tsx`
// dispatches this event to fire a Trigger without importing the automation
// feature directly, and the automation provider listens for it. The
// `window.dispatchEvent` bridge function itself stays in
// app/renderer/features/automation/automation-events.ts since packages must
// not touch `window`.
import type { Id } from '@lumacast/kernel';
import type { TriggerType } from './model';

export const AUTOMATION_TRIGGER_EVENT = 'lumacast:automation-trigger';

export interface AutomationTriggerEventDetail {
  triggerType: TriggerType;
  sourceId: Id | null;
}
