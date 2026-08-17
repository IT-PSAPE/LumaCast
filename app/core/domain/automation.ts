// Domain primitives (#153, split from app/core/types.ts): the automation
// family — cues, macros, and trigger bindings. Mutation input shapes
// (CueCreateInput and friends) are application contracts, not domain
// primitives, and stay in app/core/types.ts pending #154.
import type { Id } from './ids';

export type CueFailurePolicy = 'continue' | 'abort';
export type CueClearLayer = 'media' | 'video' | 'content' | 'overlay';
export type CueKind =
  | 'overlay.activate'
  | 'overlay.clear'
  | 'overlay.clearAll'
  | 'mediaLayer.set'
  | 'video.arm'
  | 'video.clear'
  | 'audio.arm'
  | 'audio.clear'
  | 'stage.set'
  | 'stage.clear'
  | 'layer.clear'
  | 'layer.clearAll'
  | 'flow.lifecycle';
export type TriggerType = 'slide.take' | 'slide.activate' | 'app.startup';
export type TriggerBindingTargetType = 'cue' | 'macro';

/** Level a macro's lifetime is bound to. The concrete context is captured from the trigger. */
export type ScopeLevel = 'global' | 'deckItem' | 'slide';
/** What happens to a macro run when its bound scope context stops being live. */
export type OnScopeExit = 'cancel' | 'revert' | 'none';
/** Lifecycle action a `flow.lifecycle` cue performs against targeted runs. */
export type LifecycleAction = 'cancel' | 'revert';
/** `'*'` targets all active runs; an Id targets every running instance of that macro. */
export type LifecycleTarget = Id | '*';

export type CuePayload =
  | { overlayId: Id }
  | { assetId: Id }
  | { stageId: Id }
  | { layer: CueClearLayer }
  | { action: LifecycleAction; target: LifecycleTarget }
  | Record<string, never>;

export interface Cue {
  id: Id;
  kind: CueKind;
  payload: CuePayload;
  failurePolicy: CueFailurePolicy;
  createdAt: string;
  updatedAt: string;
}

export interface MacroCue {
  id: Id;
  macroId: Id;
  cueId: Id;
  cue: Cue;
  orderIndex: number;
  // Delays are per-occurrence (per macro step), not part of the shared cue
  // identity — the same cue can appear with different delays in different macros.
  delayBeforeMs: number;
  delayAfterMs: number;
  createdAt: string;
  updatedAt: string;
}

export interface Macro {
  id: Id;
  name: string;
  description: string;
  collectionId: Id;
  cues: MacroCue[];
  scopeLevel: ScopeLevel;
  onScopeExit: OnScopeExit;
  loopEnabled: boolean;
  /** null = loop until scope exit / cancel; a number caps the iterations. */
  loopCount: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TriggerBinding {
  id: Id;
  triggerType: TriggerType;
  sourceId: Id | null;
  targetType: TriggerBindingTargetType;
  targetId: Id;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
