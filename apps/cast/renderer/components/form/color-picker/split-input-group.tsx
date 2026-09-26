export function SplitInputGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 items-stretch bg-tertiary [&>*:not(:last-child)]:border-r [&>*:not(:last-child)]:border-primary">
      {children}
    </div>
  );
}
