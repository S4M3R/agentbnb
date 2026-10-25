/**
 * Build each query's candidate pool and grade it with the LLM judge. Cached in judgments.json, so
 * reruns only grade what's new.
 *
 *   pnpm exec tsx --env-file=.env.local tools/search-eval/judge.ts [--search=baseline,baseline-nokw] [--only=id,id] [--module=path.ts]
 *   pnpm exec tsx --env-file=.env.local tools/search-eval/judge.ts --audit=80   # re-grade 80 cached judgments, report agreement, save nothing
 *
 * Pool per query = top 20 of every --search searcher (default: baseline) + up to 25 full-text matches
 * on the query's pool terms inside its area + 8 random listings from that area.
 */
import { createHash } from "node:crypto";
import { costUSD, type EvalQuery, judgeMissing, loadJudgments, loadQueries, mapLimit, poolCandidates, saveJudgments } from "./lib";
import { resolveSearchers } from "./run-shared";

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, ...v] = a.replace(/^--/, "").split("=");
      return [k, v.join("=") || "true"];
    }),
  );
  const { asOf, queries } = loadQueries();
  const only = args.only?.split(",");
  const selected = only ? queries.filter((q) => only.includes(q.id)) : queries;
  const searchers = await resolveSearchers(args.search ?? "baseline", args.module);
  const j = loadJudgments();
  if (args.audit) return audit(j, selected, asOf, Number(args.audit));
  const before = { ...j.usage };
  let graded = 0;

  await mapLimit(selected, 3, async (e) => {
    const fromSearch = (
      await Promise.all(Object.values(searchers).map((fn) => fn(e, { asOf, k: 20 }).catch(() => [] as string[])))
    ).flat();
    const pool = await poolCandidates(e);
    const ids = [...new Set([...fromSearch.slice(0, 60), ...pool])];
    const n = await judgeMissing(j, e, ids, asOf);
    graded += n;
    const rel = Object.values(j.queries[e.id].grades).filter((g) => g.g >= 2).length;
    console.log(`${e.id.padEnd(32)} pool ${String(ids.length).padStart(3)}  newly graded ${String(n).padStart(3)}  relevant ${rel}`);
    saveJudgments(j);
  });

  saveJudgments(j);
  const spent = {
    calls: j.usage.calls - before.calls,
    inputTokens: j.usage.inputTokens - before.inputTokens,
    outputTokens: j.usage.outputTokens - before.outputTokens,
  };
  console.log(
    `\nGraded ${graded} listings in ${spent.calls} calls: ${spent.inputTokens} in / ${spent.outputTokens} out tokens, ~$${costUSD(spent).toFixed(3)} (${j.model}).`,
  );
  console.log(`All-time judge spend: ${j.usage.calls} calls, ~$${costUSD(j.usage).toFixed(3)}.`);
}

/** How repeatable is the judge? Re-grade a random sample in a scratch copy and compare. */
async function audit(j: ReturnType<typeof loadJudgments>, queries: EvalQuery[], asOf: string, n: number) {
  const pairs = queries.flatMap((e) => Object.keys(j.queries[e.id]?.grades ?? {}).map((id) => ({ e, id })));
  const seed = (s: string) => createHash("md5").update(s).digest("hex");
  const sample = pairs.toSorted((a, b) => seed(a.e.id + a.id).localeCompare(seed(b.e.id + b.id))).slice(0, n);
  const scratch = { ...j, usage: { calls: 0, inputTokens: 0, outputTokens: 0 }, queries: {} as typeof j.queries };
  for (const e of queries) {
    const ids = sample.filter((p) => p.e.id === e.id).map((p) => p.id);
    if (ids.length) await judgeMissing(scratch, e, ids, asOf);
  }
  let exact = 0, within1 = 0, relAgree = 0, total = 0;
  const confusion: Record<string, number> = {};
  for (const { e, id } of sample) {
    const a = j.queries[e.id].grades[id]?.g;
    const b = scratch.queries[e.id]?.grades[id]?.g;
    if (a == null || b == null) continue;
    total++;
    if (a === b) exact++;
    if (Math.abs(a - b) <= 1) within1++;
    if (a >= 2 === b >= 2) relAgree++;
    confusion[`${a}->${b}`] = (confusion[`${a}->${b}`] ?? 0) + 1;
  }
  console.log(`Re-graded ${total}: exact ${(exact / total).toFixed(2)}, within 1 ${(within1 / total).toFixed(2)}, relevant/not agreement ${(relAgree / total).toFixed(2)} (~$${costUSD(scratch.usage).toFixed(3)})`);
  console.log("cached->regraded:", confusion);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
