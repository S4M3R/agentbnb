// Browser-side scraper for Nomador (house sitting).
//
// Evaluate in a tab on https://www.nomador.com (it fetches the site's own
// server-rendered pages same-origin), then call:
//
//   agentbnbScrapeNomador()
//
// Pages through the public house-sit search for one Google place (United States
// by default), keeps sits whose end date is still ahead, fetches each detail
// page, and downloads one `nomador-<market>-<timestamp>.json` file. Load it with
// `pnpm ingest <file>`. Progress is exposed on window.__agentbnbProgress.
//
// Notes:
// - The search filter is a Google place id (`location=`); `from=YYYY-MM-DD` keeps
//   sits starting on/after that date. We start a few months back so ongoing sits
//   are included; the detail page says whether the offer is still open.
// - "Hosting a traveller for a night" stopovers have no dates and are skipped.
// - Coordinates are the city centroid Nomador geocodes each stay to.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function agentbnbScrapeNomador({
  market = "sf-bay-area",
  placeId = "ChIJCzYy5IS16lQRQrfeQ5K5Oxw", // United States
  lookbackDays = 120,
  delayMs = 600,
  maxPages = 60,
  limit = Infinity,
} = {}) {
  const progress = (window.__agentbnbProgress = { state: "running", pages: 0, cards: 0, seen: 0, errors: [] });
  const startedAt = new Date().toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const today = startedAt.slice(0, 10);
  const from = new Date(Date.now() - lookbackDays * 864e5).toISOString().slice(0, 10);
  const clean = (s) =>
    (s ?? "")
      .replace(/[ \t\r\f\v]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  const text = (el) => clean(el?.textContent);

  const getDoc = async (url) => {
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return new DOMParser().parseFromString(await res.text(), "text/html");
  };

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  // "From the 13 to the 21 Nov 26" / "From the 22 Dec to the 18 Jan 27" → end date ISO
  const cardEnd = (s) => {
    const m = /to the (\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{2,4})/.exec(s ?? "");
    if (!m) return null;
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const mo = MONTHS[m[2].toLowerCase()];
    return mo ? `${y}-${String(mo).padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
  };

  // Rich text with <br> kept as newlines.
  const richText = (el) => {
    if (!el) return "";
    const c = el.cloneNode(true);
    c.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
    return clean(c.textContent);
  };

  // Walk a .v-profile__section into [{heading, text}] blocks: <p><strong>X</strong></p>
  // starts a block, everything until the next one is its text.
  const sectionBlocks = (section) => {
    const blocks = [];
    let cur = { heading: null, text: "" };
    const push = () => {
      if (cur.heading || cur.text.trim()) blocks.push({ heading: cur.heading, text: clean(cur.text) });
    };
    for (const content of section.querySelectorAll(":scope > .v-profile__content")) {
      for (const node of content.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          cur.text += node.textContent;
          continue;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const el = node;
        if (el.matches("p") && el.querySelector(":scope > strong")) {
          push();
          cur = { heading: text(el.querySelector(":scope > strong")), text: "" };
        } else if (el.matches("br")) {
          cur.text += "\n";
        } else if (el.id === "single-map") {
          // handled separately
        } else {
          const full = el.matches(".translatable__wrapper") ? el.querySelector(".js-see-more--full") : el;
          if (el.matches(".translatable__translated, .v-profile__actions")) continue;
          cur.text += "\n" + richText(full) + "\n";
        }
      }
      push();
      cur = { heading: null, text: "" };
    }
    return blocks;
  };

  const parseDetail = (d) => {
    d.querySelectorAll("script, style, svg").forEach((e) => e.remove());
    const photos = [];
    const seenPhoto = new Set();
    for (const a of d.querySelectorAll(".c-gallery a.js-gallery-picture")) {
      const href = a.getAttribute("href");
      const key = href?.split("/").pop();
      if (!href || seenPhoto.has(key)) continue;
      seenPhoto.add(key);
      photos.push({
        url: href,
        width: Number(a.dataset.width) || null,
        height: Number(a.dataset.height) || null,
        caption: a.dataset.caption || null,
      });
    }
    const sections = {};
    for (const s of d.querySelectorAll(".v-profile__section[id]")) {
      // Host and review text stay out of the scrape (other members' content).
      if (s.id === "owner" || s.id === "reviews") continue;
      sections[s.id] = sectionBlocks(s);
    }
    const map = d.querySelector("#single-map");
    const owner = d.querySelector("#owner");
    const ownerLink = owner?.querySelector("a.c-owner__title");
    const hostNotes = [...(owner?.querySelectorAll(".v-profile__column") ?? [])]
      .filter((c) => !c.querySelector(".js-housing"))
      .map((c) => text(c))
      .filter(Boolean);
    const stay = d.querySelector(".c-stay");
    const action = stay?.querySelector(".c-stay__action");
    return {
      title: text(d.querySelector(".c-header-stay__title")),
      location: text(d.querySelector(".c-header-stay__location")),
      published: text(d.querySelector(".c-header-stay__published-date")).replace(/^Published\s*/i, "") || null,
      lat: map ? Number(map.dataset.lat) : null,
      lng: map ? Number(map.dataset.lng) : null,
      photos,
      sections,
      host: ownerLink
        ? {
            id: ownerLink.getAttribute("href")?.match(/\/profile\/(\w+)/)?.[1] ?? null,
            name: text(ownerLink).replace(/^This stay is proposed by\s*/i, "") || null,
            notes: hostNotes,
          }
        : null,
      stay: stay
        ? {
            from: text(stay.querySelector(".c-stay__from")),
            to: text(stay.querySelector(".c-stay__to")),
            caption: text(stay.querySelector(".c-stay__caption")),
            requests: text(stay.querySelector(".c-stay__label")),
            action: text(action),
            open: !!action && !action.matches(".c-button--disabled"),
          }
        : null,
    };
  };

  const items = [];
  try {
    // 1. Collect search cards.
    const cards = new Map();
    for (let page = 1; page <= maxPages; page++) {
      const d = await getDoc(`/house-sitting/?location=${placeId}&from=${from}&page=${page}`);
      progress.pages = page;
      progress.total = text(d.body).match(/out of a total of ([\d,]+)/)?.[1] ?? progress.total;
      let fresh = 0;
      for (const c of d.querySelectorAll(".js-housing[data-link]")) {
        const id = c.dataset.link.split("/").pop();
        if (cards.has(id)) continue;
        fresh++;
        cards.set(id, {
          id,
          stayId: c.dataset.stayid ?? null,
          title: c.dataset.title ?? null,
          dates: c.dataset.dates ?? null,
          lat: c.dataset.lat ? Number(c.dataset.lat) : null,
          lng: c.dataset.lng ? Number(c.dataset.lng) : null,
          picture: c.dataset.picture ?? null,
          location: text(c.querySelector(".c-housing__heading + .c-housing__description")),
          flexibility: text(c.querySelector(".c-housing__availability .c-housing__description")),
          pets: text(c.querySelector(".c-housing__spec")),
        });
      }
      progress.cards = cards.size;
      if (!fresh) break;
      await sleep(delayMs);
    }

    // 2. Details for sits that haven't ended yet.
    const upcoming = [...cards.values()].filter((c) => (cardEnd(c.dates) ?? "") >= today);
    progress.upcoming = upcoming.length;
    for (const card of upcoming) {
      if (items.length >= limit) break;
      progress.seen++;
      try {
        const detail = parseDetail(await getDoc(`/house-sitting/${card.id}`));
        items.push({ ...card, url: `https://www.nomador.com/house-sitting/${card.id}`, detail });
      } catch (err) {
        progress.errors.push({ id: card.id, error: String(err) });
      }
      progress.items = items.length;
      await sleep(delayMs);
    }
    progress.state = "done";
  } catch (err) {
    progress.state = "failed";
    progress.error = String(err);
  }

  // A partial scrape must not mark unseen listings as gone.
  const complete = progress.state === "done" && limit === Infinity && !progress.errors.length;
  const file = { source: "nomador", market, startedAt, finishedAt: new Date().toISOString(), complete, items };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
  a.download = `nomador-${market}-${startedAt.replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  progress.file = a.download;
  progress.items = items.length;
  return progress;
}
