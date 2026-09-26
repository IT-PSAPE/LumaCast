// A bottom-left stack of dismissible notices: cue-import warnings, and
// errors surfaced from the desktop API. `pushNotice`/`dismissNotice` are
// plain functions so any module (not just components) can raise one;
// `NoticeStack` (mounted once, in `App.tsx`) is what actually renders them.
import { AlertTriangle, Info, X } from 'lucide-react';
import { create } from 'zustand';
import { cn } from '@lumacast/ui';

export type NoticeKind = 'info' | 'error';

interface Notice {
  id: string;
  kind: NoticeKind;
  message: string;
}

interface NoticeStoreState {
  notices: Notice[];
}

const useNoticeStore = create<NoticeStoreState>(() => ({ notices: [] }));

let sequence = 0;

export function pushNotice(message: string, kind: NoticeKind = 'info'): string {
  const id = `notice-${(sequence += 1)}`;
  useNoticeStore.setState((state) => ({ notices: [...state.notices, { id, kind, message }] }));
  return id;
}

export function dismissNotice(id: string): void {
  useNoticeStore.setState((state) => ({ notices: state.notices.filter((notice) => notice.id !== id) }));
}

export function NoticeStack() {
  const notices = useNoticeStore((state) => state.notices);
  if (notices.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {notices.map((notice) => (
        <div
          key={notice.id}
          className={cn(
            'pointer-events-auto flex items-start gap-2 rounded-md border border-primary bg-primary px-3 py-2 shadow-lg',
            notice.kind === 'error' && 'border-error/40',
          )}
        >
          {notice.kind === 'error' ? (
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-error" />
          ) : (
            <Info size={16} className="mt-0.5 shrink-0 text-tertiary" />
          )}
          <p className="label-sm min-w-0 flex-1 text-secondary">{notice.message}</p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismissNotice(notice.id)}
            className="shrink-0 cursor-pointer rounded p-0.5 text-tertiary hover:bg-tertiary hover:text-primary"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
