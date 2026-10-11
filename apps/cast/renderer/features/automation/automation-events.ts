import { AUTOMATION_LIVE_SLIDE_EVENT, AUTOMATION_TRIGGER_EVENT, type AutomationLiveSlideEventDetail, type AutomationTriggerEventDetail } from '@lumacast/automation';

export { AUTOMATION_LIVE_SLIDE_EVENT, AUTOMATION_TRIGGER_EVENT, type AutomationLiveSlideEventDetail, type AutomationTriggerEventDetail };

export function dispatchAutomationLiveSlideEvent(slideId: AutomationLiveSlideEventDetail['slideId']): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AutomationLiveSlideEventDetail>(AUTOMATION_LIVE_SLIDE_EVENT, { detail: { slideId } }));
}

export function dispatchAutomationTriggerEvent(detail: AutomationTriggerEventDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AutomationTriggerEventDetail>(AUTOMATION_TRIGGER_EVENT, { detail }));
}
