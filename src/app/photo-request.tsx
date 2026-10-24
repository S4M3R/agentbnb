"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckIcon, CloseIcon } from "@/components/ui/icons";
import { uploadPhoto } from "./photo-upload";

// The askForPhotos tool in the chat: the agent's shot list, a full-screen camera that walks the
// host through it one shot at a time, and a library upload fallback.

type Shot = { id: string; label: string; tip: string };
export type PhotoRequestInput = { intro: string; shots: Shot[] };
export type PhotoRequestOutput = { photos: { url: string; shot: string | null }[]; skipped?: boolean };

type Taken = { key: string; shotId: string | null; preview: string; url?: string; failed?: boolean };

export function PhotoRequest({
  input,
  done,
  disabled = false,
  onDone,
}: {
  input: PhotoRequestInput;
  /** The photos the host already shared; the card is read-only. */
  done?: PhotoRequestOutput;
  /** The conversation moved on without photos. */
  disabled?: boolean;
  onDone?: (output: PhotoRequestOutput) => void;
}) {
  const [taken, setTaken] = useState<Taken[]>([]);
  const [camera, setCamera] = useState<number | null>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const shots = input.shots ?? [];

  if (done) {
    if (done.skipped || !done.photos.length) return <div className="text-sm text-muted">Photos skipped for now.</div>;
    return (
      <div className="flex flex-wrap gap-2">
        {done.photos.map((p) => (
          <figure key={p.url} className="w-20">
            {/* eslint-disable-next-line @next/next/no-img-element -- Blob photos */}
            <img src={p.url} alt={p.shot ?? ""} className="size-20 rounded-xl object-cover" />
            {p.shot && <figcaption className="mt-1 truncate text-xs text-muted">{p.shot}</figcaption>}
          </figure>
        ))}
      </div>
    );
  }

  const byShot = new Map(taken.filter((t) => t.shotId).map((t) => [t.shotId!, t]));
  const ready = taken.filter((t) => t.url);
  const uploading = taken.some((t) => !t.url && !t.failed);

  function add(file: File, shotId: string | null) {
    const key = crypto.randomUUID();
    const preview = URL.createObjectURL(file);
    setTaken((list) => [...list.filter((t) => !shotId || t.shotId !== shotId), { key, shotId, preview }]);
    uploadPhoto(file).then(
      ({ url }) => setTaken((list) => list.map((t) => (t.key === key ? { ...t, url } : t))),
      () => setTaken((list) => list.map((t) => (t.key === key ? { ...t, failed: true } : t))),
    );
  }

  function fromLibrary(files: FileList | null) {
    const open = shots.filter((s) => !byShot.has(s.id)).map((s) => s.id);
    Array.from(files ?? [])
      .filter((f) => f.type.startsWith("image/"))
      .forEach((f, i) => add(f, open[i] ?? null));
    if (libraryRef.current) libraryRef.current.value = "";
  }

  function finish() {
    const label = (id: string | null) => shots.find((s) => s.id === id)?.label ?? null;
    const order = (t: Taken) => (t.shotId ? shots.findIndex((s) => s.id === t.shotId) : shots.length);
    onDone?.({
      photos: [...ready].sort((a, b) => order(a) - order(b)).map((t) => ({ url: t.url!, shot: label(t.shotId) })),
    });
  }

  return (
    <div className={`space-y-4 rounded-card border border-hairline bg-canvas p-4 sm:p-5 ${disabled ? "opacity-50" : ""}`}>
      <p className="text-[15px] leading-relaxed text-ink">{input.intro}</p>
      <ol className="-mx-1.5 space-y-1">
        {shots.map((s, i) => {
          const t = byShot.get(s.id);
          return (
            <li key={s.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setCamera(i)}
                className="flex w-full items-center gap-3 rounded-xl p-1.5 text-left transition-colors hover:bg-surface-soft"
              >
                {t ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local preview
                  <img
                    src={t.preview}
                    alt=""
                    className={`size-14 shrink-0 rounded-lg object-cover ${t.url ? "" : "animate-shimmer"}`}
                  />
                ) : (
                  <span className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-surface-strong text-sm font-semibold text-muted">
                    {i + 1}
                  </span>
                )}
                <span className="min-w-0 text-sm">
                  <span className="flex flex-wrap items-center gap-x-1.5 font-semibold text-ink">
                    {s.label}
                    {t?.url && <CheckIcon size={15} strokeWidth={2.8} className="text-success-dot" />}
                    {t?.failed && <span className="font-normal text-error">upload failed, tap to retake</span>}
                  </span>
                  <span className="block text-muted">{s.tip}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          {ready.length > 0 ? (
            <Button size="sm" disabled={uploading} onClick={finish}>
              {uploading ? "Uploading…" : `Share ${ready.length} photo${ready.length === 1 ? "" : "s"}`}
            </Button>
          ) : (
            <Button size="sm" onClick={() => setCamera(0)}>
              Open camera
            </Button>
          )}
          {ready.length > 0 && byShot.size < shots.length && (
            <Button size="sm" variant="secondary" onClick={() => setCamera(shots.findIndex((s) => !byShot.has(s.id)))}>
              Take the rest
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => libraryRef.current?.click()}>
            Upload from library
          </Button>
          <input ref={libraryRef} type="file" accept="image/*" multiple hidden onChange={(e) => fromLibrary(e.currentTarget.files)} />
          {ready.length === 0 && (
            <button
              type="button"
              className="px-1 text-[13px] font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
              onClick={() => onDone?.({ photos: [], skipped: true })}
            >
              Skip for now
            </button>
          )}
        </div>
      )}

      {camera !== null && (
        <CameraView
          shots={shots}
          start={camera}
          taken={byShot}
          onCapture={add}
          onClose={() => setCamera(null)}
        />
      )}
    </div>
  );
}

/** Full-screen camera that walks through the shot list. Falls back to the OS camera picker. */
function CameraView({
  shots,
  start,
  taken,
  onCapture,
  onClose,
}: {
  shots: Shot[];
  start: number;
  taken: Map<string, Taken>;
  onCapture: (file: File, shotId: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fallbackRef = useRef<HTMLInputElement>(null);
  const [index, setIndex] = useState(Math.max(0, start));
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const shot = shots[index];
  const allTaken = shots.every((s) => taken.has(s.id));

  useEffect(() => {
    let stream: MediaStream | undefined;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      queueMicrotask(() => setError("This browser can't open the camera here."));
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        setError(null);
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch((err: DOMException) =>
        setError(
          err.name === "NotAllowedError"
            ? "Camera access was blocked. Allow it in your browser settings, or use your phone's camera app."
            : "Couldn't find a camera.",
        ),
      );
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [facing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function next(after: number) {
    const rest = [...shots.slice(after + 1), ...shots.slice(0, after + 1)];
    const open = rest.find((s) => s.id !== shots[after].id && !taken.has(s.id));
    if (open) setIndex(shots.indexOf(open));
  }

  function capture() {
    const video = videoRef.current;
    if (!video?.videoWidth || !shot) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture(new File([blob], `${shot.id}.jpg`, { type: "image/jpeg" }), shot.id);
        next(index);
      },
      "image/jpeg",
      0.9,
    );
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
  }

  function fromFallback(files: FileList | null) {
    const file = files?.[0];
    if (file && shot) {
      onCapture(file, shot.id);
      next(index);
    }
    if (fallbackRef.current) fallbackRef.current.value = "";
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label="Camera">
      <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" />
      {/* Rule-of-thirds guide */}
      <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className="border-[0.5px] border-white/15" />
        ))}
      </div>
      <div
        className={`pointer-events-none absolute inset-0 bg-white transition-opacity duration-150 ${flash ? "opacity-70" : "opacity-0"}`}
      />

      <div className="relative bg-gradient-to-b from-black/70 to-transparent px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close camera"
            className="flex size-10 items-center justify-center rounded-full bg-black/40 backdrop-blur transition-colors hover:bg-black/60"
          >
            <CloseIcon size={18} />
          </button>
          <span className="text-white/80">
            {index + 1} of {shots.length}
          </span>
          <button
            type="button"
            onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
            aria-label="Switch camera"
            className="flex size-10 items-center justify-center rounded-full bg-black/40 text-lg backdrop-blur transition-colors hover:bg-black/60"
          >
            ⟲
          </button>
        </div>
        {shot && (
          <div className="mx-auto mt-4 max-w-md text-center">
            <div className="text-lg font-semibold">{shot.label}</div>
            <div className="mt-1 text-sm text-white/80">{shot.tip}</div>
          </div>
        )}
      </div>

      {error && (
        <div className="relative mx-auto mt-auto max-w-sm space-y-3 rounded-card bg-black/70 p-5 text-center text-sm backdrop-blur">
          <p>{error}</p>
          <Button size="sm" onClick={() => fallbackRef.current?.click()}>
            Take it with your camera app
          </Button>
        </div>
      )}
      <input
        ref={fallbackRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => fromFallback(e.currentTarget.files)}
      />

      <div className="relative mt-auto bg-gradient-to-t from-black/80 to-transparent px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-10">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
            {shots.map((s, i) => {
              const t = taken.get(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={s.label}
                  className={`relative size-11 shrink-0 overflow-hidden rounded-lg border-2 ${
                    i === index ? "border-white" : "border-white/20"
                  }`}
                >
                  {t ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local preview
                    <img src={t.preview} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xs text-white/70">{i + 1}</span>
                  )}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={error ? () => fallbackRef.current?.click() : capture}
            aria-label={`Take photo: ${shot?.label ?? ""}`}
            className="h-[72px] w-[72px] shrink-0 rounded-full border-4 border-white bg-white/90 transition-transform active:scale-95"
          />
          <div className="flex flex-1 justify-end">
            <button
              type="button"
              onClick={onClose}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${allTaken ? "bg-rausch hover:bg-rausch-active" : "bg-black/40 backdrop-blur hover:bg-black/60"}`}
            >
              {allTaken ? "All set" : "Done"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
