// Browser-side scraper for MindMyHouse (house sitting).
//
// Evaluate in a tab on https://www.mindmyhouse.com (it fetches the site's own
// server-rendered pages same-origin), then call:
//
//   agentbnbScrapeMindMyHouse()
//
// Pages through the public assignment search for one country (United States =
// 72 by default), fetches each assignment page, and downloads one
// `mindmyhouse-<market>-<timestamp>.json` file. Load it with `pnpm ingest <file>`.
// Progress is exposed on window.__agentbnbProgress.
//
// Notes:
// - Search filters are URL segments: /sitters/search_assignments/<key>_<value>__.../<offset>.
// - The search page's Leaflet map script carries a marker (lat/lng) for every result.
//   Coordinates are rounded to ~1 km here: they may be the owner's geocoded address.
// - Owner details are login-only; testimonial text is not collected (count only).

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function agentbnbScrapeMindMyHouse({
  market = "sf-bay-area",
  countryId = 72, // United States
  pageSize = 20,
  delayMs = 600,
  maxPages = 20,
  limit = Infinity,
} = {}) {
  const progress = (window.__agentbnbProgress = { state: "running", pages: 0, cards: 0, seen: 0, errors: [] });
  const startedAt = new Date().toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) =>
    (s ?? "")
      .replace(/[ \t\r\f\v]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  const text = (el) => clean(el?.textContent);
  const round = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
  const DATE_RANGE = /\d{1,2} [A-Za-z]{3,9} \d{4} (?:-|to) \d{1,2} [A-Za-z]{3,9} \d{4}/;
  const abs = (u) => (u ? new URL(u, location.origin).href : null);

  const get = async (url) => {
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const html = await res.text();
    return { html, doc: new DOMParser().parseFromString(html, "text/html") };
  };

  // Leaflet markers: L.marker(new L.LatLng(lat, lng), ...); markerN.bindPopup('<...href="/sitters/assignment/ID"...<div class="summary">LOC</div>...')
  const parseMarkers = (html) => {
    const out = new Map();
    const re = /L\.marker\(new L\.LatLng\(\s*(-?[\d.]+),\s*(-?[\d.]+)\)[\s\S]*?bindPopup\('([\s\S]*?)'\s*\/\*/g;
    let m;
    while ((m = re.exec(html))) {
      const popup = m[3];
      const id = /\/sitters\/assignment\/(\d+)/.exec(popup)?.[1];
      if (!id) continue;
      const summary = /<div class="summary">([^<]*)<\/div>/.exec(popup)?.[1] ?? null;
      out.set(id, { lat: round(Number(m[1])), lng: round(Number(m[2])), mapLocation: summary ? clean(summary) : null });
    }
    return out;
  };

  const parseDetail = (doc, html) => {
    doc.querySelectorAll("script, style, svg").forEach((e) => e.remove());
    const blurb = {};
    const blurbCol = doc.querySelector(".assignment-blurb .layout-col-8");
    for (const h of blurbCol?.querySelectorAll("h2.title") ?? []) {
      const parts = [];
      for (let n = h.nextElementSibling; n && !n.matches("h2"); n = n.nextElementSibling) {
        if (n.matches(".assignment-updated")) break;
        parts.push(text(n));
      }
      blurb[text(h)] = parts.filter(Boolean).join("\n\n");
    }
    const testimonials = text(doc.querySelector(".assignment-summary .testimonials p"));
    const facilities = [...(doc.querySelectorAll(".assignment-summary .testimonials h2") ?? [])]
      .filter((h) => /facilities/i.test(text(h)))
      .map((h) => text(h.nextElementSibling))[0];
    const mapMarker = /markers=(-?[\d.]+),(-?[\d.]+)/.exec(html);
    return {
      title: text(doc.querySelector(".assignment-title h1.title")),
      location: text(doc.querySelector(".assignment-title .location")),
      // "House sitting opportunity available in Deerfield Township Ohio United States"
      metaLocation:
        doc.querySelector('meta[name="description"]')?.content?.replace(/^.*available in\s*/i, "") ?? null,
      pets: [...doc.querySelectorAll(".assignment-summary .pets-list li")].map((li) => li.title || text(li)),
      petsNote: text(doc.querySelector(".assignment-summary .pets-list + p")) || null,
      dates: [...doc.querySelectorAll(".assignment-summary .dates-list li")].map((li) => ({
        range: DATE_RANGE.exec(text(li))?.[0] ?? text(li),
        applicants: text(li.querySelector(".applicant-count")) || null,
      })),
      testimonials: testimonials || null,
      facilities: facilities || null,
      blurb,
      lastUpdated: text(blurbCol?.querySelector(".assignment-updated")).replace(/^Last updated:\s*/i, "") || null,
      lat: mapMarker ? round(Number(mapMarker[2])) : null,
      lng: mapMarker ? round(Number(mapMarker[1])) : null,
      photos: [...doc.querySelectorAll(".listing-gallery-thumbnails-container a[href]")].map((a) =>
        abs(a.getAttribute("href")),
      ),
      ownerLoginOnly: /logged in to see this info/i.test(text(doc.querySelector(".about-owner"))),
    };
  };

  const items = [];
  try {
    const cards = new Map();
    const markers = new Map();
    for (let page = 0; page < maxPages; page++) {
      const base = `/sitters/search_assignments/sort_submission__country_${countryId}__availablerangefrom_1__availablerangeto_9999`;
      const { html, doc } = await get(page ? `${base}/${page * pageSize}` : base);
      progress.pages = page + 1;
      progress.total = /Found (\d+) assignments/.exec(html)?.[1] ?? progress.total;
      for (const [id, m] of parseMarkers(html)) markers.set(id, m);
      let fresh = 0;
      // Main results list only (the map popups are parsed separately above).
      for (const art of doc.querySelectorAll("section.results article.item[id^='item-']")) {
        const id = art.id.replace("item-", "");
        if (cards.has(id)) continue;
        fresh++;
        const img = /url\(([^)]+)\)/.exec(art.querySelector(".image-small")?.getAttribute("style") ?? "")?.[1];
        cards.set(id, {
          id,
          url: `https://www.mindmyhouse.com/sitters/assignment/${id}`,
          title: text(art.querySelector("h2.title")),
          location: text(art.querySelector("p.location")),
          dates: [...art.querySelectorAll(".assignment-dates-list > li")].map((li) => DATE_RANGE.exec(text(li))?.[0] ?? text(li)),
          petsSummary: text(art.querySelector("li.pets")),
          image: abs(img),
          legendary: text(art.querySelector("[class^='legendary-member']")) || null,
        });
      }
      progress.cards = cards.size;
      if (!fresh || (progress.total && cards.size >= Number(progress.total))) break;
      await sleep(delayMs);
    }

    for (const card of cards.values()) {
      if (items.length >= limit) break;
      progress.seen++;
      try {
        const { html, doc } = await get(`/sitters/assignment/${card.id}`);
        items.push({ ...card, ...(markers.get(card.id) ?? {}), detail: parseDetail(doc, html) });
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
  const file = { source: "mindmyhouse", market, startedAt, finishedAt: new Date().toISOString(), complete, items };
  window.__agentbnbLastFile = file;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
  a.download = `mindmyhouse-${market}-${startedAt.replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  progress.file = a.download;
  progress.items = items.length;
  return progress;
}
