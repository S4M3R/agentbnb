// Browser-side scraper for House Sitters America (https://www.housesittersamerica.com).
//
// Evaluate in a tab on https://www.housesittersamerica.com, then call:
//
//   agentbnbScrapeHSA()
//
// Uses the public state directory (/house-sitting-pet-sitting-jobs/browse/<state>,
// server-rendered, allowed by robots.txt unlike /search) to list every open sit in
// the state, then fetches each public job page: indicative map pin, dates, home,
// pets, payment, owner first name and review score (no review text). Downloads one
// `housesittersamerica-<market>-<timestamp>.json` file. Load it with
// `pnpm ingest <file>`. Progress is exposed on window.__agentbnbProgress.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function agentbnbScrapeHSA({
  market = "sf-bay-area",
  state = "california",
  delayMs = 700,
  maxPages = 20,
  limit = Infinity,
} = {}) {
  const progress = (window.__agentbnbProgress = { state: "running", pages: 0, seen: 0, errors: [] });
  const startedAt = new Date().toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = (el) => (el?.textContent ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
  const getDoc = async (path) => {
    const res = await fetch(path, { credentials: "omit" });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return new DOMParser().parseFromString(await res.text(), "text/html");
  };
  const jobId = (href) => href?.match(/\/house-sitting-pet-sitting-job\/(\d+)\//)?.[1] ?? null;

  // Only cards inside the main results list (not sidebars/carousels).
  const parseCards = (doc) =>
    [...doc.querySelectorAll(".search-list-results .search-listing")].map((card) => {
      const link = card.querySelector('h3 a[href*="/house-sitting-pet-sitting-job/"]');
      const icons = [...card.querySelectorAll(".icon-list li")].map((li) => ({
        icon: text(li.querySelector(".icon")),
        value: text(li).replace(text(li.querySelector(".icon")), "").trim(),
      }));
      return {
        id: jobId(link?.getAttribute("href")),
        url: link ? new URL(link.getAttribute("href"), location.href).href : null,
        cardDates: icons.find((i) => i.icon === "date_range")?.value ?? null,
        duration: icons.find((i) => i.icon === "schedule")?.value ?? null,
        homeType: icons.find((i) => i.icon === "cottage")?.value ?? null,
        pay: text(card.querySelector(".pay-info .label")) || null,
        tag: text(card.querySelector(".listing-tag")) || null,
        startsSoon: !!card.querySelector(".urgent"),
        pets: [...card.querySelectorAll(".listing-pets li")].map((li) => ({
          animal: li.querySelector("img")?.getAttribute("alt") ?? null,
          count: Number(text(li)) || null,
        })),
      };
    });

  const parseDetail = (doc, html) => {
    let ld = null;
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const j = JSON.parse(s.textContent);
        if (j["@type"] === "JobPosting") ld = j;
      } catch {
        /* ignore malformed blocks */
      }
    }
    const data = {};
    for (const pd of doc.querySelectorAll("#profile-layout .profile-data")) {
      const icon = text(pd.querySelector(".icon"));
      const label = text(pd.querySelector(".label")).replace(/:$/, "");
      const value = text(pd.querySelector(".data")) || text(pd.querySelector("p")) || text(pd.querySelector(".chip"));
      data[label || icon] = value;
    }
    const sections = {};
    for (const sec of doc.querySelectorAll("#profile-layout .profile-section")) {
      const h = text(sec.querySelector(":scope > h2, :scope > .heading-with-chip h2"));
      const desc = text(sec.querySelector(":scope > .profile-description"));
      if (h && desc) sections[h] = desc;
    }
    const pin = html.match(/google\.maps\.LatLng\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/);
    const ratings = [...doc.querySelectorAll("#reviews .review-header img[title]")]
      .map((img) => Number(img.getAttribute("title").match(/([\d.]+)/)?.[1]))
      .filter((n) => Number.isFinite(n));
    const trust = [...doc.querySelectorAll("#profile-layout .profile-feature .label")].map(text);
    const photos = [...doc.querySelectorAll(".profile-photo-thumbs .photo-thumbs a[href]")].map(
      (a) => new URL(a.getAttribute("href"), location.href).href,
    );
    const mainPhoto = doc
      .querySelector(".profile-photo .photo-link")
      ?.getAttribute("style")
      ?.match(/url\(([^)]+)\)/)?.[1];
    const heading = doc.querySelector("#profile-layout .combo-heading");
    return {
      ld,
      city: text(heading?.querySelector("h1")),
      area: text(heading?.querySelector("h3.sub-text")),
      title: text([...(heading?.querySelectorAll(":scope > h3") ?? [])].at(-1)),
      dates: data.date_range ?? null,
      locationPath: data.my_location ?? null, // "California - San Francisco Bay Area - San Francisco"
      payment: data.Payment ?? null,
      areaLove: data["What we love about our area"] ?? null,
      houseType: data["House type"] ?? null,
      features: data.Features ?? null,
      accessibility: data["Home accessibility"] ?? null,
      locale: data.Locale ?? null,
      nearby: data.Nearby ?? null,
      gardenCare: data["Garden or plant care"] ?? null,
      guestsWelcome: data["Guests welcome"] ?? null,
      petsWelcome: data["Pets welcome"] ?? null,
      smoking: data["Smoking/vaping permitted"] ?? null,
      home: sections["Our home"] ?? null,
      petsDescription: sections["Our pets"] ?? null,
      gardenDescription: sections["Our garden"] ?? null,
      petChips: [...doc.querySelectorAll(".pet-chips .pet-chip .label")].map(text),
      owner: text(doc.querySelector(".profile-names p")).replace(/^\S*\s*Owner:\s*/i, "").replace(/^person\s*/i, "") || null,
      memberSince: trust.find((t) => /^Member since/i.test(t))?.replace(/^Member since\s*/i, "") ?? null,
      replyRating: Number(doc.querySelector('img[alt^="Reply Rating"]')?.getAttribute("alt").match(/(\d+)/)?.[1]) || null,
      reviewCount: ratings.length,
      reviewAverage: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
      lat: pin ? Number(pin[1]) : null,
      lng: pin ? Number(pin[2]) : null,
      photos: photos.length ? photos : mainPhoto ? [new URL(mainPhoto, location.href).href] : [],
    };
  };

  const items = [];
  try {
    const cards = new Map();
    let path = `/house-sitting-pet-sitting-jobs/browse/${state}`;
    for (let page = 1; path && page <= maxPages; page++) {
      const doc = await getDoc(path);
      progress.pages = page;
      let added = 0;
      for (const c of parseCards(doc)) {
        if (c.id && !cards.has(c.id)) {
          cards.set(c.id, c);
          added++;
        }
      }
      // The directory currently fits on one page; follow a "next" link if one appears.
      const next = doc.querySelector('a[rel="next"], .pagination a.next, a[href*="page="][aria-label*="ext"]');
      path = added && next ? next.getAttribute("href") : null;
      if (path) await sleep(delayMs);
    }
    const wanted = [...cards.values()].slice(0, limit);
    progress.total = wanted.length;

    for (const card of wanted) {
      progress.seen++;
      try {
        await sleep(delayMs);
        const res = await fetch(card.url, { credentials: "omit" });
        if (!res.ok) throw new Error(`detail ${res.status}`);
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        items.push({ ...card, ...parseDetail(doc, html) });
      } catch (err) {
        progress.errors.push({ id: card.id, error: String(err) });
      }
    }
    progress.state = "done";
  } catch (err) {
    progress.state = "failed";
    progress.error = String(err);
  }

  // A partial scrape must not mark unseen listings as gone.
  const complete = progress.state === "done" && limit === Infinity && !progress.errors.length;
  const file = { source: "housesittersamerica", market, startedAt, finishedAt: new Date().toISOString(), complete, items };
  window.__agentbnbLastFile = file;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
  a.download = `housesittersamerica-${market}-${startedAt.replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  progress.file = a.download;
  progress.items = items.length;
  return progress;
}
