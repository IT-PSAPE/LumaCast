// Global keyboard shortcuts for the timeline. Installed once by `Timeline`;
// every handler reads fresh state via `useChordStore.getState()` so a single
// effect with an empty dependency array can own the listener for the whole
// component lifetime.
import { useEffect } from 'react';
import { nextCueStart, previousCueStart } from '../../../shared/cue-model';
import { useChordStore } from '../../store';
import { timelineEndMs } from '../playback';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

export function useTimelineShortcuts(): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;
      const state = useChordStore.getState();
      const meta = event.metaKey || event.ctrlKey;
      const cues = state.document.project.cues;
      const fps = state.document.project.composition.fps;

      switch (event.key) {
        case ' ':
          event.preventDefault();
          state.togglePlay();
          return;
        case 'Home':
          event.preventDefault();
          state.seek(0);
          return;
        case 'End':
          event.preventDefault();
          state.seek(timelineEndMs(state.document.project));
          return;
        case 'ArrowLeft':
          event.preventDefault();
          state.stepFrames(event.shiftKey ? -fps : -1);
          return;
        case 'ArrowRight':
          event.preventDefault();
          state.stepFrames(event.shiftKey ? fps : 1);
          return;
        case 'ArrowUp': {
          event.preventDefault();
          const target = previousCueStart(cues, state.playback.timeMs);
          state.seek(target ?? 0);
          return;
        }
        case 'ArrowDown': {
          event.preventDefault();
          const target = nextCueStart(cues, state.playback.timeMs);
          if (target !== null) state.seek(target);
          return;
        }
        case 'm':
        case 'M':
          event.preventDefault();
          if (state.tool === 'tap') state.tapMark();
          else state.addCue(state.playback.timeMs);
          return;
        case 's':
        case 'S':
          if (state.selection.length === 0) return;
          event.preventDefault();
          state.beginTransaction(state.selection.length > 1 ? `Split ${state.selection.length} cues` : 'Split cue');
          try {
            for (const id of state.selection) state.splitCueAt(id, state.playback.timeMs);
          } finally {
            state.endTransaction();
          }
          return;
        case 'Delete':
        case 'Backspace':
          if (state.selection.length === 0) return;
          event.preventDefault();
          state.deleteCues(state.selection);
          return;
        case 'a':
        case 'A':
          if (!meta) return;
          event.preventDefault();
          state.select(cues.map((cue) => cue.id), 'replace');
          return;
        case '=':
        case '+':
          if (!meta) return;
          event.preventDefault();
          state.zoomBy(1.25);
          return;
        case '-':
        case '_':
          if (!meta) return;
          event.preventDefault();
          state.zoomBy(1 / 1.25);
          return;
        case '0':
          if (!meta) return;
          event.preventDefault();
          state.zoomToFit();
          return;
        case 'l':
        case 'L':
          event.preventDefault();
          state.setLoop(!state.playback.loop);
          return;
        case 't':
        case 'T':
          event.preventDefault();
          state.setTool(state.tool === 'tap' ? 'select' : 'tap');
          return;
        case 'Escape':
          if (state.selection.length > 0) state.clearSelection();
          else if (state.tool === 'tap') state.setTool('select');
          return;
        default:
          return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
