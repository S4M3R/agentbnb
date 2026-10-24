// Browser-side scraper for WWOOF-USA (https://wwoofusa.org).
//
// Evaluate in a tab on https://wwoofusa.org/en/hosts, then call:
//
//   agentbnbScrapeWwoofUsa()
//
// The public host map is backed by an anonymous JSON API (api.wwoof.net):
//   GET /api/host-coordinates?domainId=US&regionIds=<state>  -> GeoJSON of host ids
//   GET /api/hosts/<id>                                      -> { host, address, photos }
// No login is needed for either. We keep only what the public host page shows:
// title, description, activities/lodging/diets, opening months, photos. The
// API's exact address coordinates are rounded to ~1 km before they leave the
// browser, and user ids / photo captions are dropped.
//
// Downloads one `wwoof-usa-<market>-<timestamp>.json` file. Load it with
// `pnpm ingest <file>`. Progress is exposed on window.__agentbnbProgress.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function agentbnbScrapeWwoofUsa({
  market = "sf-bay-area",
  regionIds = [23204], // California
  delayMs = 600,
  limit = Infinity,
} = {}) {
  const progress = (window.__agentbnbProgress = { state: "running", seen: 0, errors: [] });
  const startedAt = new Date().toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const API = "https://api.wwoof.net/api";
  const round = (n, d = 2) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

  const getJson = async (url) => {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
  };

  const items = [];
  try {
    const { regions } = await getJson(`${API}/regions?countryId=232`);
    const regionName = new Map(regions.map((r) => [r.id, r.name]));

    const params = new URLSearchParams({
      domainId: "US",
      limit: "5000",
      regionIds: regionIds.join(","),
      suspended: "no",
      hidden: "no",
      membershipStatus: "active",
      approvalStatus: "approved",
    });
    const map = await getJson(`${API}/host-coordinates?${params}`);
    const ids = [...new Set(map.features.map((f) => f.properties.hostId))];
    progress.total = ids.length;
    await sleep(delayMs);

    for (const id of ids.slice(0, limit)) {
      try {
        const { host: h, address, photos } = await getJson(`${API}/hosts/${id}`);
        if (h.isHidden) continue;
        const [lng, lat] = address?.coordinates?.coordinates ?? [null, null];
        items.push({
          id: String(h.id),
          url: `https://wwoofusa.org/en/host/${h.slug ?? h.id}`,
          title: h.shortDescription,
          description: h.fullDescription,
          travelDetails: h.travelDetails,
          region: regionName.get(address?.regionId) ?? null,
          lat: round(lat),
          lng: round(lng),
          activities: h.activities ?? [],
          methodologies: h.methodologies ?? [],
          openingMonths: h.openingMonths ?? [],
          stays: h.stays ?? [],
          lodgings: h.lodgings ?? [],
          diets: h.diets ?? [],
          tags: h.tags ?? [],
          languages: h.languages ?? [],
          isCertifiedOrganic: h.isCertifiedOrganic ?? null,
          capacity: h.capacity ?? null,
          childrenOk: h.childrenOk ?? null,
          petsOk: h.petsOk ?? null,
          isVerified: h.isVerified ?? null,
          hostType: h.type ?? null,
          areaInHectares: h.areaInHectares ?? null,
          immediateAvailabilityExpireAt: h.immediateAvailabilityExpireAt ?? null,
          reviewCount: h.reviewCount ?? null,
          createdAt: h.createdAt ?? null,
          updatedAt: h.updatedAt ?? null,
          photos: (photos ?? []).map((p) => ({
            id: p.id,
            url: p.urls?.original?.large ?? p.urls?.original?.medium ?? null,
            isThumbnail: !!p.isThumbnail,
          })),
        });
      } catch (err) {
        progress.errors.push({ id, error: String(err) });
      }
      progress.seen++;
      await sleep(delayMs);
    }
    progress.state = "done";
  } catch (err) {
    progress.state = "failed";
    progress.error = String(err);
  }

  // A partial scrape must not mark unseen listings as gone.
  const complete = progress.state === "done" && limit === Infinity && !progress.errors.length;
  const file = { source: "wwoof-usa", market, startedAt, finishedAt: new Date().toISOString(), complete, items };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
  a.download = `wwoof-usa-${market}-${startedAt.replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  progress.file = a.download;
  progress.items = items.length;
  return progress;
}
