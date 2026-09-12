import type { ReactNode } from 'react';
import { ContainedSceneFrame } from './contained-scene-frame';
import { FillSceneFrame } from './fill-scene-frame';

interface SceneFrameProps {
  width: number;
  height: number;
  className?: string;
  stageClassName?: string;
  checkerboard?: boolean;
  fit?: 'fill' | 'contain';
  children: ReactNode;
}

export function SceneFrame({ width, height, className = '', stageClassName = '', checkerboard = false, fit = 'fill', children }: SceneFrameProps) {
  if (fit === 'fill') {
    return <FillSceneFrame width={width} height={height} className={className} stageClassName={stageClassName} checkerboard={checkerboard}>{children}</FillSceneFrame>;
  }

  return <ContainedSceneFrame width={width} height={height} className={className} stageClassName={stageClassName} checkerboard={checkerboard}>{children}</ContainedSceneFrame>;
}
