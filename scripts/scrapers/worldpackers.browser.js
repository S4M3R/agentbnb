// Browser-side scraper for Worldpackers.
//
// Evaluate in a tab on https://www.worldpackers.com (accept the US visa notice
// once on any US position page first, it sets a cookie), then call:
//
//   agentbnbScrapeWorldpackers()
//
// Walks the state search pages, fetches each position page, and downloads one
// `worldpackers-<market>-<timestamp>.json` file. Load it with
// `pnpm ingest <file>`. Progress is exposed on window.__agentbnbProgress.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function agentbnbScrapeWorldpackers({
  market = "sf-bay-area",
  listPath = "/search/north_america/united_states/state_california",
  delayMs = 600,
  maxPages = 30,
  limit = Infinity,
  download = true,
} = {}) {
  const progress = (window.__agentbnbProgress = { state: "running", pages: 0, seen: 0, errors: [] });
  const startedAt = new Date().toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => (s ?? "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const getDoc = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const html = await res.text();
    return { html, doc: new DOMParser().parseFromString(html, "text/html") };
  };

  const sectionBox = (doc, title) => {
    const h = [...doc.querySelectorAll("h2, h3, h4")].find((x) => clean(x.textContent) === title);
    if (!h) return null;
    let box = h.parentElement;
    while (box?.parentElement && box.parentElement.querySelectorAll("h2, h3, h4").length === 1) box = box.parentElement;
    return box;
  };

  // "What you offer" / "What you get" tiles: <div class="listing_item"><dl><dt>Title</dt>...
  const itemTitles = (box) =>
    box ? [...box.querySelectorAll(".listing_item dt")].map((dt) => clean(dt.textContent)).filter(Boolean) : [];

  const scrapePosition = async (path) => {
    const url = new URL(path, location.origin).href;
    const id = path.match(/\/positions\/(\d+)/)[1];
    const { html, doc } = await getDoc(url);
    const title = clean(doc.querySelector("h1")?.textContent);
    if (/Planning to visit/i.test(title)) throw new Error("visa notice not accepted; click 'I understand' once");

    const ld = [...doc.querySelectorAll('script[type="application/ld+json"]')]
      .map((s) => {
        try {
          return JSON.parse(s.textContent);
        } catch {
          return null;
        }
      })
      .find((j) => j?.["@type"] === "JobPosting");
    const center = html.match(/center=(-?\d+\.\d+),(-?\d+\.\d+)/);

    doc.querySelectorAll("script, style, noscript").forEach((n) => n.remove());
    const text = doc.body.innerText ?? doc.body.textContent;

    const availBox = sectionBox(doc, "Availability");
    const now = new Date();
    const months = availBox
      ? [...availBox.querySelectorAll(".month_availability")].map((el) => {
          const m = MONTHS.indexOf(clean(el.textContent).slice(0, 3)) + 1;
          const status = el.className.match(/(partially_available|probably_available|unavailable|available)/)?.[1] ?? "unknown";
          // Months are listed from the current month forward.
          const year = m >= now.getMonth() + 1 ? now.getFullYear() : now.getFullYear() + 1;
          return { year, month: m, status };
        })
      : [];
    const dl = (label) =>
      clean(
        [...doc.querySelectorAll("dt")].find((dt) => clean(dt.textContent) === label)?.nextElementSibling?.textContent,
      ) || null;

    const offerBox = sectionBox(doc, "What you offer");
    const getBox = sectionBox(doc, "What you get");
    const reqBox = sectionBox(doc, "Requirements");
    const rating = text.match(/(\d\.\d)\s*\((\d+) reviews?\)/);

    const photos = [
      ...new Set(
        [...doc.querySelectorAll("img")]
          .map((i) => i.getAttribute("src") || i.getAttribute("data-src") || "")
          .filter((s) => s.includes("volunteer_positions/photos"))
          .map((s) => s.replace(/\/(thumb|medium|small|large)\//, "/main/")),
      ),
    ];

    return {
      id,
      url,
      title,
      hostType: ld?.industry ?? null,
      city: ld?.jobLocation?.address?.addressLocality ?? null,
      region: ld?.jobLocation?.address?.addressRegion ?? null,
      country: ld?.jobLocation?.address?.addressCountry ?? null,
      lat: center ? Number(center[1]) : null,
      lng: center ? Number(center[2]) : null,
      description: ld?.description ?? clean(sectionBox(doc, "The Experience")?.innerText),
      workHours: ld?.workHours ?? null,
      offer: itemTitles(offerBox),
      offerText: clean(offerBox?.innerText).slice(0, 3000),
      get: itemTitles(getBox),
      getText: clean(getBox?.innerText).slice(0, 3000),
      requirements: clean(reqBox?.innerText).replace(/^Requirements\s*/, "").split("\n").filter(Boolean),
      minStay: dl("Stay at least"),
      maxStay: dl("Stay up to"),
      months,
      rating: rating ? Number(rating[1]) : null,
      reviews: rating ? Number(rating[2]) : null,
      photos: photos.length ? photos : ld?.image ? [ld.image] : [],
    };
  };

  const items = [];
  try {
    const paths = [];
    for (let page = 1; page <= maxPages; page++) {
      const { doc } = await getDoc(page === 1 ? listPath : `${listPath}?page=${page}`);
      const found = [...new Set([...doc.querySelectorAll('a[href^="/positions/"]')].map((a) => a.getAttribute("href")))]
        .filter((h) => /^\/positions\/\d+$/.test(h))
        .filter((h) => !paths.includes(h));
      progress.pages = page;
      if (!found.length) break;
      paths.push(...found);
      await sleep(delayMs);
    }
    progress.total = paths.length;

    for (const path of paths.slice(0, limit)) {
      try {
        items.push(await scrapePosition(path));
      } catch (err) {
        progress.errors.push({ path, error: String(err) });
      }
      progress.seen++;
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
  const file = { source: "worldpackers", market, startedAt, finishedAt: new Date().toISOString(), complete, items };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
  a.download = `worldpackers-${market}-${startedAt.replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  progress.file = a.download;
  return progress;
}
