/**
 * "Add to list" feedback: a copy of the stay's photo lifts off the card and arcs into the apply
 * list, landing on its row's thumbnail when the list is on screen (the dock), else shrinking into
 * the "Apply list" pill, which then bounces. Nothing flies under reduced motion.
 *
 * `from` is the clicked button; the photo comes from its card (`[data-stay-photo]`). Targets are
 * `[data-apply-thumb="<id>"]` (ApplyList rows) and `[data-apply-list-pill]` (ApplyListPill).
 */
export function flyToList(from: HTMLElement, id: string, photo?: string | null) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const source = from.closest("article")?.querySelector<HTMLElement>("[data-stay-photo]") ?? from;
  const start = source.getBoundingClientRect();

  // wait two frames, so a dock or row that mounts for this item is in the page
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const thumb = visible(document.querySelectorAll<HTMLElement>(`[data-apply-thumb="${CSS.escape(id)}"]`));
      const pill = visible(document.querySelectorAll<HTMLElement>("[data-apply-list-pill]"));
      const target = thumb ?? pill;
      if (!target) return;
      launch(start, target, Boolean(thumb), photo);
    }),
  );
}

function launch(start: DOMRect, target: HTMLElement, intoThumb: boolean, photo?: string | null) {
  // a photo-less source (the side panel's button) flies as a small square from its centre
  const size = photo ? null : 56;
  const from = size
    ? new DOMRect(start.x + start.width / 2 - size / 2, start.y + start.height / 2 - size / 2, size, size)
    : start;
  const end = settledRect(target);

  const ghost = document.createElement("div");
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${from.x}px`,
    top: `${from.y}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    borderRadius: "14px",
    background: photo ? `center / cover no-repeat url("${photo}") var(--color-surface-strong)` : "var(--color-rausch)",
    boxShadow: "0 12px 32px rgb(0 0 0 / 0.22)",
    transformOrigin: "0 0",
    pointerEvents: "none",
    zIndex: "100",
  });
  document.body.append(ghost);

  // land on the thumbnail exactly, or shrink to a dot in the middle of the pill
  const sx = intoThumb ? end.width / from.width : 18 / from.width;
  const sy = intoThumb ? end.height / from.height : 18 / from.height;
  const dx = intoThumb ? end.x - from.x : end.x + end.width / 2 - 9 - from.x;
  const dy = intoThumb ? end.y - from.y : end.y + end.height / 2 - 9 - from.y;
  // arc up by a quarter of the distance, but keep the top of the flight on screen
  const lift = Math.max(0, Math.min(120, Math.max(48, Math.abs(dx) * 0.25), from.y + dy * 0.55 - 12));

  if (intoThumb) target.style.opacity = "0";
  const flight = ghost.animate(
    [
      { transform: "translate(0, 0) scale(1)", opacity: 1 },
      { transform: `translate(0, -10px) scale(1.04)`, opacity: 1, offset: 0.12 },
      {
        transform: `translate(${dx * 0.55}px, ${dy * 0.55 - lift}px) scale(${(1 + sx) / 2}, ${(1 + sy) / 2})`,
        opacity: 1,
        offset: 0.55,
      },
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: intoThumb ? 1 : 0.3 },
    ],
    { duration: 720, easing: "cubic-bezier(0.45, 0, 0.2, 1)" },
  );

  flight.finished
    .catch(() => {})
    .then(() => {
      ghost.remove();
      target.style.opacity = "";
      // the landing: the thumbnail settles, the pill bounces
      target.animate(
        intoThumb
          ? [{ transform: "scale(1.12)" }, { transform: "scale(0.96)" }, { transform: "scale(1)" }]
          : [{ transform: "scale(1)" }, { transform: "scale(1.14)" }, { transform: "scale(0.97)" }, { transform: "scale(1)" }],
        { duration: 420, easing: "ease-out" },
      );
    });
}

/** The first element in the list that's actually displayed and on screen. */
function visible(els: NodeListOf<HTMLElement>) {
  return [...els].find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
  });
}

/**
 * Where `el` will be once the entrance animations around it end (the dock slides in, the row
 * rises), so the photo lands where the thumbnail settles rather than where it is mid-slide.
 */
function settledRect(el: HTMLElement) {
  const moving = document.getAnimations().filter((a) => {
    const t = a.effect instanceof KeyframeEffect ? a.effect.target : null;
    const end = a.effect?.getComputedTiming().endTime;
    return a.playState === "running" && t instanceof Element && t.contains(el) && typeof end === "number" && Number.isFinite(end);
  });
  const saved = moving.map((a) => a.currentTime);
  moving.forEach((a) => (a.currentTime = a.effect!.getComputedTiming().endTime as number));
  const rect = el.getBoundingClientRect();
  moving.forEach((a, i) => (a.currentTime = saved[i]));
  return rect;
}
