// Browser-side scraper for HouseCarers (https://www.housecarers.com).
//
// Evaluate in a tab on https://www.housecarers.com, then call:
//
//   agentbnbScrapeHouseCarers()
//
// HouseCarers' search is members-only, but the public "Housesit List"
// (advanced-search-results-housesit3.cfm) lists every active sit worldwide
// in one table, and homeowner profile pages are public. There is no public
// state filter, so this keeps every United States row, then fetches each
// profile page (location with map pin, dates, description, features) and its
// public photo gallery. Downloads one `housecarers-<market>-<timestamp>.json`
// file. Load it with `pnpm ingest <file>`. Progress is on window.__agentbnbProgress.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function agentbnbScrapeHouseCarers({
  market = "sf-bay-area",
  country = "United States",
  delayMs = 600,
  limit = Infinity,
} = {}) {
  const progress = (window.__agentbnbProgress = { state: "running", rows: 0, seen: 0, errors: [] });
  const startedAt = new Date().toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = (el) => (el?.textContent ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
  const getDoc = async (path) => {
    const res = await fetch(path, { credentials: "omit" });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return new DOMParser().parseFromString(await res.text(), "text/html");
  };

  const parseList = (doc) =>
    [...doc.querySelectorAll("table tr")]
      .map((tr) => {
        const tds = tr.querySelectorAll("td");
        const link = tr.querySelector('a[href*="homeowner-profile.cfm"]');
        if (tds.length < 6 || !link) return null;
        const id = new URL(link.getAttribute("href"), location.href).searchParams.get("mem");
        return {
          id,
          username: text(link),
          postedAt: tds[0].dataset.order?.slice(0, 10) ?? null,
          locationOrder: tds[1].dataset.order ?? null, // "<Country><State><City>"
          locationText: text(tds[1]),
          startDate: tds[2].dataset.order?.slice(0, 10) ?? null,
          termCode: tds[3].dataset.order ?? null,
          term: text(tds[3]),
          pets: text(tds[4]),
        };
      })
      .filter((r) => r?.id);

  const parseDetail = (doc) => {
    const main = doc.querySelector("#personalProfileContainer");
    const rows = {};
    for (const row of main?.querySelectorAll(".profileTitleWrap") ?? []) {
      const label = text(row.querySelector(".profilTitle"));
      rows[label] = row;
    }
    const locRow = rows.Location;
    const pin = locRow?.querySelector("[data-lat]");
    // Location block: "<area>, <town>, <city><br><county>,<state> <country>"
    const locLines = locRow
      ? locRow
          .querySelector(".profilTitle + div")
          ?.innerHTML.split(/<br\s*\/?>/i)
          .map((h) => text(new DOMParser().parseFromString(h, "text/html").body))
          .filter((s) => s && !/view location map/i.test(s))
      : [];
    const avail = text(rows.Availability?.querySelector(".profilTitle + div"));
    const sections = {};
    for (const s of doc.querySelectorAll("#personalProfile .expandbox")) {
      const label = text(s.querySelector("h6")) || text(s.querySelector("h4"));
      const value = text(s.querySelector(".expand_content"));
      if (label && value) sections[label] = value;
    }
    const pdate = text(main?.querySelector(".pdate"));
    return {
      headline: text(doc.querySelector("h1.top-headings")),
      title: text(main?.querySelector("h2")),
      username: text(main?.querySelector("h3.intro em")),
      updatedAt: pdate.match(/Posted or Updated:\s*([A-Za-z]{3} \d{1,2},\d{4})/)?.[1] ?? null,
      applications: Number(pdate.match(/Applications:\s*(\d+)/)?.[1] ?? NaN) || 0,
      locationLines: locLines ?? [],
      lat: pin ? Number(pin.dataset.lat) : null,
      lng: pin ? Number(pin.dataset.lng) : null,
      from: avail.match(/From:\s*([A-Za-z]{3} \d{1,2},\d{2})/)?.[1] ?? null,
      to: avail.match(/To:\s*([A-Za-z]{3} \d{1,2},\d{2})/)?.[1] ?? null,
      days: Number(avail.match(/Days:\s*(\d+)/)?.[1] ?? NaN) || null,
      termLabel: avail.match(/Days:\s*\d+,\s*(.+)$/)?.[1]?.trim() ?? null,
      // Some homeowners paste past sitters' reviews ("Sit Dates ... Sitter <name>") at
      // the end of the description: other members' text, so cut it off there.
      description: (() => {
        const paras = [...(main?.querySelectorAll("article.detail_paras p") ?? [])].map(text).filter(Boolean);
        const cut = paras.findIndex((p) => /^Sit Dates\b/i.test(p));
        return (cut === -1 ? paras : paras.slice(0, cut)).join("\n\n");
      })(),
      sections,
      verifiedSupporter: /is a Verified Supporter/i.test(doc.body.textContent),
      avatar: doc.querySelector("#gallery img")?.getAttribute("src") ?? null,
      galleryCount: Number(text(doc.querySelector('#gallery a[href*="photo_view"]')).match(/\((\d+)\)/)?.[1] ?? 0),
    };
  };

  const items = [];
  try {
    const list = parseList(await getDoc("/advanced-search-results-housesit3.cfm"));
    progress.rows = list.length;
    const wanted = list.filter((r) => r.locationOrder?.startsWith(country)).slice(0, limit);
    progress.total = wanted.length;
    const seen = new Set();
    for (const row of wanted) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      progress.seen = seen.size;
      try {
        const detail = parseDetail(await getDoc(`/homeowner-profile.cfm?mem=${row.id}`));
        let photos = [];
        if (detail.galleryCount) {
          await sleep(delayMs);
          const gallery = await getDoc(`/photo_view41.cfm?mem=${row.id}&slide=1`);
          photos = [...gallery.querySelectorAll("img[data-large]")].map((img) => ({
            url: new URL(img.dataset.large, location.href).href,
            caption: img.getAttribute("alt") || img.getAttribute("title") || null,
          }));
        }
        items.push({ ...row, ...detail, avatar: detail.avatar && new URL(detail.avatar, location.href).href, photos });
      } catch (err) {
        progress.errors.push({ id: row.id, error: String(err) });
      }
      await sleep(delayMs);
    }
    progress.state = "done";
  } catch (err) {
    progress.state = "failed";
    progress.error = String(err);
  }

  // The public list holds every active sit, so a full error-free run is complete.
  const complete = progress.state === "done" && limit === Infinity && !progress.errors.length;
  const file = { source: "housecarers", market, startedAt, finishedAt: new Date().toISOString(), complete, items };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
  a.download = `housecarers-${market}-${startedAt.replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  progress.file = a.download;
  progress.items = items.length;
  return progress;
}
