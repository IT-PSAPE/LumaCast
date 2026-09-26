import type { ReactNode } from 'react';

export interface SceneFrameBaseProps {
  width: number;
  height: number;
  className?: string;
  stageClassName?: string;
  checkerboard?: boolean;
  children: ReactNode;
}
