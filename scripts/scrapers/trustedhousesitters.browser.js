// Browser-side scraper for TrustedHousesitters.
//
// Evaluate in a tab on https://www.trustedhousesitters.com (it uses the site's
// own same-origin API), then call:
//
//   agentbnbScrapeTHS()
//
// Pages through open, upcoming sits inside the market bounds, fetches each
// listing's detail, and downloads one `trustedhousesitters-<market>-<timestamp>.json`
// file. Load it with `pnpm ingest <file>`. Progress is exposed on
// window.__agentbnbProgress.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function agentbnbScrapeTHS({
  market = "sf-bay-area",
  bounds = { north: 38.35, south: 36.95, east: -121.55, west: -123.1 },
  pageSize = 50,
  delayMs = 350,
  maxPages = 100,
  limit = Infinity,
} = {}) {
  const progress = (window.__agentbnbProgress = { state: "running", pages: 0, seen: 0, errors: [] });
  const startedAt = new Date().toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const today = startedAt.slice(0, 10);

  // The API occasionally returns an empty/5xx response; retry with backoff.
  const getJson = async (url, tries = 4) => {
    for (let i = 1; ; i++) {
      try {
        const res = await fetch(url);
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        return await res.json();
      } catch (err) {
        if (i >= tries) throw err;
        await sleep(1000 * 2 ** i);
      }
    }
  };

  const search = async (page) => {
    const query = {
      filters: {
        activeMembership: true,
        geoBounds: bounds,
        assignments: { confirmed: false, dateFrom: today },
      },
      facets: [],
      // Without an explicit sort the result order shifts between pages.
      sort: [{ published: { order: "desc" } }],
      page,
      resultsPerPage: pageSize,
      debug: false,
      stats: [],
    };
    return getJson(`/api/v3/search/listings/?query=${encodeURIComponent(JSON.stringify(query))}`);
  };

  const items = [];
  try {
    const seenIds = new Set();
    for (let page = 1; page <= maxPages && seenIds.size < limit; page++) {
      const { results, total } = await search(page);
      progress.pages = page;
      progress.total = total;
      if (!results?.length) break;

      for (const summary of results) {
        if (seenIds.has(summary.id) || seenIds.size >= limit) continue;
        seenIds.add(summary.id);
        progress.seen = seenIds.size;

        // Some listings' detail endpoint consistently returns an empty body; fall
        // back to the search summary (title, location, photos, open assignments).
        const detail = await getJson(`/api/v3/search/listings/${summary.id}/`).catch((err) => {
          progress.fallbacks = (progress.fallbacks ?? 0) + 1;
          progress.lastFallbackError = String(err);
          return summary;
        });
        if (detail) {
          // Search results carry the upcoming open assignments; detail carries history.
          const byId = new Map((detail.assignments ?? []).map((a) => [a.id, a]));
          for (const a of summary.assignments ?? []) byId.set(a.id, { ...byId.get(a.id), ...a });
          items.push({ ...detail, animals: summary.animals, assignments: [...byId.values()] });
        }
        await sleep(delayMs);
      }
      if (seenIds.size >= total) break;
    }
    progress.state = "done";
  } catch (err) {
    progress.state = "failed";
    progress.error = String(err);
  }

  // A partial scrape must not mark unseen listings as gone.
  const complete = progress.state === "done" && limit === Infinity && !progress.errors.length;
  const file = { source: "trustedhousesitters", market, startedAt, finishedAt: new Date().toISOString(), complete, items };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
  a.download = `trustedhousesitters-${market}-${startedAt.replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  progress.file = a.download;
  progress.items = items.length;
  return progress;
}
