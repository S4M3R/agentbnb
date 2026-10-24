// Browser-side scraper for HomeLink.
//
// Evaluate in a tab on https://homelink.org (the logged-out /en/search/ page
// uses the same api.homelink.org endpoints), then call:
//
//   agentbnbScrapeHomeLink()
//
// Searches listings inside the market bbox (sorted newest-first so pages are
// stable), then fetches each listing's public detail. The API returns far more
// member data than the page shows (email, phone, street address, last name,
// membership dates...): this scraper keeps an explicit whitelist and never
// writes those fields to the file. Coordinates are rounded to ~1km.
// Downloads one `homelink-<market>-<timestamp>.json`; load it with
// `pnpm ingest <file>`. Progress is on window.__agentbnbProgress.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function agentbnbScrapeHomeLink({
  market = "sf-bay-area",
  bounds = { north: 38.35, south: 36.95, east: -121.55, west: -123.1 },
  delayMs = 600,
  maxPages = 30,
  limit = Infinity,
} = {}) {
  const progress = (window.__agentbnbProgress = { state: "running", pages: 0, seen: 0, details: 0, errors: [] });
  const startedAt = new Date().toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const round = (n) => (n == null || n === "" || isNaN(Number(n)) ? null : Math.round(Number(n) * 100) / 100);
  const API = "https://api.homelink.org";

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

  const search = (page) =>
    request(`${API}/member/search-listing/?page=${page}&page_size=36`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        page,
        sort_type: 2, // newest offers first
        search: "",
        exclude_open_to_anywhere: false,
        home_location: { latitude: null, longitude: null, country: "", continent: "" },
        destination_location: {
          address: "San Francisco Bay Area, California, United States",
          latitude: (bounds.north + bounds.south) / 2,
          longitude: (bounds.east + bounds.west) / 2,
          country: "US",
          continent: "North America",
          bbox: [bounds.west, bounds.south, bounds.east, bounds.north],
          place_type: "region",
        },
        start_date: null,
        end_date: null,
        filter: {
          is_main_residence: [],
          type: [],
          amenities: [],
          entertainment: [],
          extras: [],
          home_exchange_type: [],
          personal_car: 0,
          settings: [],
          transports: [],
          outdoor: [],
          services: [],
          leisures: [],
          culturals: [],
        },
      }),
    });

  // Names of the flags that are set (value 1/true) in a HomeLink feature object.
  const flags = (obj) =>
    obj && typeof obj === "object"
      ? Object.entries(obj)
          .filter(([k, v]) => k !== "id" && !k.includes("none_criterias") && (v === 1 || v === true))
          .map(([k]) => k.replace(/^(has|is)_/, ""))
      : [];

  const pick = (summary, detail) => {
    const d = detail ?? {};
    const u = summary.user ?? {};
    return {
      id: summary.id,
      title: d.title ?? summary.title ?? null,
      type: d.type ?? summary.type ?? summary.h?.type ?? null,
      isMainResidence: d.is_main_residence ?? summary.h?.is_main_residence ?? null,
      city: summary.city ?? null,
      state: summary.state ?? null,
      country: summary.country?.name ?? null,
      countryCode: d.country?.countrycode ?? null,
      lat: round(summary.latitude),
      lng: round(summary.longitude),
      sleeps: summary.sleepsnumber ?? null,
      bedrooms: summary.bedroomsnumber ?? null,
      bathrooms: summary.bathroomsnumber ?? null,
      carExchange: summary.car_exchange ?? null,
      photos: (d.h?.photos ?? summary.h?.photos ?? []).map((p) => ({ url: p.url, caption: p.caption || null })),
      description: d.house_description ?? null,
      rules: d.ad_description ?? null,
      neighborhood: d.neighborhood?.description ?? null,
      attractions: d.attraction?.description ?? null,
      amenities: [...flags(d.amenities), ...flags(d.extras), ...flags(d.entertainment)],
      settings: flags(d.settings),
      nearby: [
        ...flags(d.neighborhood?.outdoor),
        ...flags(d.neighborhood?.services),
        ...flags(d.neighborhood?.transports),
        ...(d.neighborhood?.leisures_and_culturals ?? []).flatMap((x) => (x.fields ?? []).map((f) => f.replace(/^has_/, ""))),
      ],
      childrenAllowed: d.is_children_allowed ?? null,
      smokingAllowed: d.is_smoking_allowed ?? null,
      petsAllowed: d.is_pets_allowed ?? null,
      petFreeHome: d.is_pet_free_home ?? null,
      petCareNeeded: d.is_pets_care_needed ?? null,
      plantCareNeeded: d.is_plants_care_needed ?? null,
      nonSimultaneous: d.is_non_simultaneous_exchange ?? null,
      longTerm: d.is_longterm_exchange ?? null,
      hospitalityOffered: d.is_hospitality_offered ?? null,
      homesitOffered: d.is_homesit_offered ?? null,
      homesitNeeded: d.is_homesit_needed ?? null,
      youthExchange: d.is_youth_exchange ?? null,
      listingCreatedAt: d.a?.creation_date ?? null,
      completion: d.listing_percentage ?? null,
      referenceCount: Array.isArray(d.feedback) ? d.feedback.length : null,
      user: {
        id: u.id ?? null,
        firstName: u.firstname ?? null,
        avatarUrl: u.profile_pic_url ?? null,
        languages: u.user_languages ?? [],
        responseRate: u.response_rate ?? null,
        exchanges: u.exchange_number ?? null,
        verified: u.is_verified ?? null,
      },
      // When the member wants to travel = when their home is free to swap.
      travelPlans: (u.date_and_destination ?? []).map((t) => ({
        id: t.id,
        startDate: t.start_date ?? null,
        endDate: t.end_date ?? null,
        anyDates: Boolean(t.is_open_to_all_dates),
        anyDestination: Boolean(t.is_open_to_all_destinations),
        destinations: [t.place_1, t.place_2, t.place_3].filter(Boolean),
      })),
    };
  };

  const items = [];
  try {
    const summaries = new Map();
    let total = null;
    for (let page = 1; page <= maxPages && summaries.size < limit; page++) {
      const res = await search(page);
      progress.pages = page;
      total = progress.total = res?.count ?? total;
      if (!res?.results?.length) break;
      for (const s of res.results) if (summaries.size < limit) summaries.set(s.id, s);
      progress.seen = summaries.size;
      if (!res.next) break;
      await sleep(delayMs);
    }

    for (const s of summaries.values()) {
      const detail = await request(`${API}/member/listing/${s.id}/?q=en`).catch((err) => {
        progress.errors.push({ id: s.id, error: String(err) });
        return null;
      });
      items.push(pick(s, detail));
      progress.details++;
      await sleep(delayMs);
    }
    progress.state = "done";
  } catch (err) {
    progress.state = "failed";
    progress.error = String(err);
  }

  const complete =
    progress.state === "done" && limit === Infinity && !progress.errors.length && items.length >= (progress.total ?? Infinity);
  const file = { source: "homelink", market, startedAt, finishedAt: new Date().toISOString(), complete, items };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
  a.download = `homelink-${market}-${startedAt.replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  progress.file = a.download;
  progress.items = items.length;
  return progress;
}
