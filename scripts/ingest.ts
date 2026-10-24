// Load a scrape file downloaded by a browser scraper (scripts/scrapers/*.browser.js)
// into the database.
//
//   pnpm ingest path/to/workaway-sf-bay-area-<timestamp>.json

import { readFile } from "node:fs/promises";
import { finishRun, recordBatch, startRun, upsertListing } from "@/lib/ingest";
import { ADAPTERS, type SourceAdapter } from "@/lib/sources";

type ScrapeFile = {
  source: string;
  market: string | null;
  complete: boolean;
  items: unknown[];
};

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("usage: pnpm ingest <scrape-file.json>");

  const file = JSON.parse(await readFile(path, "utf8")) as ScrapeFile;
  // Registered adapters first; otherwise load src/lib/sources/<source>.ts's default export,
  // so a new source can be ingested before it's added to the registry.
  const adapter: SourceAdapter | undefined =
    ADAPTERS[file.source] ??
    (await import(`../src/lib/sources/${file.source}.ts`).then((m) => m.default).catch(() => undefined));
  if (!adapter) throw new Error(`no adapter for source "${file.source}"`);

  const run = await startRun(adapter.sourceId, file.market);
  const counts = { found: 0, created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 };

  for (const raw of file.items) {
    const item = adapter.normalize(raw);
    if (!item) {
      counts.skipped++;
      continue;
    }
    counts.found++;
    try {
      const { result } = await upsertListing(adapter.sourceId, item);
      counts[result]++;
    } catch (err) {
      counts.failed++;
      console.error(`  ✗ ${item.externalId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  await recordBatch(run.id, counts);
  const finished = await finishRun(run.id, {
    error: counts.failed ? `${counts.failed} items failed` : null,
    markGone: file.complete,
  });

  console.log(`${file.source} → run ${run.id}`);
  console.log(counts, { gone: finished.listingsGone, status: finished.status });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
