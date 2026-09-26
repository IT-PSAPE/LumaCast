// The main editing layout: top bar, a middle row (canvas + inspector), and
// the timeline along the bottom. Also owns the window-wide drag-and-drop
// route (dropping a file anywhere admits it and routes it by kind), since
// that's shell chrome, not any one feature's concern.
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PanelResize, ReacstButton } from '@lumacast/ui';
import { AudioElement } from '../playback';
import { PreviewCanvas } from '../canvas/preview-canvas';
import { Timeline } from '../timeline';
import { getApi } from '../../api';
import { pushNotice } from '../../components/notice';
import { Inspector } from '../inspector';
import { importAudioFromFile, importBackgroundFromFile, importLyricsFromFile } from '../library/import-flows';
import { TopBar } from './top-bar';

const INSPECTOR_DEFAULT_WIDTH = 320;

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

export function Workspace() {
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_DEFAULT_WIDTH);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);

  useEffect(() => {
    function handleDragOver(event: DragEvent) {
      if (hasFiles(event)) event.preventDefault();
    }

    async function handleDrop(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;

      try {
        const api = getApi();
        const paths = api.pathsForFiles(files);
        if (paths.length === 0) return;
        const admitted = await api.admitFiles(paths);
        for (const file of admitted) {
          if (file.kind === 'audio') await importAudioFromFile(file);
          else if (file.kind === 'image' || file.kind === 'video') await importBackgroundFromFile(file);
          else if (file.kind === 'cues') await importLyricsFromFile(file);
        }
      } catch (error) {
        pushNotice(error instanceof Error ? error.message : 'Could not import the dropped file(s).', 'error');
      }
    }

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 bg-primary">
          <PreviewCanvas />
        </div>
        {inspectorCollapsed ? (
          <ReacstButton.Icon
            label="Show inspector"
            onClick={() => setInspectorCollapsed(false)}
            className="my-2 mr-2 h-fit shrink-0 self-center"
          >
            <ChevronLeft size={16} />
          </ReacstButton.Icon>
        ) : (
          <>
            <PanelResize width={inspectorWidth} onChange={setInspectorWidth} side="right" />
            <div className="relative shrink-0 border-l border-primary" style={{ width: inspectorWidth }}>
              <ReacstButton.Icon
                label="Collapse inspector"
                onClick={() => setInspectorCollapsed(true)}
                className="absolute left-0 top-2 z-10 -translate-x-1/2"
              >
                <ChevronRight size={16} />
              </ReacstButton.Icon>
              <Inspector />
            </div>
          </>
        )}
      </div>
      <Timeline />
      <AudioElement />
    </div>
  );
}
