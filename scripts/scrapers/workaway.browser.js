// Browser-side scraper for Workaway.
//
// Evaluate in a tab on https://www.workaway.info, then call:
//
//   agentbnbScrapeWorkaway()
//
// Walks the regional host list, opens each host page (same-origin fetch),
// extracts sections/photos/calendar/coordinates, and downloads one
// `workaway-<market>-<timestamp>.json` file. Load it with
// `pnpm ingest <file>`. Progress is exposed on window.__agentbnbProgress.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function agentbnbScrapeWorkaway({
  market = "sf-bay-area",
  listPath = "/en/hostlist/northamerica/us?region=california",
  region = "California",
  delayMs = 600,
  maxPages = 20,
  limit = Infinity,
} = {}) {
  const progress = (window.__agentbnbProgress = {
    state: "running",
    pages: 0,
    seen: 0,
    posted: 0,
    errors: [],
  });
  const startedAt = new Date().toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const clean = (s) => (s ?? "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

  const getDoc = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("style, script, noscript").forEach((n) => n.remove());
    return { html, doc };
  };

  const parseCalendar = (root, fallbackYear) => {
    const out = [];
    root.querySelectorAll(".hostcalmonthinner").forEach((cell) => {
      const m = cell.className.match(/dt(\d{4})(\w{3})/);
      const status = cell.innerHTML.match(/calendar_(green|yellow|red)/)?.[1];
      if (m && status) out.push({ year: Number(m[1]) || fallbackYear, month: MONTHS.indexOf(m[2]) + 1, status });
    });
    return out;
  };

  const sectionsOf = (doc) => {
    const out = {};
    for (const h of doc.querySelectorAll("h2, h3, h4")) {
      const key = clean(h.textContent);
      if (!key || out[key] !== undefined) continue;
      let box = h.parentElement;
      while (box?.parentElement && box.parentElement.querySelectorAll("h2, h3, h4").length === 1) {
        box = box.parentElement;
      }
      if (!box) continue;
      out[key] = clean(box.innerText ?? box.textContent).replace(key, "").trim().slice(0, 5000);
    }
    return out;
  };

  const scrapeHost = async (path) => {
    const url = new URL(path, location.origin).href;
    const id = path.split("/").pop();
    const { html, doc } = await getDoc(url);

    const center = html.match(/centerData = Object\.assign\(\{\}, \{"lat":"(-?[\d.]+)","lng":"(-?[\d.]+)"/);
    const sections = sectionsOf(doc);
    const pct = (v) => (v ? Number.parseFloat(v.replace(",", ".")) : null);

    const photos = [];
    const seen = new Set();
    for (const img of doc.querySelectorAll("img")) {
      const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
      if (!src.includes(`/gfx/foto/`) || !src.includes(id)) continue;
      const xl = src.replace("/thumb/", "/xl/");
      if (seen.has(xl)) continue;
      seen.add(xl);
      photos.push({ url: xl, caption: img.getAttribute("alt") || null });
    }

    const year = new Date().getFullYear();
    const calendar = parseCalendar(doc, year);
    try {
      const next = await getDoc(`/report_request.php?call=getHostCalendar&id=${id}&readonly=1&y=${year + 1}`);
      calendar.push(...parseCalendar(next.doc, year + 1));
    } catch {
      // next year's calendar is optional
    }

    return {
      id,
      url,
      title: clean(doc.querySelector("h1")?.textContent),
      lat: center ? Number(center[1]) : null,
      lng: center ? Number(center[2]) : null,
      region,
      sections,
      photos,
      stats: {
        hostRating: pct(sections["Host rating"]),
        replyRate: pct(sections["Reply rate"]),
        feedbackCount: sections["Feedback"] ? Number.parseInt(sections["Feedback"], 10) : null,
        lastReplied: sections["Last replied"] || null,
        idVerified: "ID verified" in sections,
      },
      minStay: html.match(/Min stay requested:<\/strong>(?:&nbsp;|\s)*([^<]+)/)?.[1]?.trim() ?? null,
      calendar,
    };
  };

  const items = [];
  try {
    const hostPaths = [];
    for (let page = 1; page <= maxPages; page++) {
      const sep = listPath.includes("?") ? "&" : "?";
      const { doc } = await getDoc(page === 1 ? listPath : `${listPath}${sep}Page=${page}`);
      // Only the main results list; carousels on the page rotate random hosts.
      const links = doc.querySelectorAll('#listentry-wrapper a.listentry-title[href^="/en/host/"]');
      const paths = [...new Set([...links].map((a) => a.getAttribute("href")))]
        .filter((h) => /^\/en\/host\/\w+$/.test(h))
        .filter((h) => !hostPaths.includes(h));
      progress.pages = page;
      if (!paths.length) break;
      hostPaths.push(...paths);
      await sleep(delayMs);
    }
    progress.total = hostPaths.length;

    for (const path of hostPaths.slice(0, limit)) {
      try {
        items.push(await scrapeHost(path));
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

  // A partial scrape must not mark unseen listings as gone.
  const complete = progress.state === "done" && limit === Infinity;
  const file = { source: "workaway", market, startedAt, finishedAt: new Date().toISOString(), complete, items };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
  a.download = `workaway-${market}-${startedAt.replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  progress.file = a.download;
  progress.items = items.length;
  return progress;
}
