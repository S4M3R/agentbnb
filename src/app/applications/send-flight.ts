/**
 * "Send" feedback for application cards in the chat, in 3D: each card lifts toward you, flips over
 * to a red "Sent" back with a paper plane, and flies into the header's Applications tab (where
 * they're tracked), which bounces as each one lands. With several (Send all) they leave one after
 * another. The real card hides while its copy flips over it and fades back in with its new status.
 * Nothing moves under reduced motion.
 *
 * Cards are `[data-application-card="<id>"]`.
 */
export function launchApplications(ids: string[]) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const cards = ids
    .map((id) => document.querySelector<HTMLElement>(`[data-application-card="${CSS.escape(id)}"]`))
    .filter((el): el is HTMLElement => !!el && el.getBoundingClientRect().height > 0);
  const tab = visibleTabIcon();
  cards.slice(0, 8).forEach((card, i) => launch(card, tab, i * 140));
}

const PLANE =
  '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2.5 10 14"/><path d="M21.5 2.5 14.5 21.5 10 14 2.5 9.5Z"/></svg>';

function launch(card: HTMLElement, tab: HTMLElement | null, delay: number) {
  const r = card.getBoundingClientRect();

  // wrapper: position, flight and fade; flipper: the 3D turn; two faces back to back
  const wrapper = document.createElement("div");
  wrapper.setAttribute("aria-hidden", "true");
  Object.assign(wrapper.style, {
    position: "fixed",
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    perspective: "900px",
    pointerEvents: "none",
    zIndex: "100",
  });
  const flipper = document.createElement("div");
  Object.assign(flipper.style, { position: "absolute", inset: "0", transformStyle: "preserve-3d" });

  const front = card.cloneNode(true) as HTMLElement;
  front.removeAttribute("data-application-card");
  Object.assign(front.style, {
    position: "absolute",
    inset: "0",
    margin: "0",
    backfaceVisibility: "hidden",
    boxShadow: "0 18px 40px rgb(0 0 0 / 0.18)",
  });

  const back = document.createElement("div");
  back.innerHTML = `${PLANE}<span>Sent</span>`;
  Object.assign(back.style, {
    position: "absolute",
    inset: "0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    borderRadius: "14px",
    background: "linear-gradient(135deg, #ff5a76, #e00b41)",
    color: "#fff",
    font: "700 18px/1 var(--font-sans)",
    backfaceVisibility: "hidden",
    transform: "rotateY(180deg)",
    boxShadow: "0 18px 40px rgb(224 11 65 / 0.35)",
  });

  flipper.append(front, back);
  wrapper.append(flipper);
  document.body.append(wrapper);

  // into the Applications tab's icon, or up and away when the header tab isn't on screen
  const end = tab?.getBoundingClientRect();
  const size = 28;
  const scale = size / r.width;
  const dx = end ? end.left + end.width / 2 - (r.left + r.width / 2) : r.width * 0.4;
  const dy = end ? end.top + end.height / 2 - (r.top + r.height / 2) : -r.top - r.height;

  const timing = { duration: 1100, delay, easing: "cubic-bezier(0.55, 0, 0.25, 1)", fill: "both" as const };
  card.animate(
    [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1, transform: "translateY(4px)", offset: 0.75 }, { opacity: 1 }],
    timing,
  );
  flipper.animate(
    [
      { transform: "translateZ(0) rotateX(0) rotateY(0)" },
      { transform: "translateZ(60px) rotateX(10deg) rotateY(0)", offset: 0.18 },
      { transform: "translateZ(40px) rotateX(6deg) rotateY(180deg)", offset: 0.5 },
      { transform: "translateZ(0) rotateX(0) rotateY(180deg) rotateZ(-12deg)" },
    ],
    timing,
  );
  const flight = wrapper.animate(
    [
      { transform: "translate(0, 0) scale(1)", opacity: 1 },
      { transform: "translate(0, -6px) scale(1)", opacity: 1, offset: 0.5 },
      {
        transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 40}px) scale(${(1 + scale) / 2.2})`,
        opacity: 1,
        offset: 0.75,
      },
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.2 },
    ],
    timing,
  );

  flight.finished
    .catch(() => {})
    .then(() => {
      wrapper.remove();
      card.getAnimations().forEach((a) => a.cancel());
      tab?.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.25) translateY(-3px)" }, { transform: "scale(0.94)" }, { transform: "scale(1)" }],
        { duration: 450, easing: "ease-out" },
      );
    });
}

/** The header's Applications tab icon, if it's on screen (desktop row or the phone's tab row). */
function visibleTabIcon() {
  return (
    [...document.querySelectorAll<HTMLElement>('a[href="/applications"] img, a[href="/applications"]')].find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
    }) ?? null
  );
}
