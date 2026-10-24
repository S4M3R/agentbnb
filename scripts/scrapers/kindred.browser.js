// Browser-side scraper for Kindred.
//
// Evaluate in a tab on https://livekindred.com (it uses the public GraphQL
// queries that the logged-out /browse pages use), then call:
//
//   agentbnbScrapeKindred()
//
// Kindred's public search is destination-based, so this lists California
// destinations (`searchDestinations`), keeps those whose centroid is inside the
// market bounds, and pages `searchHomesPublic` for each one. Logged-out search
// stops at a few pages per destination (the API clamps `page`), so big cities
// are capped; the run is then marked incomplete. Homes overlap between
// city/county destinations and are de-duplicated by id. Coordinates are
// rounded to ~1km before saving. Downloads one `kindred-<market>-<timestamp>.json`;
// load it with `pnpm ingest <file>`. Progress is on window.__agentbnbProgress.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function agentbnbScrapeKindred({
  market = "sf-bay-area",
  bounds = { north: 38.35, south: 36.95, east: -121.55, west: -123.1 },
  region = "California",
  pageSize = 20,
  maxPages = 10,
  delayMs = 2000,
  limit = Infinity,
  photoWidth = 1200,
} = {}) {
  const progress = (window.__agentbnbProgress = { state: "running", destinations: 0, done: 0, seen: 0, capped: [], errors: [] });
  const startedAt = new Date().toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const round = (n) => (typeof n === "number" ? Math.round(n * 100) / 100 : null);
  const API = "https://app.livekindred.com/api/graphql";

  // Anonymous search is rate limited per IP ("Too many ip calls"): back off for
  // a minute or more on that, briefly on anything else.
  const gql = async (query, variables, tries = 6) => {
    for (let i = 1; ; i++) {
      try {
        const res = await fetch(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, variables }),
        });
        if (!res.ok) throw new Error(`graphql: ${res.status}`);
        const json = await res.json();
        if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
        return json.data;
      } catch (err) {
        if (i >= tries) throw err;
        const limited = /too many|429/i.test(String(err));
        progress.backoffs = (progress.backoffs ?? 0) + (limited ? 1 : 0);
        await sleep(limited ? 60000 * i : 1000 * 2 ** i);
      }
    }
  };

  const DESTINATIONS = `query ($s: DestinationSearchInput!, $p: Pagination) {
    searchDestinations(searchInput: $s, pagination: $p) { totalCount destinations { id name region lat lon } }
  }`;
  const HOMES = `query ($filter: FlexibleSearchFilter, $pagination: Pagination, $width: Int!) {
    searchHomesPublic(filter: $filter, pagination: $pagination) {
      page hasMore
      homes {
        id title
        destination { id name region }
        media { thumbnailUrl(width: $width) type description altText }
        availabilitiesWithoutBookedDates { id startDate endDate minimumNights }
        bedsCount bedroomsCount bathrooms workspacesCount maxGuestsLimit
        petPreference petHostingDetails isFamilyFriendly
        lat lon
        owner { id displayName hostResponseMetrics { responseRate tier } }
        amenityDetails { amenity category }
      }
    }
  }`;

  const homes = new Map();
  try {
    // 1. Destinations in the region whose centroid is inside the bounds.
    const dests = new Map();
    for (let page = 0; page < 10; page++) {
      const data = await gql(DESTINATIONS, { s: { query: region }, p: { page, pageSize: 500 } });
      const batch = data.searchDestinations.destinations;
      if (!batch.length) break;
      for (const d of batch) dests.set(d.id, d);
      await sleep(delayMs);
      if (batch.length < 500) break;
    }
    const inBounds = [...dests.values()].filter(
      (d) =>
        d.region === region &&
        d.lat != null &&
        d.lat <= bounds.north &&
        d.lat >= bounds.south &&
        d.lon <= bounds.east &&
        d.lon >= bounds.west,
    );
    progress.destinations = inBounds.length;

    // 2. Homes per destination.
    for (const dest of inBounds) {
      if (homes.size >= limit) break;
      for (let page = 0; page < maxPages; page++) {
        const data = await gql(HOMES, {
          filter: { destinationIds: [dest.id] },
          pagination: { page, pageSize },
          width: photoWidth,
        }).catch((err) => {
          progress.errors.push({ destination: dest.name, page, error: String(err) });
          return null;
        });
        await sleep(delayMs);
        const res = data?.searchHomesPublic;
        if (!res) break;
        // Logged out, the API clamps `page`; a repeated page means we hit the cap.
        if (res.page !== page) {
          progress.capped.push(dest.name);
          break;
        }
        for (const h of res.homes) {
          if (homes.size >= limit) break;
          if (!homes.has(h.id)) homes.set(h.id, { ...h, lat: round(h.lat), lon: round(h.lon) });
        }
        progress.seen = homes.size;
        if (!res.hasMore || !res.homes.length || homes.size >= limit) break;
        if (page === maxPages - 1) progress.capped.push(dest.name);
      }
      progress.done++;
    }
    progress.state = "done";
  } catch (err) {
    progress.state = "failed";
    progress.error = String(err);
  }

  const items = [...homes.values()];
  const complete =
    progress.state === "done" && limit === Infinity && !progress.errors.length && !progress.capped.length;
  const file = { source: "kindred", market, startedAt, finishedAt: new Date().toISOString(), complete, items };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
  a.download = `kindred-${market}-${startedAt.replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  progress.file = a.download;
  progress.items = items.length;
  return progress;
}
