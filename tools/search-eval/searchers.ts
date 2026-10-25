/**
 * Search functions the runner can score. Add yours here, or pass a file with --module (see run.ts).
 * A SearchFn gets the user's words and the agent's searchStays params and returns listing ids, best first.
 */
import { stayTools } from "@/lib/agent/tools";
import type { SearchFn, SearchStaysParams } from "./lib";

type SearchStaysOutput = { total: number; results: { id: string }[] };

/** Call the chat agent's searchStays tool exactly as the agent does. */
export async function callSearchStays(params: SearchStaysParams, k = 20) {
  const execute = stayTools.searchStays.execute as unknown as (
    input: SearchStaysParams,
    options: { toolCallId: string; messages: unknown[] },
  ) => Promise<SearchStaysOutput>;
  return execute({ ...params, limit: Math.min(k, 20) }, { toolCallId: "search-eval", messages: [] });
}

/** Today's searchStays with the agent's params. */
const baseline: SearchFn = async (q, { k }) => (await callSearchStays(q.params, k)).results.map((r) => r.id);

/** Same, without the keywords filter: how much does the substring keyword match cost or help? */
const baselineNoKeywords: SearchFn = async (q, { k }) => {
  const { keywords: _drop, ...rest } = q.params;
  return (await callSearchStays(rest, k)).results.map((r) => r.id);
};

export const searchers: Record<string, SearchFn> = {
  baseline,
  "baseline-nokw": baselineNoKeywords,
};
