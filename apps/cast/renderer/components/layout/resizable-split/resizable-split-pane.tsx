import { Children, cloneElement, isValidElement, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@lumacast/ui';

interface PaneSlotProps {
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  'data-pane-id'?: string;
}

interface ResizableSplitPaneProps {
  paneId: string;
  orientation: 'horizontal' | 'vertical';
  size: number;
  minSize: number;
  maxSize: number;
  flexible: boolean;
  visible: boolean;
  children: ReactNode;
}

export function ResizableSplitPane({ paneId, orientation, size, minSize, maxSize, flexible, visible, children }: ResizableSplitPaneProps) {
  if (!visible) return null;

  const wrapper = Children.only(children);
  if (!isValidElement<PaneSlotProps>(wrapper)) {
    throw new Error('ResizableSplitPane expects a single element child');
  }

  const sizingStyle = buildPaneStyle(orientation, size, minSize, maxSize, flexible);
  return cloneElement(wrapper, {
    'data-pane-id': paneId,
    className: cn('h-full min-h-0 min-w-0 overflow-hidden', wrapper.props.className),
    // Sizing properties win over user-supplied style — they are required for
    // the pane to participate correctly in the parent flex layout.
    style: { ...wrapper.props.style, ...sizingStyle },
  });
}

function buildPaneStyle(
  orientation: 'horizontal' | 'vertical',
  size: number,
  minSize: number,
  maxSize: number,
  flexible: boolean,
): CSSProperties {
  const style: CSSProperties = {};
  const isHorizontal = orientation === 'horizontal';

  if (isHorizontal) {
    style.minWidth = `${minSize}px`;
    if (Number.isFinite(maxSize)) style.maxWidth = `${maxSize}px`;

    if (flexible) {
      style.flexGrow = 1;
      style.flexShrink = 1;
      style.flexBasis = `${size}px`;
      return style;
    }

    style.flexGrow = 0;
    style.flexShrink = 0;
    style.flexBasis = `${size}px`;
    return style;
  }

  style.minHeight = `${minSize}px`;
  if (Number.isFinite(maxSize)) style.maxHeight = `${maxSize}px`;

  if (flexible) {
    style.flexGrow = 1;
    style.flexShrink = 1;
    style.flexBasis = `${size}px`;
    return style;
  }

  style.flexGrow = 0;
  style.flexShrink = 0;
  style.flexBasis = `${size}px`;
  return style;
}

export type { ResizableSplitPaneProps };
