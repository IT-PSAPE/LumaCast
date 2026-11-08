import { useCallback, useEffect, useRef, useState } from "react";
import type { Sound, SoundPlaybackSettings } from "../shared/desktop-api";
import type { AudioFactory, AudioPort } from "./sound-ports";

const OUT_OF_RANGE = "The saved time range is outside this audio file.";

// This owner is independent of library object identity, settings saves and UI
// callbacks. Only a different sound ID or audio factory replaces its resource.
export function useSoundPlayer({ sound, settings, busy, audioFactory }: {
  sound: Sound;
  settings: SoundPlaybackSettings;
  busy: boolean;
  audioFactory: AudioFactory;
}) {
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const audio = useRef<AudioPort | null>(null);
  const alive = useRef(true);
  const playRequest = useRef(0);
  const boundaryTimer = useRef<number | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const durationRef = useRef(0);
  const toggleRequest = useRef<() => void>(() => undefined);
  const scheduleBoundaryRef = useRef<() => void>(() => undefined);
  const [playing, setPlaying] = useState(false);
  const playIntent = useRef(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");

  const clearBoundary = useCallback(() => {
    if (boundaryTimer.current !== null) window.clearTimeout(boundaryTimer.current);
    boundaryTimer.current = null;
  }, []);

  const validPlayback = useCallback((candidate: SoundPlaybackSettings, length = durationRef.current) => {
    if (!Number.isFinite(length) || length <= 0) return false;
    if (!Number.isFinite(candidate.startTime) || candidate.startTime < 0 || candidate.startTime >= length) return false;
    if (candidate.endTime !== null && (!Number.isFinite(candidate.endTime) || candidate.endTime <= candidate.startTime || candidate.endTime > length)) return false;
    return true;
  }, []);

  const stop = useCallback(() => {
    playRequest.current++;
    playIntent.current = false;
    clearBoundary();
    const element = audio.current;
    if (!element) return;
    element.pause();
    const start = settingsRef.current.startTime;
    element.currentTime = start;
    setCurrent(start);
    setPlaying(false);
  }, [clearBoundary, setPlaying]);

  const pause = useCallback(() => {
    playRequest.current++;
    playIntent.current = false;
    clearBoundary();
    audio.current?.pause();
    setPlaying(false);
  }, [clearBoundary, setPlaying]);

  const resetToSegmentStart = useCallback(() => {
    const element = audio.current;
    if (!element) return;
    element.currentTime = settingsRef.current.startTime;
    setCurrent(settingsRef.current.startTime);
    setPlaying(false);
  }, [setPlaying]);

  const handleBoundary = useCallback(() => {
    const element = audio.current;
    if (!element || element.paused || !alive.current) return;
    const latest = settingsRef.current;
    const length = durationRef.current;
    const end = latest.endTime ?? length;
    if (!Number.isFinite(end) || end <= 0) return;
    if (element.currentTime < end) {
      const wait = Math.max(10, (end - element.currentTime) * 1000);
      boundaryTimer.current = window.setTimeout(handleBoundary, wait);
      return;
    }
    clearBoundary();
    if (latest.loop) {
      element.currentTime = latest.startTime;
      setCurrent(latest.startTime);
      const request = playRequest.current;
      void element.play().then(() => {
        if (alive.current && request === playRequest.current && playIntent.current) scheduleBoundaryRef.current();
      }).catch(() => {
        if (alive.current && request === playRequest.current && playIntent.current) { playIntent.current = false; setPlaying(false); setError("This audio segment couldn’t be played."); }
      });
      return;
    }
    playRequest.current++;
    playIntent.current = false;
    element.pause();
    resetToSegmentStart();
  }, [clearBoundary, setPlaying, resetToSegmentStart]);

  const scheduleBoundary = useCallback(() => {
    clearBoundary();
    const element = audio.current;
    if (!element || element.paused) return;
    const latest = settingsRef.current;
    const length = durationRef.current;
    const needsManualBoundary = latest.endTime !== null || latest.startTime > 0;
    if (!needsManualBoundary || !validPlayback(latest, length)) return;
    const end = latest.endTime ?? length;
    const wait = Math.max(0, (end - element.currentTime) * 1000);
    boundaryTimer.current = window.setTimeout(handleBoundary, wait);
  }, [clearBoundary, handleBoundary, validPlayback]);
  scheduleBoundaryRef.current = scheduleBoundary;

  const togglePlay = useCallback(async () => {
    const element = audio.current;
    if (!element || busy) return;
    setError("");
    if (!element.paused) { pause(); return; }
    const latest = settingsRef.current;
    if (!validPlayback(latest)) {
      setError(durationRef.current > 0 ? OUT_OF_RANGE : "Audio duration is still loading.");
      return;
    }
    clearBoundary();
    if (element.currentTime < latest.startTime || element.currentTime >= (latest.endTime ?? durationRef.current)) {
      element.currentTime = latest.startTime;
      setCurrent(latest.startTime);
    }
    element.loop = latest.loop && latest.startTime === 0 && latest.endTime === null;
    const request = ++playRequest.current;
    playIntent.current = true;
    try {
      await element.play();
      if (!alive.current || request !== playRequest.current) return;
      setPlaying(true);
      scheduleBoundary();
    } catch (reason) {
      if (alive.current && request === playRequest.current) {
        playIntent.current = false;
        setPlaying(false);
        setError((reason as { name?: unknown } | null)?.name === "NotAllowedError" ? "Playback was blocked. Try again." : "This audio file couldn’t be played.");
      }
    }
  }, [busy, clearBoundary, setPlaying, pause, scheduleBoundary, validPlayback]);
  toggleRequest.current = () => { void togglePlay(); };

  useEffect(() => {
    alive.current = true;
    const element = audioFactory(soundRef.current);
    audio.current = element;
    const onTime = () => {
      if (!alive.current) return;
      setCurrent(element.currentTime || 0);
      const latest = settingsRef.current;
      const end = latest.endTime ?? durationRef.current;
      if ((latest.endTime !== null || latest.startTime > 0) && element.currentTime >= end) handleBoundary();
    };
    const onMetadata = () => {
      if (!alive.current) return;
      const length = Number.isFinite(element.duration) ? element.duration : 0;
      durationRef.current = length;
      setDuration(length);
      element.loop = settingsRef.current.loop && settingsRef.current.startTime === 0 && settingsRef.current.endTime === null;
      if (!validPlayback(settingsRef.current, length)) {
        clearBoundary();
        if (!element.paused) {
          playRequest.current++;
          playIntent.current = false;
          element.pause();
        }
        setError(length > 0 ? OUT_OF_RANGE : "Audio duration couldn’t be read.");
        return;
      }
      if (element.paused) {
        element.currentTime = settingsRef.current.startTime;
        setCurrent(settingsRef.current.startTime);
      } else scheduleBoundary();
      setError("");
    };
    const onPlay = () => { if (alive.current) { setPlaying(true); setError(""); scheduleBoundary(); } };
    const onPause = () => { clearBoundary(); if (alive.current) setPlaying(false); };
    const onEnded = () => {
      if (!alive.current || !playIntent.current) return;
      playRequest.current++;
      clearBoundary();
      const latest = settingsRef.current;
      if (latest.loop) {
        playIntent.current = true;
        const request = playRequest.current;
        element.currentTime = latest.startTime;
        setCurrent(latest.startTime);
        void element.play().then(() => {
          if (alive.current && request === playRequest.current && playIntent.current) scheduleBoundaryRef.current();
        }).catch(() => { if (alive.current && request === playRequest.current && playIntent.current) { playIntent.current = false; setPlaying(false); setError("This audio segment couldn’t be played."); } });
      } else { playIntent.current = false; resetToSegmentStart(); }
    };
    const onError = () => { playRequest.current++; playIntent.current = false; clearBoundary(); if (alive.current) { setPlaying(false); setError("This audio file couldn’t be loaded."); } };
    element.addEventListener("timeupdate", onTime);
    element.addEventListener("loadedmetadata", onMetadata);
    element.addEventListener("durationchange", onMetadata);
    element.addEventListener("play", onPlay);
    element.addEventListener("pause", onPause);
    element.addEventListener("ended", onEnded);
    element.addEventListener("error", onError);
    if (Number.isFinite(element.duration) && element.duration > 0) onMetadata();
    return () => {
      alive.current = false;
      playRequest.current++;
      clearBoundary();
      element.pause();
      element.currentTime = settingsRef.current.startTime;
      element.removeEventListener("timeupdate", onTime);
      element.removeEventListener("loadedmetadata", onMetadata);
      element.removeEventListener("durationchange", onMetadata);
      element.removeEventListener("play", onPlay);
      element.removeEventListener("pause", onPause);
      element.removeEventListener("ended", onEnded);
      element.removeEventListener("error", onError);
      element.src = "";
      element.load();
      audio.current = null;
    };
  }, [audioFactory, clearBoundary, handleBoundary, setPlaying, resetToSegmentStart, scheduleBoundary, sound.id, stop, validPlayback]);

  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    element.loop = settings.loop && settings.startTime === 0 && settings.endTime === null;
    if (!validPlayback(settings, durationRef.current)) {
      clearBoundary();
      if (!element.paused) {
        playRequest.current++;
        playIntent.current = false;
        element.pause();
      }
      return;
    }
    setError((message) => message === OUT_OF_RANGE ? "" : message);
    if (element.currentTime < settings.startTime || element.currentTime >= (settings.endTime ?? durationRef.current)) {
      element.currentTime = settings.startTime;
      setCurrent(settings.startTime);
    }
    scheduleBoundary();
  }, [clearBoundary, scheduleBoundary, settings.endTime, settings.loop, settings.startTime, validPlayback]);

  const seekTo = (value: number) => {
    const element = audio.current;
    if (!element || !validPlayback(settings)) return;
    const end = settings.endTime ?? durationRef.current;
    const target = Math.min(end, Math.max(settings.startTime, value));
    clearBoundary();
    element.currentTime = target;
    setCurrent(target);
    if (!element.paused) scheduleBoundary();
  };

  const toggle = useCallback(() => toggleRequest.current(), []);
  const readPlayhead = () => audio.current?.currentTime ?? current;

  return { playing, current, duration, error, canPlay: duration > 0 && validPlayback(settings), toggle, stop, seek: seekTo, readPlayhead };
}
