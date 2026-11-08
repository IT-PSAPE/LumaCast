import { describe, expect, it, vi } from 'vitest';
import { createDefaultProject, type StreamSource } from '../../../../apps/stream/shared/desktop-api';
import { createSourcesDockProps } from '../../../../apps/stream/renderer/application/sources-dock';
import type { UseSourcesResult } from '../../../../apps/stream/renderer/features/sources';
import { getSourceRuntimeId, toRuntimeSource } from '../../../../apps/stream/renderer/source-runtime';
import { DEFAULT_WORKBENCH_LAYOUT } from '../../../../apps/stream/renderer/workbench-layout';

vi.mock('../../../../apps/stream/renderer/docks/source-properties', () => ({ SourceProperties: () => null }));

function makeNdiSource(): StreamSource {
  return {
    id: 'ndi-source', name: 'NDI input', kind: 'ndi', ndiSourceName: 'Camera', visible: true,
    muted: false, volume: 1, transform: { x: 0, y: 0, width: 100, height: 100 },
  };
}

describe('SourcesDockContainer composition', () => {
  it('projects app feature capabilities into the dock contract', () => {
    const project = createDefaultProject();
    const activeScene = project.scenes[0]!;
    const source = makeNdiSource();
    activeScene.sources = [source];
    const runtimeSource = toRuntimeSource(source);
    const runtimeId = getSourceRuntimeId(runtimeSource);
    const action = vi.fn();
    const sourceFeature = new Proxy({
      selectedSource: source,
      selectedSourceIds: [source.id],
      collapsedGroupIds: [],
      canGroupSelectedSources: false,
      sourceClipboardAvailable: false,
      sourceMenuOpen: true,
      sourceActionsMenuOpen: false,
      sourceMenuTriggerRef: { current: null },
      sourceActionsTriggerRef: { current: null },
    }, {
      get: (target, key) => typeof key === 'string' && key in target ? target[key as keyof typeof target] : action,
    }) as unknown as UseSourcesResult;
    const capture = new Proxy({ inputDeviceOptions: { camera: [], microphone: [] } }, {
      get: (target, key) => typeof key === 'string' && key in target ? target[key as keyof typeof target] : action,
    });
    const retrySource = vi.fn();
    const toggleDock = vi.fn();
    const openNdiInput = vi.fn();
    const openSourceProperties = vi.fn();
    const props = createSourcesDockProps({
      project,
      activeScene,
      platform: 'win32',
      desktopAudioMode: 'unavailable',
      applicationAudioSupported: false,
      working: false,
      sourceFeature,
      capture: capture as never,
      ndi: { retrySource, sourceErrors: { [runtimeId]: 'NDI disconnected' } },
      runtime: {
        visibleEditorSources: [runtimeSource],
        visibleDraftSourceIds: new Set([source.id]),
        programSourceIds: new Set([runtimeId]),
        runtimes: new Map(),
        mediaElements: new Map(),
        meterLevels: { [source.id]: 0.5 },
        mediaPlaybackStates: {},
        captureStatuses: {},
        resourceStatuses: {},
      },
      workbench: {
        workbenchLayout: DEFAULT_WORKBENCH_LAYOUT,
        visibleDockIds: ['scenes', 'sources'],
        toggleDock,
        resizerForDock: () => undefined,
        dockDragOpacity: () => undefined,
      },
      onOpenNdiInput: openNdiInput,
      onOpenSourceProperties: openSourceProperties,
    });

    props.addSourceMenu.onAddNdi?.();
    expect(action).toHaveBeenCalledWith(false);
    expect(openNdiInput).toHaveBeenCalledOnce();
    props.addSourceMenu.onOpenCapturePicker('screen', source.id);
    expect(action).toHaveBeenCalledWith('screen', source.id);
    props.properties.onReconnectNdi?.(source);
    expect(retrySource).toHaveBeenCalledWith(runtimeId);
    props.onOpenSourceProperties?.(source.id);
    expect(openSourceProperties).toHaveBeenCalledWith(source.id);
    expect(props.properties.playbackInProgram).toBe(true);
    expect(props.sourceStatuses?.[source.id]).toEqual({ state: 'unavailable', message: 'NDI disconnected' });
    expect(props.style?.borderRight).toBe(0);
    expect(props.onHide).toBeTypeOf('function');
  });
});
