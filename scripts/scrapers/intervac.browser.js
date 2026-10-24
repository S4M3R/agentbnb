// Browser-side scraper for Intervac.
//
// (www.intervachomeexchange.com is a parked domain; the real site is
// intervac-homeexchange.com.) Evaluate in a tab on
// https://us.intervac-homeexchange.com, then call:
//
//   agentbnbScrapeIntervac()
//
// Pages through the public map-bounds search (same-origin HTML, sorted by
// listing number), then fetches each public listing page and parses it with
// DOMParser. Member references (reviews) are counted, not stored.
// Coordinates are rounded to ~1km. Downloads one
// `intervac-<market>-<timestamp>.json`; load it with `pnpm ingest <file>`.
// Progress is on window.__agentbnbProgress.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function agentbnbScrapeIntervac({
  market = "sf-bay-area",
  bounds = { north: 38.35, south: 36.95, east: -121.55, west: -123.1 },
  perPage = 48,
  delayMs = 700,
  maxPages = 20,
  limit = Infinity,
} = {}) {
  const progress = (window.__agentbnbProgress = { state: "running", pages: 0, seen: 0, details: 0, errors: [] });
  const startedAt = new Date().toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const round = (n) => (n == null || n === "" || isNaN(Number(n)) ? null : Math.round(Number(n) * 100) / 100);
  const text = (el) => el?.textContent.replace(/\s+/g, " ").trim() || null;
  const parser = new DOMParser();

  const getDoc = async (url, tries = 4) => {
    for (let i = 1; ; i++) {
      try {
        const res = await fetch(url, { credentials: "same-origin" });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        return parser.parseFromString(await res.text(), "text/html");
      } catch (err) {
        if (i >= tries) throw err;
        await sleep(1000 * 2 ** i);
      }
    }
  };

  const parseCard = (card) => {
    const href = card.querySelector("a.result-card-location-link, a.result-card-view-link")?.getAttribute("href");
    const id = href?.match(/\/listings\/(\d+)/)?.[1];
    if (!id) return null;
    const cap = (title) => {
      const n = parseInt(text(card.querySelector(`.result-card-capacity li[title="${title}"] span`)) ?? "", 10);
      return Number.isFinite(n) ? n : null;
    };
    return {
      id,
      city: text(card.querySelector(".result-card-city")),
      country: text(card.querySelector(".result-card-country")),
      headline: text(card.querySelector(".result-card-headline")),
      exchangeDatesText: text(card.querySelector(".result-card-exchange-dates span")),
      sleeps: cap("Sleeping Capacity"),
      adults: cap("Adults"),
      children: cap("Children"),
      exchanges: card.querySelector(".membership-badge")?.getAttribute("title") ?? null,
    };
  };

  // dd/mm/yyyy -> yyyy-mm-dd
  const dmy = (s) => {
    const m = s?.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  };

  // Items under an <h3>: <li>label <strong>value</strong></li> pairs, or .well-title tiles.
  const section = (doc, heading) => {
    const h3 = [...doc.querySelectorAll("h3")].find((h) => text(h) === heading);
    if (!h3) return null;
    const box = h3.nextElementSibling;
    if (!box) return null;
    const lis = [...box.querySelectorAll("li")];
    if (lis.length && lis.some((li) => li.querySelector("strong"))) {
      return Object.fromEntries(
        lis.map((li) => {
          const value = text(li.querySelector("strong"));
          const label = text(li)?.replace(value ?? "", "").trim();
          return [label, value];
        }),
      );
    }
    return [...box.querySelectorAll(".well-title")].map(text).filter(Boolean);
  };

  const parseDetail = (doc) => {
    const map = doc.querySelector("#surrounding-map");
    const periods = new Map();
    for (const tr of doc.querySelectorAll('tr[id^="date-"]')) {
      const cells = [...tr.querySelectorAll("td")];
      const dates = cells.map((td) => dmy(text(td.querySelector(".visible-mobile:not(.strong)")) ?? text(td)));
      const [start, end] = dates.filter(Boolean);
      const stay = cells.map(text).find((t) => /days?/i.test(t ?? "") && !/\d{2}\/\d{2}/.test(t)) ?? null;
      const flexible = cells.length ? text(cells[cells.length - 1])?.replace("Flexible dates", "").trim() ?? null : null;
      if (start && end) periods.set(tr.id, { id: tr.id.replace("date-", ""), startDate: start, endDate: end, lengthOfStay: stay?.replace("Length of stay (nb of days)", "").trim() ?? null, flexible });
    }
    const profile = doc.querySelector("a.profile-small[href^='/profiles/']");
    return {
      listingNumber: text(doc.querySelector(".listing-number")),
      title: text(doc.querySelector(".listing-headline")),
      description: [...doc.querySelectorAll(".listing-presentation-text p")].map(text).filter(Boolean).join("\n\n") || null,
      overview: [...doc.querySelectorAll(".overview-section .well-title")].map(text).filter(Boolean),
      property: section(doc, "Property"),
      houseRules: section(doc, "House rules"),
      vehicles: section(doc, "Vehicles included in exchange"),
      essentials: section(doc, "House essentials"),
      features: section(doc, "House features"),
      accessibility: section(doc, "Accessibility"),
      neighborhood: text(doc.querySelector(".neighbourhood-section .content-translate-origin")),
      // Rendered twice (desktop + mobile).
      wishlist: [...new Set([...doc.querySelectorAll(".destination-wishlist li")].map(text).filter(Boolean))],
      status: text(doc.querySelector(".red-green-light-dot-text")),
      // The desktop table renders this cell only when no periods are set.
      alwaysOpen: Boolean(doc.querySelector(".td-exchange-anytime")),
      periods: [...periods.values()],
      lat: round(map?.getAttribute("data-lat")),
      lng: round(map?.getAttribute("data-lng")),
      photos: [...new Set([...doc.querySelectorAll("img.mt-slider-image")].map((img) => img.getAttribute("src")))].map((src) => ({
        url: src,
        caption: [...doc.querySelectorAll("img.mt-slider-image")].find((i) => i.getAttribute("src") === src)?.getAttribute("alt") || null,
      })),
      host: profile
        ? {
            id: profile.getAttribute("href").match(/\/profiles\/(\d+)/)?.[1] ?? null,
            firstName: text(profile.querySelector(".profile-name-row h3"))?.replace(/['’]s profile$/, "") ?? null,
          }
        : null,
      referenceCount: doc.querySelectorAll(".listing-reference").length,
    };
  };

  const items = [];
  try {
    const cards = new Map();
    for (let page = 1; page <= maxPages && cards.size < limit; page++) {
      const qs = new URLSearchParams({
        ne_lat: bounds.north,
        ne_lng: bounds.east,
        sw_lat: bounds.south,
        sw_lng: bounds.west,
        per_page: perPage,
        order_by: "listing_number",
        page,
      });
      const doc = await getDoc(`/search/search?${qs}`);
      progress.pages = page;
      const found = [...(doc?.querySelectorAll("#search-results .result-card") ?? [])].map(parseCard).filter(Boolean);
      const before = cards.size;
      for (const c of found) if (cards.size < limit && !cards.has(c.id)) cards.set(c.id, c);
      progress.seen = cards.size;
      const hasNext = [...(doc?.querySelectorAll("a[href*='page=']") ?? [])].some((a) =>
        new URL(a.href, location.origin).searchParams.get("page") === String(page + 1),
      );
      if (!found.length || cards.size === before || !hasNext) break;
      await sleep(delayMs);
    }

    for (const card of cards.values()) {
      const doc = await getDoc(`/listings/${card.id}`).catch((err) => {
        progress.errors.push({ id: card.id, error: String(err) });
        return null;
      });
      items.push({ ...card, ...(doc ? parseDetail(doc) : {}), hasDetail: Boolean(doc) });
      progress.details++;
      await sleep(delayMs);
    }
    progress.state = "done";
  } catch (err) {
    progress.state = "failed";
    progress.error = String(err);
  }

  const complete = progress.state === "done" && limit === Infinity && !progress.errors.length;
  const file = { source: "intervac", market, startedAt, finishedAt: new Date().toISOString(), complete, items };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
  a.download = `intervac-${market}-${startedAt.replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  progress.file = a.download;
  progress.items = items.length;
  return progress;
}
