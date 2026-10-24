// Browser-side scraper for Volunteers Base.
//
// Evaluate in a tab on https://www.volunteersbase.com, then call:
//
//   agentbnbScrapeVolunteersBase()
//
// Walks the public USA project list (/americas/usa, /americas/usa/2, ...),
// fetches each project page, keeps the California ones (by location text or
// by map pin inside California), and downloads one
// `volunteersbase-<market>-<timestamp>.json` file. Load it with
// `pnpm ingest <file>`. Progress is exposed on window.__agentbnbProgress.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function agentbnbScrapeVolunteersBase({
  market = "sf-bay-area",
  listPath = "/americas/usa",
  keep = /california|\bCA\b/i,
  // Rough California box, used when the location text omits the state.
  stateBox = { north: 42.1, south: 32.4, east: -114.1, west: -124.6 },
  delayMs = 600,
  maxPages = 60,
  limit = Infinity,
  download = true,
} = {}) {
  const progress = (window.__agentbnbProgress = { state: "running", pages: 0, seen: 0, errors: [] });
  const startedAt = new Date().toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => (s ?? "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  const num = (s) => (s == null || s === "" || Number.isNaN(Number(s)) ? null : Number(s));

  const getDoc = async (url, tries = 4) => {
    for (let i = 1; ; i++) {
      try {
        const res = await fetch(url);
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        return new DOMParser().parseFromString(await res.text(), "text/html");
      } catch (err) {
        if (i >= tries) throw err;
        await sleep(1000 * 2 ** i);
      }
    }
  };

  // Main results only (.vb-search-card); "similar projects" blocks live elsewhere.
  const parseCards = (doc) =>
    [...doc.querySelectorAll(".vb-search-card")]
      .map((card) => {
        const a = card.querySelector("h2 a[href]");
        const href = a?.getAttribute("href");
        const id = href?.match(/_i(\d+)$/)?.[1];
        if (!id) return null;
        const loc = [...card.querySelectorAll(".vb-search-meta div")].find((d) => /Location:/.test(d.textContent));
        return {
          id,
          url: new URL(href, location.origin).href,
          title: clean(a.textContent),
          listLocation: clean(loc?.textContent).replace(/^Location:\s*/, "") || null,
        };
      })
      .filter(Boolean);

  const scrapeProject = async (card) => {
    const doc = await getDoc(card.url);
    if (!doc) return null;
    const pin = doc.querySelector("#map-placeholder");
    const heading = [...doc.querySelectorAll(".vb-section-title")].find((h) => /^Location:/.test(clean(h.textContent)));
    const desc = doc.querySelector(".vb-description");
    desc?.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
    return {
      id: card.id,
      url: card.url,
      title: clean(doc.querySelector("h1")?.textContent) || card.title,
      location: clean(heading?.textContent).replace(/^Location:\s*/, "") || card.listLocation,
      listLocation: card.listLocation,
      city: pin?.getAttribute("data-city") || null,
      country: pin?.getAttribute("data-country") || null,
      lat: num(pin?.getAttribute("data-lat")),
      lng: num(pin?.getAttribute("data-lon")),
      verifiedHost: Boolean(doc.querySelector(".vb-id-wordmark")),
      description: clean(desc?.textContent),
      photos: [...new Set([...doc.querySelectorAll(".vb-photo-grid a.vb-lightbox")].map((x) => x.getAttribute("href")))],
    };
  };

  // Box plus California's diagonal eastern border (Lake Tahoe to the Colorado River), so
  // Nevada pins (Las Vegas, Reno) don't count.
  const inState = (p) =>
    p.lat != null && p.lng != null &&
    p.lat <= stateBox.north && p.lat >= stateBox.south && p.lng <= stateBox.east && p.lng >= stateBox.west &&
    (p.lat >= 39 ? p.lng <= -120 : p.lng <= -120 + (39 - p.lat) * 1.35);

  const items = [];
  try {
    const cards = new Map();
    for (let page = 1; page <= maxPages; page++) {
      const doc = await getDoc(page === 1 ? listPath : `${listPath}/${page}`);
      progress.pages = page;
      const fresh = (doc ? parseCards(doc) : []).filter((c) => !cards.has(c.id));
      if (!fresh.length) break;
      fresh.forEach((c) => cards.set(c.id, c));
      await sleep(delayMs);
    }
    progress.total = cards.size;

    for (const card of cards.values()) {
      if (items.length >= limit) break;
      try {
        const p = await scrapeProject(card);
        if (p && (keep.test(`${p.title} ${p.location ?? ""} ${p.city ?? ""} ${card.url}`) || inState(p))) items.push(p);
      } catch (err) {
        progress.errors.push({ id: card.id, error: String(err) });
      }
      progress.seen++;
      progress.kept = items.length;
      await sleep(delayMs);
    }
    progress.state = "done";
  } catch (err) {
    progress.state = "failed";
    progress.error = String(err);
  }

  const complete = progress.state === "done" && limit === Infinity;
  progress.items = items.length;
  if (!download) {
    progress.preview = items;
    return progress;
  }
  const file = { source: "volunteersbase", market, startedAt, finishedAt: new Date().toISOString(), complete, items };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
  a.download = `volunteersbase-${market}-${startedAt.replace(/[:.]/g, "-")}${complete ? "" : ".partial"}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  progress.file = a.download;
  return progress;
}
