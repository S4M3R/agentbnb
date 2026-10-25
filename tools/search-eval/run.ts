/**
 * Score stay-search functions against the judged eval set.
 *
 *   pnpm exec tsx --env-file=.env.local tools/search-eval/run.ts
 *   pnpm exec tsx --env-file=.env.local tools/search-eval/run.ts --search=baseline,mine --module=tools/search-eval/my-search.ts --judge
 *
 * Flags:
 *   --search=a,b     searchers to compare (default: baseline). Built-ins live in searchers.ts.
 *   --module=file    add searchers from a file: export `searchers: Record<string, SearchFn>` or a default SearchFn.
 *   --judge          grade unjudged listings in each searcher's top 20 first (LLM, cached). Use this for any new
 *                    search: otherwise listings the pool never saw count as non-relevant ("holes").
 *   --only=id,id     subset of queries; --tag=house_sit to filter by tag.
 *   --worst=N        detail the N worst queries of the first searcher (default 5); --show=id for one query.
 *   --json=file      write per-query scores to a file.
 *
 * Metrics (relevant = judge grade >= 2 on 0-3): nDCG@10 (gain 2^g-1, ideal from every judged listing),
 * P@5, R@20 (recall against all relevant listings found in the judged pool). Queries with nothing relevant
 * in the pool (negatives) are left out of the means and reported as junk@10 instead.
 */
import { writeFileSync } from "node:fs";
import {
  costUSD,
  judgeMissing,
  loadCards,
  loadJudgments,
  loadQueries,
  mean,
  REL,
  saveJudgments,
  scoreQuery,
  searchableIds,
} from "./lib";
import { resolveSearchers } from "./run-shared";

type Score = ReturnType<typeof scoreQuery> & { ms: number; ranked: string[]; error?: string };

const f = (x: number | null | undefined, d = 3) => (x == null ? "  -  " : x.toFixed(d));

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, ...v] = a.replace(/^--/, "").split("=");
      return [k, v.join("=") || "true"];
    }),
  );
  const { asOf, queries: all } = loadQueries();
  let queries = all;
  if (args.only) queries = queries.filter((q) => args.only.split(",").includes(q.id));
  if (args.tag) queries = queries.filter((q) => q.tags.includes(args.tag));
  if (args.show) queries = queries.filter((q) => q.id === args.show);
  const searchers = await resolveSearchers(args.search ?? "baseline", args.module);
  const names = Object.keys(searchers);
  const j = loadJudgments();

  // Run every searcher on every query (sequential per searcher keeps latency numbers honest).
  const results: Record<string, Record<string, Score>> = {};
  for (const name of names) {
    results[name] = {};
    for (const e of queries) {
      const t0 = performance.now();
      let ranked: string[] = [];
      let error: string | undefined;
      try {
        ranked = (await searchers[name]({ id: e.id, query: e.query, params: e.params }, { asOf, k: 20 })).slice(0, 20);
      } catch (err) {
        error = (err as Error).message;
      }
      const ms = performance.now() - t0;
      results[name][e.id] = { ...scoreQuery(ranked, {}), ms, ranked, error };
    }
  }

  if (args.judge) {
    const before = { ...j.usage };
    let n = 0;
    for (const e of queries) {
      const ids = names.flatMap((name) => results[name][e.id].ranked);
      n += await judgeMissing(j, e, ids, asOf);
    }
    saveJudgments(j);
    const spent = { calls: j.usage.calls - before.calls, inputTokens: j.usage.inputTokens - before.inputTokens, outputTokens: j.usage.outputTokens - before.outputTokens };
    console.log(`Judged ${n} new listings (~$${costUSD(spent).toFixed(3)}).`);
  }

  const searchable = await searchableIds();
  const gradesOf = (id: string) =>
    Object.fromEntries(Object.entries(j.queries[id]?.grades ?? {}).filter(([lid]) => searchable.has(lid)));
  for (const name of names)
    for (const e of queries) {
      const r = results[name][e.id];
      const grades = gradesOf(e.id);
      results[name][e.id] = { ...r, ...scoreQuery(r.ranked, grades) };
    }

  const scored = (name: string) => queries.map((e) => results[name][e.id]).filter((s) => s.relevantTotal > 0);
  const negatives = queries.filter((e) => !Object.values(gradesOf(e.id)).some((g) => g.g >= REL));

  // Summary
  console.log(`\nStay search eval, as of ${asOf}: ${queries.length} queries (${queries.length - negatives.length} with relevant listings), judge ${j.model}\n`);
  console.table(
    Object.fromEntries(
      names.map((name) => {
        const s = scored(name);
        const rs = queries.map((e) => results[name][e.id]);
        return [
          name,
          {
            "nDCG@10": f(mean(s.map((x) => x.ndcg10))),
            "P@5": f(mean(s.map((x) => x.p5))),
            "R@20": f(mean(s.map((x) => x.r20))),
            "zero results": rs.filter((x) => x.returned === 0).length,
            "holes@10": rs.reduce((a, x) => a + x.holes10, 0),
            "junk@10 (negatives)": f(mean(negatives.map((e) => (results[name][e.id].returned ? results[name][e.id].junk10 : 0)))),
            "ms/query": Math.round(mean(rs.map((x) => x.ms)) ?? 0),
            errors: rs.filter((x) => x.error).length,
          },
        ];
      }),
    ),
  );
  const holes = names.reduce((a, n) => a + queries.reduce((b, e) => b + results[n][e.id].holes10, 0), 0);
  if (holes && !args.judge) console.log(`Note: ${holes} unjudged listings in top 10s count as non-relevant. Rerun with --judge for a fair comparison.\n`);

  // By tag
  const tags = [...new Set(queries.flatMap((e) => e.tags))].sort();
  console.log("nDCG@10 by tag (queries with relevant listings only)");
  console.table(
    Object.fromEntries(
      tags
        .map((t) => {
          const qs = queries.filter((e) => e.tags.includes(t) && results[names[0]][e.id].relevantTotal > 0);
          return [t, { n: qs.length, ...Object.fromEntries(names.map((n) => [n, f(mean(qs.map((e) => results[n][e.id].ndcg10)))])) }];
        })
        .filter(([, v]) => (v as { n: number }).n > 0),
    ),
  );

  // Per query
  console.log("Per query");
  console.table(
    Object.fromEntries(
      queries.map((e) => {
        const row: Record<string, string | number> = { rel: results[names[0]][e.id].relevantTotal };
        for (const n of names) {
          const r = results[n][e.id];
          const p = names.length > 1 ? `${n} ` : "";
          row[`${p}n`] = r.error ? "ERR" : r.returned;
          row[`${p}nDCG`] = f(r.ndcg10, 2);
          if (names.length === 1) {
            row["P@5"] = f(r.p5, 2);
            row["R@20"] = f(r.r20, 2);
            row["holes"] = r.holes10;
          }
        }
        return [e.id, row];
      }),
    ),
  );

  // Worst queries, with what came back and what was missed.
  const first = names[0];
  const worst = args.show
    ? queries
    : queries
        .filter((e) => results[first][e.id].relevantTotal > 0)
        .toSorted((a, b) => (results[first][a.id].ndcg10 ?? 0) - (results[first][b.id].ndcg10 ?? 0))
        .slice(0, Number(args.worst ?? 5));
  const cardIds = worst.flatMap((e) => [...results[first][e.id].ranked.slice(0, 5), ...Object.keys(j.queries[e.id]?.grades ?? {})]);
  const cards = await loadCards([...new Set(cardIds)], asOf);
  const label = (id: string) => {
    const c = cards.get(id);
    return c ? `[${c.source_id}/${c.type}] ${c.title.slice(0, 70)} (${c.neighborhood ?? c.city ?? c.subregion ?? "?"})` : id;
  };
  console.log(`\nWorst queries for ${first}:`);
  for (const e of worst) {
    const r = results[first][e.id];
    const grades = j.queries[e.id]?.grades ?? {};
    console.log(`\n■ ${e.id}  nDCG@10 ${f(r.ndcg10, 2)}  P@5 ${f(r.p5, 2)}  returned ${r.returned}  relevant in pool ${r.relevantTotal}`);
    console.log(`  "${e.query}"  params ${JSON.stringify(e.params)}`);
    for (const id of r.ranked.slice(0, 5)) {
      const g = grades[id];
      console.log(`   ${g ? g.g : "?"}  ${label(id)}${g ? ` | ${g.why}` : ""}`);
    }
    const missed = Object.entries(grades)
      .filter(([id, g]) => g.g === 3 && !r.ranked.includes(id))
      .slice(0, 3);
    if (missed.length) {
      console.log("  missed (grade 3, not in top 20):");
      for (const [id, g] of missed) console.log(`   3  ${label(id)} | ${g.why}`);
    }
  }

  if (args.json) {
    writeFileSync(args.json, JSON.stringify({ asOf, judge: j.model, results }, null, 1));
    console.log(`\nWrote ${args.json}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

