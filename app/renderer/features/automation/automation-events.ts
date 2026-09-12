import { AUTOMATION_TRIGGER_EVENT, type AutomationTriggerEventDetail } from '@lumacast/automation';

export { AUTOMATION_TRIGGER_EVENT, type AutomationTriggerEventDetail };

export function dispatchAutomationTriggerEvent(detail: AutomationTriggerEventDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AutomationTriggerEventDetail>(AUTOMATION_TRIGGER_EVENT, { detail }));
}
