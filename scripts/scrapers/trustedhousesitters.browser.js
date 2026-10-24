// Browser-side scraper for TrustedHousesitters.
//
// Paste/evaluate this in a tab on https://www.trustedhousesitters.com (it uses
// the site's own same-origin API), then call:
//
//   agentbnbScrapeTHS({ endpoint: "http://localhost:3000", token: "<INGEST_TOKEN>" })
//
// It pages through open, upcoming sits inside the market bounds, fetches each
// listing's detail, and posts batches to /api/ingest/trustedhousesitters.
// Progress is exposed on window.__agentbnbProgress.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function agentbnbScrapeTHS({
  endpoint,
  token,
  market = "sf-bay-area",
  bounds = { north: 38.35, south: 36.95, east: -121.55, west: -123.1 },
  pageSize = 50,
  batchSize = 25,
  delayMs = 350,
  maxPages = 100,
}) {
  const progress = (window.__agentbnbProgress = {
    state: "running",
    pages: 0,
    seen: 0,
    posted: 0,
    counts: { found: 0, created: 0, updated: 0, unchanged: 0, skipped: 0 },
    errors: [],
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const today = new Date().toISOString().slice(0, 10);

  const ingest = async (body) => {
    const res = await fetch(`${endpoint}/api/ingest/trustedhousesitters`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`ingest ${body.action} ${res.status}: ${await res.text()}`);
    return res.json();
  };

  const search = async (page) => {
    const query = {
      filters: {
        activeMembership: true,
        geoBounds: bounds,
        assignments: { confirmed: false, dateFrom: today },
      },
      facets: [],
      sort: [],
      page,
      resultsPerPage: pageSize,
      debug: false,
      stats: [],
    };
    const res = await fetch(`/api/v3/search/listings/?query=${encodeURIComponent(JSON.stringify(query))}`);
    if (!res.ok) throw new Error(`search page ${page}: ${res.status}`);
    return res.json();
  };

  const { runId } = await ingest({ action: "start", market });
  progress.runId = runId;

  try {
    const seenIds = new Set();
    let buffer = [];
    const flush = async () => {
      if (!buffer.length) return;
      const { counts, errors } = await ingest({ action: "batch", runId, items: buffer });
      for (const k of Object.keys(progress.counts)) progress.counts[k] += counts[k] ?? 0;
      progress.errors.push(...errors);
      progress.posted += buffer.length;
      buffer = [];
    };

    for (let page = 1; page <= maxPages; page++) {
      const { results, total } = await search(page);
      progress.pages = page;
      progress.total = total;
      if (!results?.length) break;

      for (const summary of results) {
        if (seenIds.has(summary.id)) continue;
        seenIds.add(summary.id);
        progress.seen = seenIds.size;

        const res = await fetch(`/api/v3/search/listings/${summary.id}/`);
        if (res.ok) {
          const detail = await res.json();
          // Search results carry the upcoming open assignments; detail carries history.
          const byId = new Map((detail.assignments ?? []).map((a) => [a.id, a]));
          for (const a of summary.assignments ?? []) byId.set(a.id, { ...byId.get(a.id), ...a });
          buffer.push({ ...detail, animals: summary.animals, assignments: [...byId.values()] });
        } else {
          progress.errors.push({ id: summary.id, error: `detail ${res.status}` });
        }
        if (buffer.length >= batchSize) await flush();
        await sleep(delayMs);
      }
      if (seenIds.size >= total) break;
    }
    await flush();
    progress.run = (await ingest({ action: "finish", runId })).run;
    progress.state = "done";
  } catch (err) {
    progress.state = "failed";
    progress.error = String(err);
    await ingest({ action: "finish", runId, error: String(err) }).catch(() => {});
  }
  return progress;
}
