import { Children, createContext, isValidElement, useCallback, useContext, useEffect, useMemo, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { ResizableSplitPane, ResizableSplitRoot, type ResizableSplitResizeEndEvent, type ResizableSplitResizeMoveEvent, type ResizableSplitResizeStartEvent } from '../resizable-split';
import { useWorkbenchPanelLayout } from './use-workbench-panel-layout';
import type { PaneId, SplitDefinition, SplitId, SplitPaneDefinition } from './workbench-panel-layout';

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
  const resizablePanes = useMemo(() => buildResizablePanes(definition, layout, panels), [definition, layout, panels]);

  useEffect(() => {
    context.actions.registerSplit(definition);
  }, [context.actions, definition]);

  const handleResizeStart = useCallback((event: ResizableSplitResizeStartEvent) => {
    context.state.startDrag({
      definition,
      handleIndex: event.handleIndex,
      pointerPosition: event.pointerPosition,
      paneSizes: event.paneSizes,
    });
  }, [context.state, definition]);

  const handleResize = useCallback((event: ResizableSplitResizeMoveEvent) => {
    context.state.updateDrag({
      definition,
      pointerPosition: event.pointerPosition,
    });
  }, [context.state, definition]);

  const handleResizeEnd = useCallback((_event: ResizableSplitResizeEndEvent) => {
    context.state.endDrag({ splitId });
  }, [context.state, splitId]);

  const handleContainerResize = useCallback((size: number) => {
    context.state.syncToContainer({ definition, size });
  }, [context.state, definition]);

  return (
    <ResizableSplitRoot orientation={orientation} onContainerResize={handleContainerResize} onResizeStart={handleResizeStart} onResize={handleResize} onResizeEnd={handleResizeEnd}>
      <div {...props} className={className}>
        {resizablePanes}
      </div>
    </ResizableSplitRoot>
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
    const { id, className, children: panelChildren, defaultSize, minSize, maxSize = Number.POSITIVE_INFINITY, collapsible = false } = panelNode.props;

    return {
      id,
      className,
      children: panelChildren,
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
  const fixedPanels = panels.filter((panel) => !panel.definition.collapsible);
  if (fixedPanels.length === 1) {
    return fixedPanels[0].id;
  }

  return panels[panels.length - 1].id;
}

function buildResizablePanes(
  definition: SplitDefinition,
  layout: ReturnType<PanelRouteContextValue['meta']['getSplitLayout']>,
  panels: PanelElementData[],
): ReactElement[] {
  return panels.map((panel) => (
    <ResizableSplitPane
      key={panel.id}
      paneId={panel.id}
      orientation={definition.orientation}
      visible={layout.panes[panel.id].visible}
      size={layout.panes[panel.id].size}
      minSize={panel.definition.minSize}
      maxSize={panel.definition.maxSize}
      flexible={definition.fillPaneId === panel.id}
    >
      <section className={panel.className}>
        {panel.children}
      </section>
    </ResizableSplitPane>
  ));
}

export const SplitPanel = Object.assign(Root, {
  Panel,
  Segment
});


export { usePanelRoute };
