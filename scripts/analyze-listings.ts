// Analyze listings with AI (text + up to 4 photos) into listing_insights, then embed them.
// Unchanged listings are skipped (content_hash), so it's safe to interrupt and rerun.
//
//   pnpm analyze                         all active listings that changed since the last run
//   pnpm analyze --dry-run               just count what would be analyzed
//   pnpm analyze --source workaway       one source
//   pnpm analyze --limit 50              the first 50 (by id)
//   pnpm analyze --per-source 2          a random sample: 2 listings from every source
//   pnpm analyze --id <uuid> [--id ...]  specific listings
//   pnpm analyze --force                 re-analyze even if unchanged
//   pnpm analyze --retry-text-only       redo listings whose photos couldn't be fetched
//   pnpm analyze --concurrency 12        parallel model calls (default 12)
//   pnpm analyze --embed-only            only embed rows that have no embedding yet

import { parseArgs } from "node:util";
import { embedPending, INSIGHTS_MODEL, EMBEDDING_MODEL, runInsights } from "@/lib/insights";

async function main() {
  const { values } = parseArgs({
    options: {
      limit: { type: "string" },
      source: { type: "string" },
      id: { type: "string", multiple: true },
      "per-source": { type: "string" },
      concurrency: { type: "string" },
      "dry-run": { type: "boolean" },
      force: { type: "boolean" },
      "retry-text-only": { type: "boolean" },
      "embed-only": { type: "boolean" },
    },
  });
  const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

  if (values["embed-only"]) {
    const r = await embedPending({ log });
    log(`embedded ${r.embedded} rows, ${r.tokens} tokens, $${r.costUsd.toFixed(4)}`);
    return;
  }

  log(`model ${INSIGHTS_MODEL}, embeddings ${EMBEDDING_MODEL}`);
  const stats = await runInsights({
    limit: values.limit ? Number(values.limit) : undefined,
    sourceId: values.source,
    ids: values.id,
    perSource: values["per-source"] ? Number(values["per-source"]) : undefined,
    concurrency: values.concurrency ? Number(values.concurrency) : undefined,
    dryRun: values["dry-run"],
    force: values.force,
    retryTextOnly: values["retry-text-only"],
    log,
  });

  const analyzed = stats.analyzed || 1;
  console.log(
    JSON.stringify(
      {
        ...stats,
        failed: stats.failed.length,
        analysisCostUsd: Number(stats.analysisCostUsd.toFixed(4)),
        embeddingCostUsd: Number(stats.embeddingCostUsd.toFixed(5)),
        perListing: {
          inputTokens: Math.round(stats.inputTokens / analyzed),
          outputTokens: Math.round(stats.outputTokens / analyzed),
          costUsd: Number((stats.analysisCostUsd / analyzed).toFixed(6)),
          seconds: Number((stats.seconds / analyzed).toFixed(2)),
        },
      },
      null,
      2,
    ),
  );
  for (const f of stats.failed.slice(0, 20)) console.log(`failed ${f.id}: ${f.error}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
