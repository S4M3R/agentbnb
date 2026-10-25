"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { DictationView } from "@/components/chat/composer";

// Speech to text for the composer: tap the mic to record, tap again (or Enter) to stop. The clip goes
// to /api/transcribe and the text is handed to `onText`, so the person can check it before sending.
// Works anywhere MediaRecorder does (Chrome, Firefox, Safari 14.1+ incl. iOS).

const MAX_SECONDS = 120;

/** The first recording format this browser supports; Safari only does mp4/aac. */
function pickMimeType() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return types.find((t) => MediaRecorder.isTypeSupported(t));
}

const canRecord = () => !!navigator.mediaDevices?.getUserMedia && "MediaRecorder" in window;
const noSubscription = () => () => {};

export function useDictation(onText: (text: string) => void) {
  // Known only in the browser; the server render has no mic, so the button appears after hydration.
  const supported = useSyncExternalStore(noSubscription, canRecord, () => false);
  const [state, setState] = useState<DictationView["state"]>("idle");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const discard = useRef(false);
  const cleanup = useRef<() => void>(() => {});
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  });

  useEffect(() => () => cleanup.current(), []);

  const send = useCallback(async (blob: Blob) => {
    setState("transcribing");
    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "content-type": blob.type || "audio/webm" },
        body: blob,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error?.message ?? "Couldn't transcribe that. Try again.");
      if (body.text) onTextRef.current(body.text);
      else setError("I didn't catch anything. Try again a little closer to the mic.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't transcribe that. Try again.");
    } finally {
      setState("idle");
    }
  }, []);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      const denied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
      setError(
        denied
          ? "Microphone access is off. Allow it for this site in your browser settings to dictate."
          : "No microphone found.",
      );
      return;
    }

    const mimeType = pickMimeType();
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.current = rec;
    chunks.current = [];
    discard.current = false;

    // Live loudness for the meter.
    const audio = new AudioContext();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 512;
    audio.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let frame = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (const v of samples) peak = Math.max(peak, Math.abs(v - 128));
      setLevel(Math.min(1, (peak / 128) * 2.2));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    const began = Date.now();
    const timer = setInterval(() => {
      const s = (Date.now() - began) / 1000;
      setSeconds(s);
      if (s >= MAX_SECONDS) stop();
    }, 250);

    cleanup.current = () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      audio.close().catch(() => {});
      setLevel(0);
      setSeconds(0);
    };

    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.onstop = () => {
      cleanup.current();
      cleanup.current = () => {};
      recorder.current = null;
      if (discard.current) {
        setState("idle");
        return;
      }
      void send(new Blob(chunks.current, { type: rec.mimeType || mimeType || "audio/webm" }));
    };

    rec.start(250);
    setState("recording");
  }, [send, stop]);

  /** The mic button: start, or stop and transcribe. Always shown (so it doesn't pop in after load). */
  const toggle = useCallback(() => {
    if (!supported) {
      setError("This browser can't record audio. Try Chrome or Safari.");
      return;
    }
    if (state === "recording") stop();
    else if (state === "idle") void start();
  }, [supported, state, start, stop]);

  const cancel = useCallback(() => {
    discard.current = true;
    stop();
  }, [stop]);

  const view: DictationView = { state, seconds, level, error, onCancel: cancel };
  return { supported, toggle, view };
}
