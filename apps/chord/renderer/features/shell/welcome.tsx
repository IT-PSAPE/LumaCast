// Shown instead of the workspace while the document is untitled, empty, and
// has no audio: nothing to lose by starting fresh or picking up a recent
// project.
import { useEffect, useState } from 'react';
import { FilePlus2, FolderOpen } from 'lucide-react';
import { Label, Paragraph, ReacstButton, Title } from '@lumacast/ui';
import type { RecentProject } from '../../../shared/project';
import { getApi } from '../../api';
import { useChordStore } from '../../store';

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return 'just now';
  if (diffMs < hour) return `${Math.max(1, Math.round(diffMs / minute))}m ago`;
  if (diffMs < day) return `${Math.round(diffMs / hour)}h ago`;
  return `${Math.round(diffMs / day)}d ago`;
}

export function Welcome() {
  const newDocument = useChordStore((s) => s.newDocument);
  const openDocument = useChordStore((s) => s.openDocument);
  const [recent, setRecent] = useState<RecentProject[]>([]);

  useEffect(() => {
    let cancelled = false;
    void getApi().recentProjects().then((list) => {
      if (!cancelled) setRecent(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 px-6 text-center">
        <Title.h1>LumaChord</Title.h1>
        <div className="flex gap-2">
          <ReacstButton onClick={() => void newDocument()}>
            <FilePlus2 size={16} /> New project
          </ReacstButton>
          <ReacstButton onClick={() => void openDocument()}>
            <FolderOpen size={16} /> Open…
          </ReacstButton>
        </div>

        {recent.length > 0 ? (
          <div className="w-full text-left">
            <Label.xs className="text-tertiary">Recent</Label.xs>
            <ul className="mt-2 flex flex-col gap-0.5">
              {recent.map((project) => (
                <li key={project.path}>
                  <button
                    type="button"
                    onClick={() => void openDocument(project.path)}
                    className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-tertiary"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <span className="label-sm block truncate text-primary">{project.title}</span>
                      <span className="label-xs block truncate text-tertiary">{project.path}</span>
                    </span>
                    <span className="label-xs shrink-0 text-tertiary">{formatRelativeTime(project.openedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <Paragraph.sm className="text-tertiary">Drop an audio file, a background image or video, or a lyric file to get started.</Paragraph.sm>
      </div>
    </div>
  );
}
