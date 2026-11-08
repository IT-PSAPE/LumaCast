// The main editing layout: top bar, a middle row (canvas + inspector), and
// the timeline along the bottom. Also owns the window-wide drag-and-drop
// route (dropping a file anywhere admits it and routes it by kind), since
// that's shell chrome, not any one feature's concern.
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PanelResize, ReacstButton } from '@lumacast/ui';
import { AudioElement } from '../features/playback';
import { PreviewCanvas } from '../features/canvas';
import { Timeline } from '../features/timeline';
import { Inspector } from '../features/inspector';
import { importAudio, importBackground, importDroppedFiles } from './media-import';
import { TopBar } from './top-bar';

const INSPECTOR_DEFAULT_WIDTH = 320;

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

export function Workspace({ onSave }: { onSave: () => void }) {
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

      await importDroppedFiles(files);
    }

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar onSave={onSave} />
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
              <Inspector onImportBackground={importBackground} />
            </div>
          </>
        )}
      </div>
      <Timeline onImportAudio={importAudio} />
      <AudioElement />
    </div>
  );
}
