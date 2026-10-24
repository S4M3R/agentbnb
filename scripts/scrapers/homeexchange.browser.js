// Browser-side scraper for HomeExchange.
//
// Evaluate in a tab on https://www.homeexchange.com (the public search page
// calls the same endpoints logged out), then call:
//
//   agentbnbScrapeHomeExchange()
//
// Pages through the public map search (bff.homeexchange.com/search/homes)
// inside the market bounds, sorted by "newest" so pages don't overlap, then
// fetches each home's public detail (api.homeexchange.com/v1/homes/:id) for
// the description and room counts. Homes whose detail 404s keep the search
// summary. The calendar endpoint needs a login, so availability isn't
// collected. Coordinates are rounded to ~1km before saving. Downloads one
// `homeexchange-<market>-<timestamp>.json`; load it with `pnpm ingest <file>`.
// Progress is exposed on window.__agentbnbProgress.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function agentbnbScrapeHomeExchange({
  market = "sf-bay-area",
  bounds = { north: 38.35, south: 36.95, east: -121.55, west: -123.1 },
  pageSize = 100,
  delayMs = 600,
  maxPages = 50,
  limit = Infinity,
  details = true,
} = {}) {
  const progress = (window.__agentbnbProgress = { state: "running", pages: 0, seen: 0, details: 0, errors: [] });
  const startedAt = new Date().toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const round = (n) => (typeof n === "number" ? Math.round(n * 100) / 100 : null);

  const request = async (url, init, tries = 4) => {
    for (let i = 1; ; i++) {
      try {
        const res = await fetch(url, init);
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        return await res.json();
      } catch (err) {
        if (i >= tries) throw err;
        await sleep(1000 * 2 ** i);
      }
    }
  };

  const search = (offset) =>
    request(`https://bff.homeexchange.com/search/homes?offset=${offset}&limit=${pageSize}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-SEARCH-API-VERSION": "v2", "X-LEGACY-RESPONSE": "true" },
      body: JSON.stringify({
        search_query: {
          location: {
            bounds: { sw: { lat: bounds.south, lon: bounds.west }, ne: { lat: bounds.north, lon: bounds.east } },
          },
          // Default "relevance" order reshuffles between requests.
          sort: { type: "newest" },
        },
      }),
    });

  const items = [];
  try {
    const summaries = new Map();
    for (let page = 0; page < maxPages && summaries.size < limit; page++) {
      const res = await search(page * pageSize);
      progress.pages = page + 1;
      progress.total = res?.total;
      if (!res?.homes?.length) break;
      for (const h of res.homes) if (summaries.size < limit) summaries.set(h.id, h);
      progress.seen = summaries.size;
      if (summaries.size >= res.total) break;
      await sleep(delayMs);
    }

    for (const h of summaries.values()) {
      let detail = null;
      if (details) {
        detail = await request(`https://api.homeexchange.com/v1/homes/${h.id}`).catch((err) => {
          progress.errors.push({ id: h.id, error: String(err) });
          return null;
        });
        await sleep(delayMs);
      }
      progress.details++;
      const d = detail ?? {};
      const desc = (d.descriptions ?? []).find((x) => x.locale === "en") ?? d.descriptions?.[0] ?? null;
      items.push({
        id: h.id,
        title: desc?.title ?? h.descriptions?.[0]?.title ?? null,
        description: desc?.good_feature ?? null,
        aboutNeighborhood: desc?.good_place ?? null,
        otherInfo: desc?.other ?? null,
        isPrivateRoom: h.is_private_room ?? null,
        sharedPart: d.shared_part ?? null,
        homeType: d.type ?? null,
        residenceType: d.detail?.residence_type ?? null,
        capacity: h.capacity ?? d.capacity ?? null,
        minNights: h.min_nights ?? d.min_nights ?? null,
        guestPointsPerNight: h.guestpoint_per_night ?? d.guestpoint ?? null,
        exchangeCount: h.exchange_count ?? null,
        isVerified: Boolean(h.is_verified),
        isCollection: h.is_collection ?? null,
        prefersReciprocal: d.prefers_reciprocal ?? null,
        globalRating: d.global_rating ?? null,
        size: d.detail ?? null,
        features: d.feature ?? null,
        // Search coordinates rounded to ~1km: don't keep a pinpoint home location.
        lat: round(h.location?.latitude),
        lng: round(h.location?.longitude),
        admins: h.translated_admins ?? null,
        user: h.user
          ? {
              id: h.user.id,
              firstName: h.user.first_name ?? null,
              avatarUrl: h.user.images?.[0]?.link ?? null,
              responseRate: h.user.response_rate ?? null,
              isVerified: h.user.is_verified ?? null,
              exchanges: d.user?.number_exchange ?? null,
              rating: d.user?.global_rating ?? null,
            }
          : null,
        images: (d.images?.length ? d.images.map((i) => i.cdn_link) : (h.images ?? []).map((i) => i.link)).filter(Boolean),
        hasDetail: Boolean(detail),
      });
    }
    progress.state = "done";
  } catch (err) {
    progress.state = "failed";
    progress.error = String(err);
  }

  // A partial scrape must not mark unseen listings as gone.
  const complete = progress.state === "done" && limit === Infinity && items.length >= (progress.total ?? Infinity);
  const file = { source: "homeexchange", market, startedAt, finishedAt: new Date().toISOString(), complete, items };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
  a.download = `homeexchange-${market}-${startedAt.replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  progress.file = a.download;
  progress.items = items.length;
  return progress;
}
