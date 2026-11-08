import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { StreamNdiAPI } from '../../shared/ndi';
import type { AudioTrack, StreamProject, StreamSource } from '../../shared/desktop-api';
import type { UseCaptureResult } from '../features/capture';
import { ndiAudioChannels, ndiOutputFrameRate, ndiOutputSize, ndiVideoRgba } from '../ndi-media';
import ndiOutputProcessorUrl from '../ndi-output-processor.js?url';

type ReceiveSession = { cancelled: boolean; id?: string; creation?: Promise<string>; stopTask?: Promise<void>; close: () => Promise<void> };
type SendSession = { cancelled: boolean; id?: string; creation?: Promise<string>; stopTask?: Promise<void>; timer?: ReturnType<typeof setTimeout>; context?: AudioContext; node?: AudioWorkletNode; input?: MediaStreamAudioSourceNode };

export function useNdi({ api, sources, activeIds, capture, programCanvas, project, onError }: {
  api?: StreamNdiAPI;
  sources: StreamSource[];
  activeIds: ReadonlySet<string>;
  capture: UseCaptureResult;
  programCanvas: RefObject<HTMLCanvasElement | null>;
  project: StreamProject | null;
  onError: (message: string) => void;
}) {
  const current = useRef({ capture, onError, project });
  current.current = { capture, onError, project };
  const receivers = useRef(new Map<string, ReceiveSession>());
  const receiverTeardowns = useRef(new Set<Promise<void>>());
  const sender = useRef<SendSession | null>(null);
  const [sending, setSending] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [sourceErrors, setSourceErrors] = useState<Record<string, string>>({});
  const [retry, setRetry] = useState(0);

  const stopSending = useCallback(async () => {
    const session = sender.current;
    if (!session) return;
    if (session.stopTask) return session.stopTask;
    session.cancelled = true;
    setSending(false);
    setStarting(false);
    setStopping(true);
    if (session.timer) clearTimeout(session.timer);
    session.input?.disconnect();
    session.node?.disconnect();
    session.node?.port.close();
    session.stopTask = (async () => {
      await session.context?.close().catch(() => undefined);
      const id = await session.creation?.catch(() => undefined) ?? session.id;
      if (id) await api?.stopSend(id).catch((error) => current.current.onError(`NDI output: ${String(error)}`));
      if (sender.current === session) {
        sender.current = null;
        setStopping(false);
      }
    })();
    return session.stopTask;
  }, [api]);

  useEffect(() => {
    if (!api) return;
    const required = new Map(sources.filter((s) => s.kind === 'ndi' && activeIds.has(s.id) && s.ndiSourceName).map((s) => [s.id, s]));
    for (const [id, session] of receivers.current) {
      if (!required.has(id)) { session.close(); receivers.current.delete(id); }
    }
    setSourceErrors((old) => {
      if (Object.keys(old).every((id) => required.has(id))) return old;
      return Object.fromEntries(Object.entries(old).filter(([id]) => required.has(id)));
    });
    for (const [runtimeId, source] of required) {
      if (receivers.current.has(runtimeId)) continue;
      const session: ReceiveSession = { cancelled: false, close: () => Promise.resolve() };
      receivers.current.set(runtimeId, session);
      let stream: MediaStream | undefined;
      let audio: AudioContext | undefined;
      session.close = () => {
        if (session.stopTask) return session.stopTask;
        session.cancelled = true;
        stream?.getTracks().forEach((track) => track.stop());
        const audioClosing = audio?.close().catch(() => undefined);
        current.current.capture.stopRuntime(runtimeId);
        const stopTask = (async () => {
          if (audioClosing) await audioClosing;
          const id = session.id ?? await session.creation?.catch(() => undefined);
          if (id) await api.stopReceive(id);
        })();
        session.stopTask = stopTask;
        receiverTeardowns.current.add(stopTask);
        void stopTask.then(
          () => receiverTeardowns.current.delete(stopTask),
          (error) => {
            receiverTeardowns.current.delete(stopTask);
            current.current.onError(`NDI source teardown: ${error instanceof Error ? error.message : String(error)}`);
          },
        );
        return stopTask;
      };
      void (async () => {
        try {
          const pendingTeardowns = [...receiverTeardowns.current];
          if (pendingTeardowns.length > 0) await Promise.all(pendingTeardowns);
          if (session.cancelled) return;
          session.creation = api.startReceive({ name: source.ndiSourceName!, urlAddress: source.ndiUrlAddress }, source.captureAudioEnabled !== false);
          const id = await session.creation;
          session.id = id;
          if (session.cancelled) { await session.close(); return; }
          const canvas = document.createElement('canvas');
          canvas.width = 1920; canvas.height = 1080;
          const drawing = canvas.getContext('2d');
          if (!drawing) throw new Error('NDI video cannot be displayed.');
          stream = canvas.captureStream(60);
          let destination: MediaStreamAudioDestinationNode | undefined;
          if (source.captureAudioEnabled !== false) {
            audio = new AudioContext();
            destination = audio.createMediaStreamDestination();
            destination.stream.getAudioTracks().forEach((track) => stream!.addTrack(track));
            void audio.resume().catch(() => undefined);
          }
          await current.current.capture.attachRuntime(source, stream);
          if (session.cancelled) return;
          let nextAudioTime = 0;
          let lastVideo = performance.now();
          let signalLost = true;
          setSourceErrors((old) => ({ ...old, [runtimeId]: 'Waiting for NDI video.' }));
          while (!session.cancelled) {
            const frame = await api.readFrame(id);
            if (session.cancelled) break;
            if (frame?.kind === 'video') {
              const pixels = ndiVideoRgba(frame);
              if (canvas.width !== frame.width) canvas.width = frame.width;
              if (canvas.height !== frame.height) canvas.height = frame.height;
              drawing.putImageData(new ImageData(pixels, frame.width, frame.height), 0, 0);
              lastVideo = performance.now();
              if (signalLost) {
                signalLost = false;
                setSourceErrors((old) => { const next = { ...old }; delete next[runtimeId]; return next; });
              }
            } else if (frame?.kind === 'audio' && audio && destination) {
              const channels = ndiAudioChannels(frame);
              if (nextAudioTime > audio.currentTime + 0.25) continue;
              const buffer = audio.createBuffer(channels.length, frame.samplesPerChannel, frame.sampleRate);
              channels.forEach((samples, channel) => buffer.getChannelData(channel).set(samples));
              const node = audio.createBufferSource();
              node.buffer = buffer;
              node.connect(destination);
              node.onended = () => node.disconnect();
              nextAudioTime = Math.max(nextAudioTime, audio.currentTime + 0.02);
              node.start(nextAudioTime);
              nextAudioTime += buffer.duration;
            } else if (!frame) await new Promise((resolve) => setTimeout(resolve, 8));
            if (!signalLost && performance.now() - lastVideo > 3000) {
              signalLost = true;
              drawing.fillStyle = '#000000';
              drawing.fillRect(0, 0, canvas.width, canvas.height);
              setSourceErrors((old) => ({ ...old, [runtimeId]: 'NDI signal lost. Waiting for source.' }));
            }
          }
        } catch (error) {
          if (!session.cancelled) {
            const message = error instanceof Error ? error.message : String(error);
            setSourceErrors((old) => ({ ...old, [runtimeId]: message }));
            current.current.onError(`NDI source: ${message}`);
            session.close();
          }
        }
      })();
    }
  }, [api, sources, activeIds, retry]);

  useEffect(() => () => {
    for (const session of receivers.current.values()) session.close();
    receivers.current.clear();
    void stopSending();
  }, [api, stopSending]);

  const startSending = async (senderName: string, audioTrack: AudioTrack) => {
    if (!api || sender.current || !current.current.project || !programCanvas.current) return;
    const session: SendSession = { cancelled: false };
    sender.current = session;
    setStarting(true);
    try {
      const output = current.current.project.output;
      const size = ndiOutputSize(output.width, output.height);
      const fps = ndiOutputFrameRate(output.frameRate);
      session.creation = api.startSend({ senderName: senderName.trim(), ...size, frameRateN: Math.round(fps * 1000), frameRateD: 1000 });
      session.id = await session.creation;
      if (session.cancelled) return;
      const canvas = document.createElement('canvas');
      Object.assign(canvas, size);
      const drawing = canvas.getContext('2d', { willReadFrequently: true });
      if (!drawing) throw new Error('Program video cannot be read for NDI.');
      const context = new AudioContext({ sampleRate: 48000 });
      session.context = context;
      await context.audioWorklet.addModule(ndiOutputProcessorUrl);
      if (session.cancelled) return;
      const input = context.createMediaStreamSource(current.current.capture.ensureMixer().destinationFor(audioTrack).stream);
      const node = new AudioWorkletNode(context, 'stream-ndi-output', { outputChannelCount: [2] });
      session.input = input; session.node = node;
      let audioInFlight = false;
      node.port.onmessage = ({ data }) => {
        if (session.cancelled || audioInFlight || !session.id) return;
        audioInFlight = true;
        void api.sendAudio(session.id, data).catch((error) => {
          if (!session.cancelled) { current.current.onError(`NDI output: ${String(error)}`); void stopSending(); }
        }).finally(() => { audioInFlight = false; });
      };
      input.connect(node); node.connect(context.destination);
      await context.resume();
      if (session.cancelled) return;
      const send = async () => {
        if (session.cancelled || !session.id) return;
        const started = performance.now();
        try {
          const program = programCanvas.current;
          if (program) {
            drawing.drawImage(program, 0, 0, size.width, size.height);
            const pixels = drawing.getImageData(0, 0, size.width, size.height);
            await api.sendVideo(session.id, { ...size, data: new Uint8Array(pixels.data.buffer) });
          }
          if (!session.cancelled) session.timer = setTimeout(() => void send(), Math.max(0, 1000 / fps - (performance.now() - started)));
        } catch (error) {
          if (!session.cancelled) { current.current.onError(`NDI output: ${String(error)}`); await stopSending(); }
        }
      };
      setSending(true); setStarting(false);
      void send();
    } catch (error) {
      if (!session.cancelled) current.current.onError(`NDI output: ${String(error)}`);
      if (sender.current === session) await stopSending();
    }
  };

  const retrySource = (runtimeId: string) => {
    void receivers.current.get(runtimeId)?.close();
    receivers.current.delete(runtimeId);
    setRetry((value) => value + 1);
  };
  return { sending, starting, stopping, sourceErrors, startSending, stopSending, retrySource };
}
