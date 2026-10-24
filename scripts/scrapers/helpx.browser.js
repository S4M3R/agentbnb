// Browser-side scraper for HelpX.
//
// Evaluate in a tab on https://www.helpx.net, then call:
//
//   agentbnbScrapeHelpx()
//
// HelpX is an Angular app backed by a public JSON API on api.helpx.net (CORS
// allows www.helpx.net). Pages through POST /client/listings filtered to
// United States > California, fetches each host via GET
// /client/listingbyalias/<friendlyUrl>, and downloads one
// `helpx-<market>-<timestamp>.json` file. Load it with `pnpm ingest <file>`.
// Progress is exposed on window.__agentbnbProgress.
//
// Public data has no coordinates (the map endpoint needs login), only city.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function agentbnbScrapeHelpx({
  market = "sf-bay-area",
  geographicRegionId = 6, // North America
  countryId = 210, // United States
  regionIds = [260], // California
  delayMs = 600,
  maxPages = 20,
  limit = Infinity,
} = {}) {
  const API = "https://api.helpx.net/client";
  const progress = (window.__agentbnbProgress = {
    state: "running",
    pages: 0,
    seen: 0,
    errors: [],
  });
  const startedAt = new Date().toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const getJson = async (url, body) => {
    const res = await fetch(
      url,
      body
        ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : undefined,
    );
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
  };

  // Keep only what the adapter needs; drop contact fields and other members' data.
  const pickDetail = (d) => ({
    id: d.id,
    listingNumber: d.listingNumber,
    applicationUserId: d.applicationUserId,
    friendlyUrl: d.friendlyUrl,
    listingName: d.listingName,
    listingTypeName: d.listingTypeName,
    countryName: d.countryName,
    regionName: d.regionName,
    city: d.address?.city ?? null,
    suburb: d.address?.suburb ?? null,
    latitude: d.address?.latitude ?? null,
    longitude: d.address?.longitude ?? null,
    listingDescription: d.listingDescription,
    listingAccommodation: d.listingAccommodation,
    allYear: d.allYear,
    exchangeType: d.exchangeType,
    contributionAmount: d.contributionAmount,
    landArea: d.landArea,
    landAreaNumber: d.landAreaNumber,
    landAreaUnit: d.landAreaUnit,
    organicStatus: d.organicStatus,
    isOrganic: d.isOrganic,
    educationOffered: d.educationOffered,
    remoteTeachers: d.remoteTeachers,
    isPremium: d.isPremium,
    approvedOn: d.approvedOn,
    createdOn: d.createdOn,
    lastUpdated: d.lastUpdated,
    lastLogin: d.lastLogin,
    reviewsReceived: d.reviewsReceived,
    averageRating: d.averageRating,
    images: (d.images ?? []).map((i) => ({ small: i.small, medium: i.medium, big: i.big })),
    facilities: (d.listingFacilities ?? []).map((f) => f.name),
    culturals: (d.listingCulturals ?? []).map((f) => f.name),
    languages: (d.listingLanguages ?? []).map((l) => l?.name ?? l),
    videos: (d.videos ?? []).length,
  });

  const items = [];
  try {
    const summaries = [];
    const seenIds = new Set();
    for (let page = 1; page <= maxPages; page++) {
      const res = await getJson(`${API}/listings`, {
        searchType: "3",
        geographicRegionId,
        countryId,
        regionIds,
        listingTypeIds: [],
        page: String(page),
        textSearch: "",
        citySearch: "",
        gridDisplay: false,
        advancedOptions: [], // [1] would restrict to "With Photo"
        orderByLastUpdate: "true",
        lastNDays: "0",
        facilities: [],
      });
      const fresh = (res.searchResults ?? []).filter((r) => !seenIds.has(r.listingId));
      progress.pages = page;
      if (page === 1) progress.reported = res.totalNumberOfItems;
      if (!fresh.length) break;
      fresh.forEach((r) => seenIds.add(r.listingId));
      summaries.push(...fresh);
      if (!res.hasMore) break;
      await sleep(delayMs);
    }
    progress.total = summaries.length;

    for (const s of summaries.slice(0, limit)) {
      try {
        let detail = await getJson(`${API}/listingbyalias/${encodeURIComponent(s.friendlyUrl)}`);
        // Some hosts return an empty detail (id 0); fall back to the list row.
        if (!detail?.id) {
          progress.emptyDetails = (progress.emptyDetails ?? 0) + 1;
          detail = { ...s, id: s.listingId, images: s.mainImageUrl ? [{ big: s.mainImageUrl }] : [] };
        }
        items.push({
          ...pickDetail(detail),
          url: `https://www.helpx.net/host/${s.friendlyUrl}`,
          // The list row has city/lat/lng even when the detail address is sparse.
          city: detail.address?.city ?? s.city ?? null,
          suburb: detail.address?.suburb ?? s.suburb ?? null,
          latitude: detail.address?.latitude ?? s.latitude ?? null,
          longitude: detail.address?.longitude ?? s.longitude ?? null,
          mainImageUrl: s.mainImageUrl ?? null,
        });
      } catch (err) {
        progress.errors.push({ id: s.friendlyUrl, error: String(err) });
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
  const complete = progress.state === "done" && limit === Infinity && progress.errors.length === 0;
  const file = { source: "helpx", market, startedAt, finishedAt: new Date().toISOString(), complete, items };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
  a.download = `helpx-${market}-${startedAt.replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  progress.file = a.download;
  progress.items = items.length;
  return progress;
}
