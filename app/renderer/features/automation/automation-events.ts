import type { TriggerType, Id } from '@core/types';

export const AUTOMATION_TRIGGER_EVENT = 'lumacast:automation-trigger';

export interface AutomationTriggerEventDetail {
  triggerType: TriggerType;
  sourceId: Id | null;
}

export function dispatchAutomationTriggerEvent(detail: AutomationTriggerEventDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AutomationTriggerEventDetail>(AUTOMATION_TRIGGER_EVENT, { detail }));
}
