import type { ItemRef } from '@lumacast/composition';
import type { Id } from '@lumacast/kernel';
import type { NdiOutputName, NdiTakeKind, NdiTakeReason } from '@lumacast/protocol';

interface PendingTakeCorrelation {
  sessionId: string;
  sequenceId: number;
  slideId: Id;
  outputScopeKey: string;
  kind: NdiTakeKind;
  reason?: NdiTakeReason;
  issuedAtMs: number;
  completedBySender: Set<NdiOutputName>;
}

export interface NdiTakeCorrelationClaim {
  sessionId: string;
  sequenceId: number;
  slideId: Id;
  outputScopeKey: string;
  kind: NdiTakeKind;
  reason?: NdiTakeReason;
  takeIssuedAtMs: number;
}

export interface NoteNdiTakeCorrelationInput {
  kind: NdiTakeKind;
  slideId: Id;
  outputScopeKey: string | null;
  reason?: NdiTakeReason;
  issuedAtMs?: number;
}

const MAX_PENDING_CORRELATIONS = 64;
const STALE_CORRELATION_MS = 2 * 60 * 1000;
const OUTPUT_COUNT = 2;
const pending: PendingTakeCorrelation[] = [];
let takeSequenceId = 0;
const ndiTakeCorrelationSessionId = (() => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ndi-take-${Date.now()}-${Math.random().toString(16).slice(2)}`;
})();

export function buildNdiTakeScopeKey(
  playlistEntryId: Id | null,
  itemRef: ItemRef | null,
): string | null {
  if (playlistEntryId) return `entry:${playlistEntryId}`;
  if (itemRef) return `item:${itemRef.type}:${itemRef.id}`;
  return null;
}

function prune(nowMs: number): void {
  for (let index = pending.length - 1; index >= 0; index -= 1) {
    const candidate = pending[index];
    if (candidate.completedBySender.size >= OUTPUT_COUNT) {
      pending.splice(index, 1);
      continue;
    }
    if (nowMs - candidate.issuedAtMs <= STALE_CORRELATION_MS) continue;
    pending.splice(index, 1);
  }
  if (pending.length <= MAX_PENDING_CORRELATIONS) return;
  pending.splice(0, pending.length - MAX_PENDING_CORRELATIONS);
}

export function noteNdiTakeCorrelation({
  kind,
  slideId,
  outputScopeKey,
  reason,
  issuedAtMs = Date.now(),
}: NoteNdiTakeCorrelationInput): number | null {
  if (!outputScopeKey) return null;
  prune(issuedAtMs);
  const sequenceId = ++takeSequenceId;
  pending.push({
    sessionId: ndiTakeCorrelationSessionId,
    sequenceId,
    slideId,
    outputScopeKey,
    kind,
    reason,
    issuedAtMs,
    completedBySender: new Set(),
  });
  return sequenceId;
}

export function hasPendingNdiTakeCorrelation(
  senderName: NdiOutputName,
  slideId: Id,
  outputScopeKey: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (!outputScopeKey) return false;
  prune(nowMs);
  return pending.some((candidate) => (
    candidate.slideId === slideId
    && candidate.outputScopeKey === outputScopeKey
    && !candidate.completedBySender.has(senderName)
  ));
}

export function claimNdiTakeCorrelation(
  senderName: NdiOutputName,
  slideId: Id,
  outputScopeKey: string | null,
  nowMs: number = Date.now(),
): NdiTakeCorrelationClaim | null {
  if (!outputScopeKey) return null;
  prune(nowMs);
  const candidate = pending.find((entry) => (
    entry.slideId === slideId
    && entry.outputScopeKey === outputScopeKey
    && !entry.completedBySender.has(senderName)
  ));
  if (!candidate) return null;
  return {
    sessionId: candidate.sessionId,
    sequenceId: candidate.sequenceId,
    slideId: candidate.slideId,
    outputScopeKey: candidate.outputScopeKey,
    kind: candidate.kind,
    reason: candidate.reason,
    takeIssuedAtMs: candidate.issuedAtMs,
  };
}

export function consumeNdiTakeCorrelation(
  senderName: NdiOutputName,
  sequenceId: number,
  nowMs: number = Date.now(),
): void {
  prune(nowMs);
  const candidate = pending.find((entry) => entry.sequenceId === sequenceId);
  if (!candidate) return;
  candidate.completedBySender.add(senderName);
  prune(nowMs);
}

export function doesTakeCorrelationMatch(
  claim: NdiTakeCorrelationClaim | null,
  slideId: Id | null,
  outputScopeKey: string | null,
): boolean {
  return Boolean(
    claim
    && slideId
    && outputScopeKey
    && claim.slideId === slideId
    && claim.outputScopeKey === outputScopeKey,
  );
}

export function resetNdiTakeCorrelationsForTest(): void {
  pending.length = 0;
  takeSequenceId = 0;
}
