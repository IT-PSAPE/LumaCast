import { useEffect, useMemo, useRef } from 'react';
import { getLayerVideoElement } from '@lumacast/canvas';
import { LAYER_VIDEO_NODE_ID, type BindingValue, type RenderScene } from '@lumacast/composition';
import { sceneVideoSource, type NdiOutputName } from '@lumacast/protocol';
import { claimNdiTakeCorrelation, consumeNdiTakeCorrelation, doesTakeCorrelationMatch, hasPendingNdiTakeCorrelation, type NdiTakeCorrelationClaim } from '../../utils/ndi-take-correlation';

export function useNdiGpuScenePublisher(name: NdiOutputName, enabled: boolean, scene: RenderScene, binding: BindingValue, outputScopeKey: string | null) {
  const revision = useMemo(() => ({ id: crypto.randomUUID(), changedAtMs: Date.now() }), [scene, binding, outputScopeKey, enabled]);
  const revisionId = revision.id;
  const pending = useRef(new Map<string, NdiTakeCorrelationClaim>());
  const current = useRef({ enabled, slideId: scene.slide.id, outputScopeKey });
  current.current = { enabled, slideId: scene.slide.id, outputScopeKey };
  useEffect(() => window.castApi.onNdiFrameReleased((release) => {
    if (release.name !== name || !release.accepted || !release.attemptId) return;
    const separator = release.attemptId.lastIndexOf(':');
    if (separator < 0) return;
    const revisionId = release.attemptId.slice(0, separator);
    const claim = pending.current.get(revisionId);
    if (claim && current.current.enabled && doesTakeCorrelationMatch(claim, current.current.slideId, current.current.outputScopeKey)) {
      consumeNdiTakeCorrelation(name, claim.sequenceId);
      pending.current.delete(revisionId);
    }
  }), [name]);
  useEffect(() => {
    if (!enabled) { pending.current.clear(); return; }
    const src = sceneVideoSource(scene.nodes, LAYER_VIDEO_NODE_ID);
    const publish = () => {
      const observedAtMs = Date.now();
      const video = src ? getLayerVideoElement(src) : null;
      const claim = claimNdiTakeCorrelation(name, scene.slide.id, outputScopeKey);
      if (claim && !pending.current.has(revisionId)) {
        pending.current.set(revisionId, claim);
        while (pending.current.size > 64) pending.current.delete(pending.current.keys().next().value!);
      }
      window.castApi.publishNdiGpuScene({ name, revisionId, scene, binding,
        // Publish the source before its first decoded frame so the output
        // window can retain and load its own muted copy immediately.
        layerVideo: src ? { src, currentTime: video?.currentTime ?? 0, playing: Boolean(video && !video.paused && !video.ended),
          loop: video?.loop ?? false, playbackRate: video?.playbackRate ?? 1, observedAtMs } : null,
        telemetry: { captureDurationMs: 0, readbackDurationMs: 0, skippedCaptures: 0, framesDroppedBackpressure: 0, correctiveFrameRetries: 0,
          signatureChangedAtMs: revision.changedAtMs, rendererSendAtMs: observedAtMs,
          ...(claim ? { takeSessionId: claim.sessionId, takeSequenceId: claim.sequenceId, takeKind: claim.kind, takeReason: claim.reason, takeIssuedAtMs: claim.takeIssuedAtMs } : {}),
        },
      });
    };
    publish();
    const timer = setInterval(() => { if (src || hasPendingNdiTakeCorrelation(name, scene.slide.id, outputScopeKey)) publish(); }, 100);
    return () => clearInterval(timer);
  }, [enabled, name, scene, binding, outputScopeKey, revision]);
}
