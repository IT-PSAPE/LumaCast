import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { AUTOMATION_LIVE_SLIDE_EVENT, AUTOMATION_TRIGGER_EVENT, type Cue, type Macro, type TriggerBinding } from '@lumacast/automation';
import type { Slide } from '@lumacast/composition';
import { AutomationProvider, useAutomation } from '../../../../../../apps/cast/renderer/features/automation/automation-context';
import type { PlaybackCommandPort } from '../../../../../../apps/cast/renderer/contexts/playback/playback-context';

// Covers #222: automation reaches playback through the unified PlaybackCommandPort
// rather than bypassing the playback boundary by importing context slices directly.

const mocks = vi.hoisted(() => ({
  cast: {
    snapshot: {} as unknown,
    mutatePatch: vi.fn(),
    runOperation: vi.fn(),
    setStatusText: vi.fn(),
  },
  project: {
    cues: [] as Cue[],
    macros: [] as Macro[],
    triggerBindings: [] as TriggerBinding[],
    cuesById: new Map<string, Cue>(),
    macrosById: new Map<string, Macro>(),
    liveSlidesById: new Map<string, Slide>(),
  },
  liveSlide: null as Slide | null,
  playbackCommands: {
    activateOverlay: vi.fn(),
    clearOverlay: vi.fn(),
    clearAllOverlays: vi.fn(),
    setMediaLayerAsset: vi.fn(),
    armVideo: vi.fn(),
    clearVideo: vi.fn(),
    armAudio: vi.fn(),
    clearAudio: vi.fn(),
    setCurrentStageId: vi.fn(),
    clearLayer: vi.fn(),
    clearAllLayers: vi.fn(),
  } as PlaybackCommandPort,
}));

vi.mock('../../../../../../apps/cast/renderer/contexts/app-context', () => ({
  useCast: () => ({
    snapshot: mocks.cast.snapshot,
    mutatePatch: mocks.cast.mutatePatch,
    runOperation: mocks.cast.runOperation,
    setStatusText: mocks.cast.setStatusText,
  }),
}));

vi.mock('../../../../../../apps/cast/renderer/contexts/use-project-content', () => ({
  useProjectContent: () => mocks.project,
}));

vi.mock('../../../../../../apps/cast/renderer/contexts/playback/playback-context', () => ({
  usePlaybackCommands: () => mocks.playbackCommands,
}));

vi.mock('../../../../../../apps/cast/renderer/contexts/slide-context', () => ({
  useSlides: () => ({ liveSlide: mocks.liveSlide }),
}));

vi.mock('../../../../../../apps/cast/renderer/features/observability/metrics-store', () => ({
  recordObsEvent: vi.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <AutomationProvider>{children}</AutomationProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.project.cues = [];
  mocks.project.macros = [];
  mocks.project.cuesById = new Map();
  mocks.project.macrosById = new Map();
  mocks.project.triggerBindings = [];
  mocks.project.liveSlidesById = new Map();
  mocks.liveSlide = null;
});

afterEach(() => {
  cleanup();
});

function makeCue(id: string, kind: Cue['kind'], payload: Cue['payload'], failurePolicy: Cue['failurePolicy'] = 'continue'): Cue {
  const now = new Date().toISOString();
  return {
    id,
    kind,
    payload,
    failurePolicy,
    createdAt: now,
    updatedAt: now,
  };
}

function makeMacro(id: string, name: string, cues: Array<{ cue: Cue; orderIndex: number; delayBeforeMs?: number; delayAfterMs?: number }>): Macro {
  const now = new Date().toISOString();
  return {
    id,
    name,
    description: '',
    order: 0,
    scopeLevel: 'global',
    onScopeExit: 'none',
    loopEnabled: false,
    loopCount: null,
    cues: cues.map((c, index) => ({
      id: `mc-${id}-${index}`,
      macroId: id,
      cueId: c.cue.id,
      cue: c.cue,
      orderIndex: c.orderIndex,
      delayBeforeMs: c.delayBeforeMs ?? 0,
      delayAfterMs: c.delayAfterMs ?? 0,
      createdAt: now,
      updatedAt: now,
    })),
    createdAt: now,
    updatedAt: now,
  };
}

describe('automation playback boundary (#222)', () => {
  it('keeps a song-scoped macro running when output enters its generated blank', async () => {
    vi.useFakeTimers();
    try {
      const cue = makeCue('video', 'video.arm', { assetId: 'video' });
      const macro = {
        ...makeMacro('song-macro', 'Song macro', [{ cue, orderIndex: 0, delayBeforeMs: 50 }]),
        scopeLevel: 'item' as const, onScopeExit: 'cancel' as const,
      };
      mocks.project.cues = [cue];
      mocks.project.cuesById = new Map([[cue.id, cue]]);
      mocks.project.macros = [macro];
      mocks.project.macrosById = new Map([[macro.id, macro]]);
      const authored = { id: 's1', presentationId: null, lyricId: 'song' } as Slide;
      const blank = { ...authored, id: 'runtime:lyric:song:blank:end', runtimeBlank: 'end' } as Slide;
      mocks.project.liveSlidesById = new Map([[authored.id, authored], [blank.id, blank]]);
      mocks.project.triggerBindings = [{
        id: 'enter', sourceId: authored.id, triggerType: 'slide.activate', targetType: 'macro', targetId: macro.id,
        config: {}, enabled: true, createdAt: '', updatedAt: '',
      }];
      mocks.liveSlide = authored;
      const view = renderHook(() => useAutomation(), { wrapper });
      act(() => {
        window.dispatchEvent(new CustomEvent(AUTOMATION_TRIGGER_EVENT, { detail: { triggerType: 'slide.activate', sourceId: authored.id } }));
      });
      mocks.liveSlide = blank;
      view.rerender();
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(mocks.playbackCommands.armVideo).toHaveBeenCalledWith('video');
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs Exit cleanup before output arming and does not repeat it on Activate', () => {
    const cue = makeCue('exit-clear', 'layer.clearAll', {});
    mocks.project.cues = [cue];
    mocks.project.cuesById = new Map([[cue.id, cue]]);
    mocks.project.triggerBindings = [{
      id: 'exit', sourceId: 's1', triggerType: 'slide.exit', targetType: 'cue', targetId: cue.id,
      config: {}, enabled: true, createdAt: '', updatedAt: '',
    }];
    mocks.liveSlide = { id: 's1' } as Slide;
    const view = renderHook(() => useAutomation(), { wrapper });
    const armIncoming = vi.fn();
    act(() => {
      window.dispatchEvent(new CustomEvent(AUTOMATION_LIVE_SLIDE_EVENT, { detail: { slideId: 's2' } }));
      armIncoming();
      window.dispatchEvent(new CustomEvent(AUTOMATION_TRIGGER_EVENT, { detail: { triggerType: 'slide.activate', sourceId: 's2' } }));
    });
    expect(mocks.playbackCommands.clearAllLayers).toHaveBeenCalledTimes(1);
    expect(vi.mocked(mocks.playbackCommands.clearAllLayers).mock.invocationCallOrder[0]).toBeLessThan(armIncoming.mock.invocationCallOrder[0]);
    mocks.liveSlide = { id: 's2' } as Slide;
    view.rerender();
    expect(mocks.playbackCommands.clearAllLayers).toHaveBeenCalledTimes(1);
  });

  it('fires Exit on output changes and unarming without repeating an activation transition', () => {
    const cue = makeCue('exit', 'audio.clear', {});
    mocks.project.cues = [cue];
    mocks.project.cuesById = new Map([[cue.id, cue]]);
    mocks.project.triggerBindings = ['s1', 's2'].map((sourceId) => ({
      id: sourceId, sourceId, triggerType: 'slide.exit', targetType: 'cue', targetId: cue.id,
      config: {}, enabled: true, createdAt: '', updatedAt: '',
    }));
    mocks.liveSlide = { id: 's1' } as Slide;
    const view = renderHook(() => useAutomation(), { wrapper });
    expect(mocks.playbackCommands.clearAudio).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new CustomEvent(AUTOMATION_TRIGGER_EVENT, {
        detail: { triggerType: 'slide.activate', sourceId: 's2' },
      }));
    });
    expect(mocks.playbackCommands.clearAudio).toHaveBeenCalledTimes(1);
    mocks.liveSlide = { id: 's2' } as Slide;
    view.rerender();
    expect(mocks.playbackCommands.clearAudio).toHaveBeenCalledTimes(1);
    mocks.liveSlide = null;
    view.rerender();
    view.rerender();
    expect(mocks.playbackCommands.clearAudio).toHaveBeenCalledTimes(2);
  });

  it('routes single cue playback execution strictly through PlaybackCommandPort', async () => {
    const videoCue = makeCue('cue-v1', 'video.arm', { assetId: 'asset-video-1' });
    mocks.project.cues = [videoCue];
    mocks.project.cuesById = new Map([[videoCue.id, videoCue]]);

    const { result } = renderHook(() => useAutomation(), { wrapper });

    await act(async () => {
      await result.current.actions.runCue('cue-v1');
    });

    expect(mocks.playbackCommands.armVideo).toHaveBeenCalledWith('asset-video-1');
    expect(mocks.playbackCommands.clearVideo).not.toHaveBeenCalled();
  });

  it('routes clearAll layers and audio/overlay cues through PlaybackCommandPort', async () => {
    const audioCue = makeCue('cue-a1', 'audio.arm', { assetId: 'audio-1' });
    const clearAllCue = makeCue('cue-clear-all', 'layer.clearAll', {});
    mocks.project.cues = [audioCue, clearAllCue];
    mocks.project.cuesById = new Map([
      [audioCue.id, audioCue],
      [clearAllCue.id, clearAllCue],
    ]);

    const { result } = renderHook(() => useAutomation(), { wrapper });

    await act(async () => {
      await result.current.actions.runCue('cue-a1');
      await result.current.actions.runCue('cue-clear-all');
    });

    expect(mocks.playbackCommands.armAudio).toHaveBeenCalledWith('audio-1');
    expect(mocks.playbackCommands.clearAllLayers).toHaveBeenCalledTimes(1);
  });

  it('reverts macro-applied cue effects via PlaybackCommandPort on revert lifecycle', async () => {
    const overlayCue = makeCue('cue-o1', 'overlay.activate', { overlayId: 'ov-1' });
    const revertCue = makeCue('cue-revert', 'flow.lifecycle', { action: 'revert', target: 'macro-1' });
    const macro = makeMacro('macro-1', 'Test Macro', [
      { cue: overlayCue, orderIndex: 0 },
      { cue: overlayCue, orderIndex: 1, delayBeforeMs: 1000 },
    ]);

    mocks.project.cues = [overlayCue, revertCue];
    mocks.project.cuesById = new Map([
      [overlayCue.id, overlayCue],
      [revertCue.id, revertCue],
    ]);
    mocks.project.macros = [macro];
    mocks.project.macrosById = new Map([[macro.id, macro]]);

    const { result } = renderHook(() => useAutomation(), { wrapper });

    let macroPromise: Promise<void> | undefined;
    await act(async () => {
      macroPromise = result.current.actions.runMacro('macro-1');
      // allow initial cue to execute and enter delay
      await Promise.resolve();
    });

    expect(mocks.playbackCommands.activateOverlay).toHaveBeenCalledWith('ov-1');

    await act(async () => {
      await result.current.actions.runCue('cue-revert');
      await macroPromise;
    });

    expect(mocks.playbackCommands.clearOverlay).toHaveBeenCalledWith('ov-1');
  });

  it('exposes a cancel-active-macros action that cancels runs across scopes', async () => {
    const overlayCue = makeCue('cue-o1', 'overlay.activate', { overlayId: 'ov-1' });
    const macro = makeMacro('macro-1', 'Test Macro', [
      { cue: overlayCue, orderIndex: 0, delayAfterMs: 1000 },
    ]);

    mocks.project.cues = [overlayCue];
    mocks.project.cuesById = new Map([[overlayCue.id, overlayCue]]);
    mocks.project.macros = [macro];
    mocks.project.macrosById = new Map([[macro.id, macro]]);

    const { result } = renderHook(() => useAutomation(), { wrapper });

    let macroPromise: Promise<void> | undefined;
    await act(async () => {
      macroPromise = result.current.actions.runMacro('macro-1');
      await Promise.resolve();
    });

    expect(mocks.playbackCommands.activateOverlay).toHaveBeenCalledWith('ov-1');

    await act(async () => {
      result.current.actions.cancelActiveMacros();
      await macroPromise;
    });

    expect(mocks.playbackCommands.clearOverlay).not.toHaveBeenCalled();
  });

  // #222 acceptance criterion: prove automation and operator writes cannot
  // interleave into an inconsistent arm state, OR document precisely why they
  // still can and what #134 must do about it. They still can — this test pins
  // that honestly rather than asserting a serialization the seam does not
  // provide.
  //
  // What the seam DID fix: automation no longer reaches around the playback
  // boundary into context slices, so there is now exactly one named write path
  // and #134 has a single place to intercept.
  //
  // What it did NOT fix: the port is a facade over the same state setters the
  // operator UI drives. `applyCueAction` is synchronous per cue, but
  // `executeCue` awaits `cancellableDelay` BETWEEN cues, so an operator write
  // lands mid-macro and is silently overwritten by the next cue. Resolution is
  // last-write-wins and neither side can observe that the other acted.
  //
  // #134 must therefore make the headless machine the single owner of arm
  // state and give it a serialized, ordered transition queue — routing both
  // writers through this port is a prerequisite, not the fix.
  it('DOCUMENTS THE REMAINING GAP (#222/#134): an operator write mid-macro is silently overwritten', async () => {
    const armed: Array<string | null> = [];
    const statefulPort = {
      ...mocks.playbackCommands,
      armVideo: vi.fn((assetId: string) => { armed.push(assetId); }),
      clearVideo: vi.fn(() => { armed.push(null); }),
    } as unknown as PlaybackCommandPort;
    const original = mocks.playbackCommands;
    mocks.playbackCommands = statefulPort;

    try {
      const armA = makeCue('cue-arm-a', 'video.arm', { assetId: 'asset-A' });
      const armB = makeCue('cue-arm-b', 'video.arm', { assetId: 'asset-B' });
      const macro = makeMacro('macro-race', 'Race Macro', [
        { cue: armA, orderIndex: 0 },
        { cue: armB, orderIndex: 1, delayBeforeMs: 20 },
      ]);

      mocks.project.cues = [armA, armB];
      mocks.project.cuesById = new Map([[armA.id, armA], [armB.id, armB]]);
      mocks.project.macros = [macro];
      mocks.project.macrosById = new Map([[macro.id, macro]]);

      const { result } = renderHook(() => useAutomation(), { wrapper });

      let macroPromise: Promise<void> | undefined;
      await act(async () => {
        macroPromise = result.current.actions.runMacro('macro-race');
        await Promise.resolve();
      });

      // The macro has applied its first cue and is now awaiting the delay
      // before its second. This is the window an operator write lands in.
      expect(armed).toEqual(['asset-A']);

      await act(async () => {
        // The operator clears video through the same port the operator UI uses.
        statefulPort.clearVideo();
        await macroPromise;
      });

      // The macro's second cue ran after the operator's clear and overwrote it.
      // Nothing rejected, nothing was reported, and neither writer observed the
      // other — exactly the last-write-wins hazard #134 must remove.
      expect(armed).toEqual(['asset-A', null, 'asset-B']);
    } finally {
      mocks.playbackCommands = original;
    }
  });

  it('proves automation-context.tsx does not import direct playback slice hooks', () => {
    const filePath = path.resolve(__dirname, '../../../../../../apps/cast/renderer/features/automation/automation-context.tsx');
    const content = fs.readFileSync(filePath, 'utf8');

    const forbiddenHooks = [
      'useAudio',
      'useVideo',
      'useStagePlayback',
      'usePresentationMediaLayer',
      'usePresentationOverlayLayer',
      'usePresentationLayerActions',
      'usePresentationLayers',
      'usePresentationRenderLayer',
    ];

    for (const hook of forbiddenHooks) {
      expect(content).not.toContain(hook);
    }
    expect(content).toContain('usePlaybackCommands');
  });
});
