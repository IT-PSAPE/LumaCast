import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@renderer/utils/cn';
import { cv } from '@renderer/utils/cv';

type PanelMenuLevelProps = {
    child?: boolean;
};

function PanelRoot({ children, className }: HTMLAttributes<HTMLDivElement>) {
    return (
        <aside className={cn('w-full flex flex-col border-r border-secondary overflow-hidden bg-primary area-sidebar w-sidebar', className)} >
            {children}
        </aside>
    );
}

function PanelHeader({ children, className }: HTMLAttributes<HTMLDivElement>) {
    return (
        <header className={cn('w-full px-2 border-b border-secondary inline-flex justify-start items-center overflow-hidden', className)} >
            {children}
        </header>
    );
}

function PanelContent({ children, className }: HTMLAttributes<HTMLDivElement>) {
    return (
        <div className={cn('w-full inline-flex flex-col justify-start items-start min-h-0 flex-1 overflow-y-auto scrollbar-hidden', className)} >
            {children}
        </div>
    );
}

function PanelFooter({ children, className }: HTMLAttributes<HTMLDivElement>) {
    return (
        <div className={cn('px-2 border-t border-secondary inline-flex justify-start items-center overflow-hidden', className)} >
            <div className="flex-1 rounded-lg flex justify-start items-center gap-2">{children}</div>
        </div>
    );
}

function PanelGroup({ children, className }: HTMLAttributes<HTMLDivElement>) {
    return (
        <div className={cn('w-full inline-flex flex-col justify-start items-start', className)}>{children}</div>
    );
}


function PanelGroupTitle({ children, className }: HTMLAttributes<HTMLDivElement>) {
    return (
        <div className={cn('w-full h-9 px-2 inline-flex justify-start items-center gap-2.5 border-b border-secondary', className)}>
            {children}
        </div>
    );
}

function PanelGroupFooter({ children, className }: HTMLAttributes<HTMLDivElement>) {
    return (
        <div className={cn('w-full h-6 px-2 inline-flex justify-start items-center gap-2.5 border-t border-secondary', className)}>
            {children}
        </div>
    );
}

function PanelGroupContent({ children, className }: HTMLAttributes<HTMLDivElement>) {
    return (
        <div className={cn('w-full px-2 flex flex-col justify-start items-start', className)}>{children}</div>
    );
}

type PanelMenuItemProps = PanelMenuLevelProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
    active?: boolean;
    children?: ReactNode;
};

const menuItemVariants = cv({
    base: ['w-full min-h-7 py-1 px-2 rounded-sm inline-flex justify-start items-center gap-2 overflow-hidden'],
    variants: {
        state: {
            active: ['bg-foreground-brand_primary text-primary_on-brand hover:bg-brand_solid'],
            inactive: ['bg-transparent text-secondary hover:bg-tertiary active:bg-secondary'],
        },
    },
    defaultVariants: {
        state: 'inactive',
    },
});

const PanelMenuItem = forwardRef<HTMLButtonElement, PanelMenuItemProps>(function PanelMenuItem(
    { children, active = false, className, onClick, ...buttonProps },
    ref,
) {
    const itemState = active ? 'active' : 'inactive';
    const cursorClassName = onClick ? 'cursor-pointer' : 'cursor-default';

    return (
        <div className="w-full">
            <button
                ref={ref}
                type="button"
                className={cn(menuItemVariants({ state: itemState }), cursorClassName, className)}
                onClick={onClick}
                {...buttonProps}
            >
                {children}
            </button>
        </div>
    );
});

export const LumaCastPanel = {
    Root: PanelRoot,
    Header: PanelHeader,
    Content: PanelContent,
    Footer: PanelFooter,
    Group: PanelGroup,
    GroupTitle: PanelGroupTitle,
    GroupFooter: PanelGroupFooter,
    GroupContent: PanelGroupContent,
    MenuItem: PanelMenuItem,
};
