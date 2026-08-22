import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Id } from '@lumacast/kernel';
import type { ItemRef } from '@lumacast/composition';
import type { Cue, Macro, MacroCue, OnScopeExit, ScopeLevel, TriggerBinding } from './model';
import {
  createAutomationRuntime,
  resolveMacroScope,
  type AutomationObservabilityPort,
  type AutomationClock,
  type AutomationPlaybackPort,
  type AutomationRuntime,
  type AutomationRuntimePorts,
  type MacroScopeContext,
} from './runtime';

// Pins the deterministic macro/cue runtime semantics (issue #219 W8) against
// a fake clock so nothing here waits on real time. See CONTEXT.md's
// "Automation (Macros & Cues)" glossary for Macro / Cue / Scope / Macro Run /
// Scope exit / Cancel / Revert.

function makeCue(id: string, kind: Cue['kind'], payload: Cue['payload']): Cue {
  const now = '2026-01-01T00:00:00.000Z';
  return { id, kind, payload, failurePolicy: 'continue', createdAt: now, updatedAt: now };
}

function makeMacroCue(cue: Cue, orderIndex: number, delayBeforeMs = 0, delayAfterMs = 0): MacroCue {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: `mc-${cue.id}-${orderIndex}`,
    macroId: 'macro-under-test',
    cueId: cue.id,
    cue,
    orderIndex,
    delayBeforeMs,
    delayAfterMs,
    createdAt: now,
    updatedAt: now,
  };
}

function makeMacro(id: string, cues: MacroCue[], overrides: Partial<Macro> = {}): Macro {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id,
    name: `Macro ${id}`,
    description: '',
    cues,
    order: 0,
    scopeLevel: 'global',
    onScopeExit: 'none',
    loopEnabled: false,
    loopCount: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeBinding(overrides: Partial<TriggerBinding>): TriggerBinding {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'binding-1',
    triggerType: 'slide.activate',
    sourceId: null,
    targetType: 'macro',
    targetId: 'macro-1',
    config: {},
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makePlaybackPort(): AutomationPlaybackPort {
  return {
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
  };
}

// Delegates to the global setTimeout/clearTimeout so vitest's fake timers
// (installed per-test below) make every delay in the runtime deterministic
// and instantaneous under `vi.advanceTimersByTimeAsync`.
const testClock: AutomationClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const GLOBAL_SCOPE: MacroScopeContext = { scope: 'global', boundContextId: null, onScopeExit: 'none' };

function makeRuntime(playback: AutomationPlaybackPort): AutomationRuntime {
  const ports: AutomationRuntimePorts = { playback, clock: testClock };
  return createAutomationRuntime(() => ports);
}

function makeRuntimeWithPorts(
  playback: AutomationPlaybackPort,
  overrides: Partial<AutomationRuntimePorts> = {},
): AutomationRuntime {
  const ports: AutomationRuntimePorts = {
    playback,
    clock: testClock,
    ...overrides,
  };
  return createAutomationRuntime(() => ports);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('resolveMacroScope', () => {
  it('binds a slide-scoped macro to the triggering slide', () => {
    const macro = makeMacro('m1', [], { scopeLevel: 'slide' });
    const scope = resolveMacroScope(macro, 'slide.take', 'slide-1', () => null);
    expect(scope).toEqual({ scope: 'slide', boundContextId: 'slide-1', onScopeExit: 'none' });
  });

  it('falls back to global for a scoped macro with no slide context (manual run / app.startup)', () => {
    const macro = makeMacro('m1', [], { scopeLevel: 'item' });
    const scope = resolveMacroScope(macro, null, null, () => null);
    expect(scope).toEqual({ scope: 'global', boundContextId: null, onScopeExit: 'none' });
  });
});

describe('startMacroRun: delays and ordering', () => {
  it('runs cue steps in order, waiting out each before/after delay', async () => {
    const playback = makePlaybackPort();
    const runtime = makeRuntime(playback);
    const order: string[] = [];
    (playback.activateOverlay as ReturnType<typeof vi.fn>).mockImplementation((id: Id) => order.push(`overlay:${id}`));
    (playback.armVideo as ReturnType<typeof vi.fn>).mockImplementation((id: Id) => order.push(`video:${id}`));

    const overlayCue = makeCue('cue-o', 'overlay.activate', { overlayId: 'ov-1' });
    const videoCue = makeCue('cue-v', 'video.arm', { assetId: 'asset-1' });
    const cues = new Map([[overlayCue.id, overlayCue], [videoCue.id, videoCue]]);
    const macro = makeMacro('macro-1', [
      makeMacroCue(overlayCue, 0, 0, 100),
      makeMacroCue(videoCue, 1, 50, 0),
    ]);

    const runPromise = runtime.startMacroRun(macro, (id) => cues.get(id), GLOBAL_SCOPE);
    expect(order).toEqual(['overlay:ov-1']); // applied before any await is awaited by the caller

    await vi.advanceTimersByTimeAsync(200);
    await runPromise;

    expect(order).toEqual(['overlay:ov-1', 'video:asset-1']);
  });

  it('loops while loopEnabled, stopping at loopCount', async () => {
    const playback = makePlaybackPort();
    const runtime = makeRuntime(playback);
    const cue = makeCue('cue-o', 'overlay.activate', { overlayId: 'ov-1' });
    const cues = new Map([[cue.id, cue]]);
    const macro = makeMacro('macro-loop', [makeMacroCue(cue, 0)], { loopEnabled: true, loopCount: 3 });

    const runPromise = runtime.startMacroRun(macro, (id) => cues.get(id), GLOBAL_SCOPE);
    await vi.runAllTimersAsync();
    await runPromise;

    expect(playback.activateOverlay).toHaveBeenCalledTimes(3);
  });

  it('paces a zero-delay infinite loop to the floor interval instead of spinning', async () => {
    const playback = makePlaybackPort();
    const runtime = makeRuntime(playback);
    const cue = makeCue('cue-o', 'overlay.activate', { overlayId: 'ov-1' });
    const cues = new Map([[cue.id, cue]]);
    const macro = makeMacro('macro-loop', [makeMacroCue(cue, 0)], { loopEnabled: true, loopCount: null });

    const runPromise = runtime.startMacroRun(macro, (id) => cues.get(id), GLOBAL_SCOPE);
    await vi.advanceTimersByTimeAsync(15);
    expect(playback.activateOverlay).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(playback.activateOverlay).toHaveBeenCalledTimes(2);

    runtime.applyLifecycle('cancel', '*', null);
    await runPromise;
  });

  it('does not add extra delay when the cue-step delays already exceed the loop floor', async () => {
    const playback = makePlaybackPort();
    const runtime = makeRuntime(playback);
    const cue = makeCue('cue-o', 'overlay.activate', { overlayId: 'ov-1' });
    const cues = new Map([[cue.id, cue]]);
    const macro = makeMacro('macro-loop', [makeMacroCue(cue, 0, 0, 30)], { loopEnabled: true, loopCount: 2 });

    const runPromise = runtime.startMacroRun(macro, (id) => cues.get(id), GLOBAL_SCOPE);
    await vi.advanceTimersByTimeAsync(29);
    expect(playback.activateOverlay).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2);
    expect(playback.activateOverlay).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(30);
    await runPromise;
  });
});

describe('trigger stacking', () => {
  it('a second trigger stacks a second Macro Run rather than deduping', async () => {
    const playback = makePlaybackPort();
    const runtime = makeRuntime(playback);
    const cue = makeCue('cue-o', 'overlay.activate', { overlayId: 'ov-1' });
    const cues = new Map([[cue.id, cue]]);
    // A delayAfter keeps the run parked (still registered) so both stacked
    // runs are observable at once.
    const macro = makeMacro('macro-1', [makeMacroCue(cue, 0, 0, 1_000)]);

    const first = runtime.startMacroRun(macro, (id) => cues.get(id), GLOBAL_SCOPE);
    const second = runtime.startMacroRun(macro, (id) => cues.get(id), GLOBAL_SCOPE);

    expect(runtime.runs.size).toBe(2);
    const [firstId, secondId] = [...runtime.runs.keys()];
    expect(firstId).not.toBe(secondId);
    expect(playback.activateOverlay).toHaveBeenCalledTimes(2);

    runtime.applyLifecycle('cancel', '*', null);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all([first, second]);
  });

  it('fireTrigger resolves scope from the trigger and starts the bound macro (never dedupes across fires)', async () => {
    const playback = makePlaybackPort();
    const runtime = makeRuntime(playback);
    const cue = makeCue('cue-o', 'overlay.activate', { overlayId: 'ov-1' });
    const cues = new Map([[cue.id, cue]]);
    const macro = makeMacro('macro-1', [makeMacroCue(cue, 0)], { scopeLevel: 'slide' });
    const macros = new Map([[macro.id, macro]]);
    const binding = makeBinding({ triggerType: 'slide.take', sourceId: 'slide-1', targetType: 'macro', targetId: macro.id });

    runtime.fireTrigger('slide.take', 'slide-1', {
      triggerBindings: [binding],
      resolveCue: (id) => cues.get(id),
      resolveMacro: (id) => macros.get(id),
      resolveItemRef: () => null,
    });
    runtime.fireTrigger('slide.take', 'slide-1', {
      triggerBindings: [binding],
      resolveCue: (id) => cues.get(id),
      resolveMacro: (id) => macros.get(id),
      resolveItemRef: () => null,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(playback.activateOverlay).toHaveBeenCalledTimes(2);
  });
});

describe('Cancel', () => {
  it('stops a pending delay and any further loop/cue steps, but keeps already-applied effects', async () => {
    const playback = makePlaybackPort();
    const runtime = makeRuntime(playback);
    const overlayCue = makeCue('cue-o', 'overlay.activate', { overlayId: 'ov-1' });
    const videoCue = makeCue('cue-v', 'video.arm', { assetId: 'asset-1' });
    const cues = new Map([[overlayCue.id, overlayCue], [videoCue.id, videoCue]]);
    const macro = makeMacro('macro-1', [
      makeMacroCue(overlayCue, 0, 0, 1_000),
      makeMacroCue(videoCue, 1),
    ]);

    const runPromise = runtime.startMacroRun(macro, (id) => cues.get(id), GLOBAL_SCOPE);
    expect(playback.activateOverlay).toHaveBeenCalledWith('ov-1');

    runtime.applyLifecycle('cancel', '*', null);
    await runPromise;

    expect(playback.armVideo).not.toHaveBeenCalled();
    expect(playback.clearOverlay).not.toHaveBeenCalled();
    expect(runtime.runs.size).toBe(0);
  });
});

describe('Revert', () => {
  it('cancels and applies each applied Cue\'s static inverse, in reverse order', async () => {
    const playback = makePlaybackPort();
    const runtime = makeRuntime(playback);
    const overlayCue = makeCue('cue-o', 'overlay.activate', { overlayId: 'ov-1' });
    const videoCue = makeCue('cue-v', 'video.arm', { assetId: 'asset-1' });
    const cues = new Map([[overlayCue.id, overlayCue], [videoCue.id, videoCue]]);
    const macro = makeMacro('macro-1', [
      makeMacroCue(overlayCue, 0),
      makeMacroCue(videoCue, 1, 0, 1_000),
    ]);
    const order: string[] = [];
    (playback.clearOverlay as ReturnType<typeof vi.fn>).mockImplementation(() => order.push('clearOverlay'));
    (playback.clearVideo as ReturnType<typeof vi.fn>).mockImplementation(() => order.push('clearVideo'));

    const runPromise = runtime.startMacroRun(macro, (id) => cues.get(id), GLOBAL_SCOPE);
    await vi.advanceTimersByTimeAsync(0);
    expect(playback.activateOverlay).toHaveBeenCalledWith('ov-1');
    expect(playback.armVideo).toHaveBeenCalledWith('asset-1');

    runtime.applyLifecycle('revert', '*', null);
    await runPromise;

    // Reverse order of application: video's inverse (clearVideo) before overlay's (clearOverlay).
    expect(order).toEqual(['clearVideo', 'clearOverlay']);
  });

  it('dedupes repeated cue applications so revert cost stays bounded without changing the end state', async () => {
    const playback = makePlaybackPort();
    const runtime = makeRuntime(playback);
    const overlayCue = makeCue('cue-o', 'overlay.activate', { overlayId: 'ov-1' });
    const cues = new Map([[overlayCue.id, overlayCue]]);
    const macro = makeMacro('macro-loop', [makeMacroCue(overlayCue, 0)], { loopEnabled: true, loopCount: null });

    const runPromise = runtime.startMacroRun(macro, (id) => cues.get(id), GLOBAL_SCOPE);
    await vi.advanceTimersByTimeAsync(16 * 24);
    runtime.applyLifecycle('revert', '*', null);
    await runPromise;

    expect(playback.activateOverlay).toHaveBeenCalledTimes(25);
    expect(playback.clearOverlay).toHaveBeenCalledTimes(1);
    expect(playback.clearOverlay).toHaveBeenCalledWith('ov-1');
  });

  it('reverts interleaved repeated cues in reverse first-application order', async () => {
    const playback = makePlaybackPort();
    const runtime = makeRuntime(playback);
    const overlayCue = makeCue('cue-o', 'overlay.activate', { overlayId: 'ov-1' });
    const videoCue = makeCue('cue-v', 'video.arm', { assetId: 'asset-1' });
    const cues = new Map([[overlayCue.id, overlayCue], [videoCue.id, videoCue]]);
    const macro = makeMacro('macro-1', [
      makeMacroCue(overlayCue, 0),
      makeMacroCue(videoCue, 1),
      makeMacroCue(overlayCue, 2, 0, 1_000),
    ]);
    const order: string[] = [];
    (playback.clearOverlay as ReturnType<typeof vi.fn>).mockImplementation(() => order.push('clearOverlay'));
    (playback.clearVideo as ReturnType<typeof vi.fn>).mockImplementation(() => order.push('clearVideo'));

    const runPromise = runtime.startMacroRun(macro, (id) => cues.get(id), GLOBAL_SCOPE);
    await vi.advanceTimersByTimeAsync(0);

    runtime.applyLifecycle('revert', '*', null);
    await runPromise;

    expect(playback.clearOverlay).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['clearVideo', 'clearOverlay']);
  });

  it('does not revert Cue kinds with no static inverse (clears, lifecycle)', async () => {
    const playback = makePlaybackPort();
    const runtime = makeRuntime(playback);
    const clearAllCue = makeCue('cue-clear', 'overlay.clearAll', {});
    const cues = new Map([[clearAllCue.id, clearAllCue]]);
    const macro = makeMacro('macro-1', [makeMacroCue(clearAllCue, 0, 0, 1_000)]);

    const runPromise = runtime.startMacroRun(macro, (id) => cues.get(id), GLOBAL_SCOPE);
    runtime.applyLifecycle('revert', '*', null);
    await runPromise;

    expect(playback.clearOverlay).not.toHaveBeenCalled();
    expect(playback.clearAllOverlays).toHaveBeenCalledTimes(1); // the forward effect ran once; revert added no calls
  });
});

describe('observability', () => {
  it('records per-cue playback events only for the first iteration of a looping macro', async () => {
    const playback = makePlaybackPort();
    const observability: AutomationObservabilityPort = { record: vi.fn() };
    const runtime = makeRuntimeWithPorts(playback, { observability });
    const cue = makeCue('cue-o', 'overlay.activate', { overlayId: 'ov-1' });
    const cues = new Map([[cue.id, cue]]);
    const macro = makeMacro('macro-loop', [makeMacroCue(cue, 0)], { loopEnabled: true, loopCount: 3 });

    const runPromise = runtime.startMacroRun(macro, (id) => cues.get(id), GLOBAL_SCOPE);
    await vi.runAllTimersAsync();
    await runPromise;

    expect(observability.record).toHaveBeenCalledWith('playback', 'Cue started', { cueId: cue.id, kind: cue.kind });
    expect(observability.record).toHaveBeenCalledWith('playback', 'Cue completed', { cueId: cue.id, kind: cue.kind });
    expect((observability.record as ReturnType<typeof vi.fn>).mock.calls.filter((call) => call[1] === 'Cue started')).toHaveLength(1);
    expect((observability.record as ReturnType<typeof vi.fn>).mock.calls.filter((call) => call[1] === 'Cue completed')).toHaveLength(1);
  });
});

describe('Scope exit', () => {
  function startScoped(runtime: AutomationRuntime, onScopeExit: OnScopeExit, scope: ScopeLevel, boundContextId: Id | ItemRef | null) {
    const overlayCue = makeCue('cue-o', 'overlay.activate', { overlayId: 'ov-1' });
    const videoCue = makeCue('cue-v', 'video.arm', { assetId: 'asset-1' });
    const cues = new Map([[overlayCue.id, overlayCue], [videoCue.id, videoCue]]);
    const macro = makeMacro('macro-1', [
      makeMacroCue(overlayCue, 0, 0, 1_000),
      makeMacroCue(videoCue, 1),
    ], { onScopeExit });
    const runPromise = runtime.startMacroRun(macro, (id) => cues.get(id), { scope, boundContextId, onScopeExit });
    return { runPromise, videoCue };
  }

  it('cancel on-exit: sweeping off the bound slide stops the run without reverting applied effects', async () => {
    const playback = makePlaybackPort();
    const runtime = makeRuntime(playback);
    const { runPromise } = startScoped(runtime, 'cancel', 'slide', 'slide-1');
    expect(playback.activateOverlay).toHaveBeenCalledWith('ov-1');

    runtime.handleScopeChange('slide-2', () => null);
    await runPromise;

    expect(runtime.runs.size).toBe(0);
    expect(playback.clearOverlay).not.toHaveBeenCalled();
    expect(playback.armVideo).not.toHaveBeenCalled();
  });

  it('revert on-exit: sweeping off the bound slide applies the static inverse of what was applied', async () => {
    const playback = makePlaybackPort();
    const runtime = makeRuntime(playback);
    const { runPromise } = startScoped(runtime, 'revert', 'slide', 'slide-1');
    expect(playback.activateOverlay).toHaveBeenCalledWith('ov-1');

    runtime.handleScopeChange('slide-2', () => null);
    await runPromise;

    expect(runtime.runs.size).toBe(0);
    expect(playback.clearOverlay).toHaveBeenCalledWith('ov-1');
  });

  it('none on-exit: the run keeps going after scope exit', async () => {
    const playback = makePlaybackPort();
    const runtime = makeRuntime(playback);
    const { runPromise } = startScoped(runtime, 'none', 'slide', 'slide-1');

    runtime.handleScopeChange('slide-2', () => null);
    expect(runtime.runs.size).toBe(1); // still tracked — on-exit 'none' does not sweep it

    runtime.applyLifecycle('cancel', '*', null); // tidy up rather than let the 1s delay elapse
    await runPromise;
  });

  it('global Runs never scope-exit, regardless of on-exit setting', async () => {
    const playback = makePlaybackPort();
    const runtime = makeRuntime(playback);
    const { runPromise } = startScoped(runtime, 'cancel', 'global', null);

    runtime.handleScopeChange('slide-1', () => null);
    runtime.handleScopeChange('slide-2', () => ({ type: 'presentation', id: 'item-1' }));
    runtime.handleScopeChange(null, () => null);
    expect(runtime.runs.size).toBe(1); // untouched by any scope change

    runtime.applyLifecycle('cancel', '*', null);
    await runPromise;
  });

  it('a run scoped to an item exits when the new slide belongs to a different item', async () => {
    const playback = makePlaybackPort();
    const runtime = makeRuntime(playback);
    const { runPromise } = startScoped(runtime, 'cancel', 'item', { type: 'presentation', id: 'item-1' });

    runtime.handleScopeChange('slide-in-other-item', (slideId) =>
      (slideId === 'slide-in-other-item' ? { type: 'presentation', id: 'item-2' } : null));
    await runPromise;

    expect(runtime.runs.size).toBe(0);
  });
});
