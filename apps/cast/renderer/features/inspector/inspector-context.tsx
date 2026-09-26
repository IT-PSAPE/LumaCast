import { useWorkbench } from '../../contexts/workbench-context';

// Thin façade over the shared workbench context for inspector-feature
// consumers. Other features that only need to read/set the inspector tab
// (e.g. to switch tabs after an action) should call useWorkbench() directly
// rather than importing this feature — the canvas feature's
// use-stage-viewport-controller.ts does exactly that, so canvas never
// depends on the inspector feature.

interface InspectorContextValue {
  inspectorTab: ReturnType<typeof useWorkbench>['state']['inspectorTab'];
  setInspectorTab: (tab: ReturnType<typeof useWorkbench>['state']['inspectorTab']) => void;
}

export function useInspector(): InspectorContextValue {
  const {
    state: { inspectorTab },
    actions: { setInspectorTab },
  } = useWorkbench();

  return {
    inspectorTab,
    setInspectorTab,
  };
}
