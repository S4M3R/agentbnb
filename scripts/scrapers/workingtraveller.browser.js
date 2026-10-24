// Browser-side scraper for Working Traveller.
//
// Evaluate in a tab on https://www.workingtraveller.com, then call:
//
//   agentbnbScrapeWorkingTraveller()
//
// Uses the site's public work-search AJAX endpoints (the same ones the
// /work-search/ page calls) filtered to one region (default: California),
// merges the map markers (coordinates) with the list rows, fetches each public
// /work/<slug>/ page for city/skills/languages, and downloads one
// `workingtraveller-<market>-<timestamp>.json` file. Load it with
// `pnpm ingest <file>`. Progress is exposed on window.__agentbnbProgress.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function agentbnbScrapeWorkingTraveller({
  market = "sf-bay-area",
  regionId = "23472", // wtRegionSelL3 for California, United States
  pageSize = 50,
  delayMs = 600,
  limit = Infinity,
  download = true,
} = {}) {
  const progress = (window.__agentbnbProgress = { state: "running", pages: 0, seen: 0, errors: [] });
  const startedAt = new Date().toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => (s ?? "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  const ajax = "/wp-admin/admin-ajax.php?action=wt_work_search";
  const filter =
    `&user_type=Work&daily_barter_all=1&wtDTST_anytime=yes&wtDTSP=01/01/2100` +
    `&wtRegionSelL3=${encodeURIComponent(regionId)}`;

  const getWithRetry = async (url, parse, tries = 4) => {
    for (let i = 1; ; i++) {
      try {
        const res = await fetch(url);
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        return await parse(res);
      } catch (err) {
        if (i >= tries) throw err;
        await sleep(1000 * 2 ** i);
      }
    }
  };
  const getJson = (url) => getWithRetry(url, (r) => r.json());
  const getDoc = (url) =>
    getWithRetry(url, async (r) => new DOMParser().parseFromString(await r.text(), "text/html"));

  // Public /work/<slug>/ page: title carries "Backpacker work in <City>, <State>, <Country>".
  const scrapeDetail = async (slug) => {
    const url = new URL(`/work/${slug}/`, location.origin).href;
    const doc = await getDoc(url);
    if (!doc) return null;
    const place = doc.title.match(/Backpacker work in (.+?) - Working Traveller/)?.[1] ?? null;
    const parts = place?.split(",").map((s) => s.trim()) ?? [];
    const lists = [...doc.querySelectorAll(".works-item")].map((box) => ({
      h: clean(box.querySelector("h4")?.textContent),
      items: [...box.querySelectorAll("li span")].map((s) => clean(s.textContent)).filter(Boolean),
    }));
    const desc = doc.querySelector("#data-description");
    desc?.querySelectorAll("a").forEach((a) => a.remove());
    return {
      url,
      place,
      city: parts.length >= 3 ? parts.slice(0, -2).join(", ") : null,
      region: parts.length >= 2 ? parts.at(-2) : null,
      country: parts.at(-1) ?? null,
      description: clean(desc?.innerText ?? desc?.textContent),
      dates: clean(doc.querySelector("#date-status")?.textContent) || null,
      barter: clean(doc.querySelector(".barter .wt_daily_barter")?.textContent) || null,
      skills: lists.find((l) => /Required Skills/i.test(l.h))?.items ?? [],
      languages: lists.find((l) => /Languages/i.test(l.h))?.items ?? [],
      hostAvatar: doc.querySelector('img[alt="Profile Photo"]')?.getAttribute("src")?.trim() || null,
    };
  };

  // Map popup HTML for markers that have no public list row.
  const scrapeBox = async (pointer) => {
    const doc = await getDoc(`${ajax}&wt_action=details&wt_object=${encodeURIComponent(pointer)}`);
    if (!doc) return null;
    return {
      title: clean(doc.querySelector("h3")?.textContent),
      barter: clean(doc.querySelector(".wt_daily_barter")?.textContent) || null,
      summary: clean(doc.querySelector("p")?.textContent),
      dates: clean(doc.querySelector(".wtSkillsA")?.textContent) || null,
      skills: [...new Set([...doc.querySelectorAll(".wtSkillsL span")].map((s) => clean(s.textContent)))],
      hostId: doc.querySelector("[data-following]")?.getAttribute("data-following") ?? null,
    };
  };

  const items = [];
  try {
    // Markers: [lat, lng, "wrk|<id>|<hash>", type, title, ...]
    const map = await getJson(`${ajax}&wt_action=json${filter}`);
    const markers = new Map();
    for (const m of map?.markers ?? []) {
      const id = String(m[2]).split("|")[1];
      if (id) markers.set(id, { lat: Number(m[0]), lng: Number(m[1]), pointer: m[2], title: m[4] });
    }
    progress.total = map?.count ?? markers.size;

    const rows = new Map();
    for (let start = 0; ; start += pageSize) {
      const page = await getJson(`${ajax}&wt_action=json_list&start=${start}&length=${pageSize}${filter}`);
      progress.pages++;
      const fresh = (page?.data ?? []).filter((r) => !rows.has(r.id));
      if (!fresh.length) break;
      fresh.forEach((r) => rows.set(r.id, r));
      if (rows.size >= (page.recordsTotal ?? 0)) break;
      await sleep(delayMs);
    }

    const ids = [...new Set([...rows.keys(), ...markers.keys()])].slice(0, limit);
    for (const id of ids) {
      const row = rows.get(id) ?? null;
      const marker = markers.get(id) ?? null;
      try {
        await sleep(delayMs);
        const detail = row?.slug ? await scrapeDetail(row.slug) : null;
        const box = !detail && marker ? await scrapeBox(marker.pointer) : null;
        items.push({
          id,
          slug: row?.slug ?? null,
          url: detail?.url ?? null,
          title: clean(row?.name) || box?.title || marker?.title || null,
          description: detail?.description || clean(row?.description) || box?.summary || null,
          lat: marker?.lat ?? null,
          lng: marker?.lng ?? null,
          place: detail?.place ?? null,
          city: detail?.city ?? null,
          region: detail?.region ?? null,
          country: detail?.country ?? null,
          dates: detail?.dates ?? box?.dates ?? null,
          barter: detail?.barter ?? box?.barter ?? row?.stars ?? null,
          skills: detail?.skills?.length ? detail.skills : (box?.skills ?? []),
          languages: detail?.languages ?? [],
          hostId: row?.host ?? box?.hostId ?? null,
          hostLogin: row?.login ?? null,
          hostCover: row?.host_cover ?? null,
          hostAvatar: detail?.hostAvatar ?? null,
          hostNationality: row?.nat ?? null,
          rating: row ? Number(row.rev) || null : null,
          references: row ? Number(row.rating) || 0 : null,
          lastLogin: row?.last_login ?? null,
          publicDetail: Boolean(detail),
        });
      } catch (err) {
        progress.errors.push({ id, error: String(err) });
      }
      progress.seen++;
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
  const file = { source: "workingtraveller", market, startedAt, finishedAt: new Date().toISOString(), complete, items };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
  a.download = `workingtraveller-${market}-${startedAt.replace(/[:.]/g, "-")}${complete ? "" : ".partial"}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  progress.file = a.download;
  return progress;
}
