import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { ReacstButton } from '@lumacast/ui';

export interface DockTitleProps {
  title: string;
  onHide: () => void;
  /** Dock-specific actions, rendered before the Hide button. */
  actions?: ReactNode;
  className?: string;
}

/** Title row shared by every dock: title, optional actions, and a Hide button named `Hide <title>`. */
export function DockTitle({ title, onHide, actions, className }: DockTitleProps) {
  return (
    <div className={className ? `dock-title ${className}` : 'dock-title'}>
      <span>{title}</span>
      <div className="dock-actions">
        {actions}
        <ReacstButton.Icon variant="ghost" size="sm" label={`Hide ${title}`} onClick={onHide}><X /></ReacstButton.Icon>
      </div>
    </div>
  );
}
