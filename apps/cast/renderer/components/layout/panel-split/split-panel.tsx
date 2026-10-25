import { Children, createContext, isValidElement, useCallback, useContext, useEffect, useMemo, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { Split, type SplitChangeMeta, type SplitLayout } from '@lumacast/ui';
import { useWorkbenchPanelLayout } from './use-workbench-panel-layout';
import { toSplitLayout, toSplitPanes, type PaneId, type SplitDefinition, type SplitId, type SplitPaneDefinition } from './workbench-panel-layout';

interface PanelRouteRootProps {
  children: ReactNode;
}

interface PanelRouteSplitProps {
  splitId: SplitId;
  orientation: 'horizontal' | 'vertical';
  className?: string;
  children: ReactNode;
}

interface PanelRoutePanelProps {
  id: PaneId;
  defaultSize: number;
  minSize: number;
  maxSize?: number;
  collapsible?: boolean;
  /** The pane that absorbs remaining space. Declare exactly one per split. */
  fill?: boolean;
  className?: string;
  children: ReactNode;
}

interface PanelRouteContextValue {
  state: ReturnType<typeof useWorkbenchPanelLayout>;
  actions: {
    registerSplit: (definition: SplitDefinition) => void;
    togglePanel: (splitId: SplitId, paneId: PaneId) => void;
  };
  meta: {
    getSplitLayout: ReturnType<typeof useWorkbenchPanelLayout>['getSplitLayout'];
    isPanelVisible: ReturnType<typeof useWorkbenchPanelLayout>['isPanelVisible'];
  };
}

interface PanelElementData {
  id: PaneId;
  className?: string;
  children: ReactNode;
  fill: boolean;
  definition: SplitPaneDefinition;
}

const PanelRouteContext = createContext<PanelRouteContextValue | null>(null);

function Root({ children }: PanelRouteRootProps) {
  const state = useWorkbenchPanelLayout();

  const value = useMemo<PanelRouteContextValue>(() => {
    return {
      state,
      actions: {
        registerSplit: state.registerSplit,
        togglePanel: state.togglePanel,
      },
      meta: {
        getSplitLayout: state.getSplitLayout,
        isPanelVisible: state.isPanelVisible,
      },
    };
  }, [state]);

  return <PanelRouteContext.Provider value={value}>{children}</PanelRouteContext.Provider>;
}

function Panel({ splitId, orientation, className = '', children, ...props }: PanelRouteSplitProps & HTMLAttributes<HTMLDivElement>) {
  const context = usePanelRoute();
  const panels = useMemo(() => collectPanels(children), [children]);
  const definition = useMemo(() => createSplitDefinition(splitId, orientation, panels), [orientation, panels, splitId]);
  const layout = context.meta.getSplitLayout(definition);
  const splitPanes = useMemo(() => toSplitPanes(definition), [definition]);

  useEffect(() => {
    context.actions.registerSplit(definition);
  }, [context.actions, definition]);

  const handleLayoutChange = useCallback((next: SplitLayout, meta: SplitChangeMeta) => {
    context.state.applySplitLayout({ definition, layout: next, meta });
  }, [context.state, definition]);

  return (
    <div {...props} className={className}>
      <Split orientation={orientation} layout={toSplitLayout(layout)} onLayoutChange={handleLayoutChange} resize="cascade" fitToContainer>
        {panels.map((panel, index) => (
          <Split.Pane key={panel.id} {...splitPanes[index]} className={panel.className}>
            {panel.children}
          </Split.Pane>
        ))}
      </Split>
    </div>
  );
}

function Segment({ children }: PanelRoutePanelProps) {
  return <>{children}</>;
}

function usePanelRoute() {
  const context = useContext(PanelRouteContext);
  if (!context) {
    throw new Error('PanelRoute components must be used within PanelRoute.Root.');
  }

  return context;
}

function collectPanels(children: ReactNode): PanelElementData[] {
  const panelNodes = Children.toArray(children).filter(isPanelElement);

  if (panelNodes.length < 2) {
    throw new Error('PanelRoute.Split requires at least two PanelRoute.Panel children.');
  }

  return panelNodes.map((panelNode) => {
    const { id, className, children: panelChildren, defaultSize, minSize, maxSize = Number.POSITIVE_INFINITY, collapsible = false, fill = false } = panelNode.props;

    return {
      id,
      className,
      children: panelChildren,
      fill,
      definition: {
        id,
        defaultSize,
        minSize,
        maxSize,
        collapsible,
        snap: collapsible,
      },
    };
  });
}

function isPanelElement(value: ReactNode): value is ReactElement<PanelRoutePanelProps> {
  return isValidElement<PanelRoutePanelProps>(value) && value.type === Segment;
}

function createSplitDefinition(splitId: SplitId, orientation: 'horizontal' | 'vertical', panels: PanelElementData[]): SplitDefinition {
  const paneOrder = panels.map((panel) => panel.id);
  const panes = panels.reduce<Record<PaneId, SplitPaneDefinition>>((accumulator, panel) => {
    accumulator[panel.id] = panel.definition;
    return accumulator;
  }, {});

  return {
    id: splitId,
    orientation,
    paneOrder,
    fillPaneId: getFillPaneId(panels),
    panes,
  };
}

function getFillPaneId(panels: PanelElementData[]): PaneId {
  const declared = panels.filter((panel) => panel.fill);
  if (declared.length > 1) {
    throw new Error('PanelRoute.Split accepts at most one fill Segment.');
  }
  if (declared.length === 1) {
    return declared[0].id;
  }

  // Fallback when no Segment declares fill: the single non-collapsible pane, else the last.
  const fixedPanels = panels.filter((panel) => !panel.definition.collapsible);
  if (fixedPanels.length === 1) {
    return fixedPanels[0].id;
  }

  return panels[panels.length - 1].id;
}

export const SplitPanel = Object.assign(Root, {
  Panel,
  Segment
});


export { usePanelRoute };
