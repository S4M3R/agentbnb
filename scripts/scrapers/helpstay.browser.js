// Browser-side scraper for HelpStay.
//
// Evaluate in a tab on https://helpstay.com, then call:
//
//   agentbnbScrapeHelpStay()
//
// Walks the public country listing (/volunteer-abroad/united-states?page=N),
// fetches each stay page, keeps the California ones, and downloads one
// `helpstay-<market>-<timestamp>.json` file. HelpStay exposes no coordinates,
// only a free-text "Country, Region" label; the adapter resolves Bay Area
// place names to a city centroid. Load it with `pnpm ingest <file>`.
// Progress is exposed on window.__agentbnbProgress.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function agentbnbScrapeHelpStay({
  market = "sf-bay-area",
  listPath = "/volunteer-abroad/united-states",
  // Title or region label must match to keep a stay (CA plus places that may omit the state).
  keep = /california|\bCA\b|bay area|san francisco|oakland|berkeley|san jose|santa cruz|sonoma|napa|marin|yosemite|los angeles|san diego|sacramento|ukiah/i,
  delayMs = 600,
  maxPages = 40,
  limit = Infinity,
  download = true,
} = {}) {
  const progress = (window.__agentbnbProgress = { state: "running", pages: 0, seen: 0, errors: [] });
  const startedAt = new Date().toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => (s ?? "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  const abs = (u) => (u ? new URL(u, location.origin).href : null);

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

  // Main results grid only: each card is .stay-card with a /stays/<slug> link.
  const parseCards = (doc) =>
    [...doc.querySelectorAll(".stay-card")]
      .map((card) => {
        const link = card.querySelector('a.stay-info[href^="/stays/"]');
        if (!link) return null;
        const hostLink = card.querySelector('.host-photo a[href^="/profile/"]');
        return {
          slug: link.getAttribute("href").replace(/^\/stays\//, ""),
          title: clean(card.querySelector(".stay-description span")?.textContent),
          country: clean(card.querySelector(".country-name")?.textContent) || null,
          cardPhoto: abs(card.querySelector(".stay-photo img")?.getAttribute("src")),
          hostName: clean(card.querySelector(".host-name")?.textContent) || null,
          hostTitle: clean(card.querySelector(".host-title")?.textContent) || null,
          hostProfileId: hostLink?.getAttribute("href").replace(/^\/profile\//, "") ?? null,
          hostAvatar: abs(card.querySelector(".host-photo img")?.getAttribute("src")),
          hostRating: Number(card.querySelector(".host-rating [data-rating]")?.getAttribute("data-rating")) || null,
          free: [...card.querySelectorAll(".free-thing .image-label")].map((e) => clean(e.textContent)),
        };
      })
      .filter(Boolean);

  const detailValue = (doc, label) => {
    const l = [...doc.querySelectorAll(".stay-detail label")].find((x) => clean(x.textContent) === label);
    return clean(l?.parentElement?.querySelector("span")?.textContent) || null;
  };
  const listUnder = (doc, heading) => {
    const h = [...doc.querySelectorAll(".checkmarked-list h6")].find((x) => clean(x.textContent) === heading);
    return h ? [...h.parentElement.querySelectorAll("p")].map((p) => clean(p.textContent)).filter(Boolean) : [];
  };
  const hostDetail = (doc, label) => {
    const l = [...doc.querySelectorAll(".stay-basic-details--display-block")].find(
      (x) => clean(x.textContent) === label,
    );
    return clean(l?.nextElementSibling?.textContent) || null;
  };

  const scrapeStay = async (card) => {
    const url = abs(`/stays/${card.slug}`);
    const doc = await getDoc(url);
    // Unpublished stays redirect to the homepage; only real stay pages have the intro header.
    if (!doc?.querySelector(".stay-intro h1")) return null;
    const label = clean(doc.querySelector(".stay-intro .country-name")?.textContent) || null;
    const [country, ...rest] = (label ?? "").split(",").map((s) => s.trim());
    const cal = doc.querySelector("input.datepicker-static");
    const descriptions = [...doc.querySelectorAll(".stay-description")].map((d) => clean(d.textContent));
    const overview = clean(doc.querySelector("#collapseTwo .stay-description")?.textContent) || null;
    const photos = [
      ...new Set(
        [...doc.querySelectorAll(".gallery .owl-carousel a[href^='/system/'], .stay-photos a.gallery-link")].map((a) =>
          abs(a.getAttribute("href")),
        ),
      ),
    ];
    const languagesRow = [...doc.querySelectorAll(".host-details-row")].find((r) =>
      /Languages spoken/.test(r.textContent),
    );
    return {
      id: doc.querySelector("[data-stay-id]")?.getAttribute("data-stay-id") ?? card.slug,
      slug: card.slug,
      url,
      title: clean(doc.querySelector(".stay-intro h1")?.textContent) || card.title,
      label,
      country: country || null,
      area: rest.join(", ") || null,
      hostName: card.hostName,
      hostTitle: card.hostTitle,
      hostProfileId: card.hostProfileId,
      hostAvatar: card.hostAvatar,
      hostRating: card.hostRating,
      hostSummary: descriptions[0] ?? null,
      hostLanguages: clean(languagesRow?.querySelector(".stay-basic-details")?.textContent)
        .split(/,\s*/)
        .filter(Boolean),
      responseRate: hostDetail(doc, "Response rate:"),
      responseTime: hostDetail(doc, "Response time:"),
      lastLogin: hostDetail(doc, "Last login:"),
      description: overview,
      stayDuration: detailValue(doc, "Stay duration:"),
      minimumAge: detailValue(doc, "Minimum Age:"),
      places: detailValue(doc, "Places available for:"),
      accommodation: detailValue(doc, "Accommodation:"),
      roomType: detailValue(doc, "Room type:"),
      meals: detailValue(doc, "We provide:"),
      linen: detailValue(doc, "Linen/bedding:"),
      laundry: detailValue(doc, "Laundry service:"),
      airport: detailValue(doc, "Closest airport:"),
      helpRequired: listUnder(doc, "Help Required"),
      hours: listUnder(doc, "Hours & Roster"),
      workDays: listUnder(doc, "Work Days"),
      whatElse: listUnder(doc, "What else?"),
      dateFrom: cal?.getAttribute("data-date-from") || null,
      dateTo: cal?.getAttribute("data-date-to") || null,
      free: card.free,
      photos: photos.length ? photos : card.cardPhoto ? [card.cardPhoto] : [],
    };
  };

  const items = [];
  try {
    const cards = new Map();
    for (let page = 1; page <= maxPages; page++) {
      const doc = await getDoc(page === 1 ? listPath : `${listPath}?page=${page}`);
      progress.pages = page;
      const fresh = (doc ? parseCards(doc) : []).filter((c) => !cards.has(c.slug));
      if (!fresh.length) break;
      fresh.forEach((c) => cards.set(c.slug, c));
      await sleep(delayMs);
    }
    progress.total = cards.size;

    for (const card of [...cards.values()]) {
      if (items.length >= limit) break;
      try {
        const stay = await scrapeStay(card);
        if (stay && keep.test(`${stay.title} ${stay.label ?? ""}`)) items.push(stay);
      } catch (err) {
        progress.errors.push({ slug: card.slug, error: String(err) });
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
  const file = { source: "helpstay", market, startedAt, finishedAt: new Date().toISOString(), complete, items };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
  a.download = `helpstay-${market}-${startedAt.replace(/[:.]/g, "-")}${complete ? "" : ".partial"}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  progress.file = a.download;
  return progress;
}
