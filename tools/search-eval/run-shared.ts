import path from "node:path";
import type { SearchFn } from "./lib";
import { searchers as builtIn } from "./searchers";

/**
 * Pick searchers by name. `--module=path.ts` adds a file's searchers: its `searchers` record
 * (Record<string, SearchFn>) or its default export (registered under the file's name).
 */
export async function resolveSearchers(names: string, modulePath?: string) {
  const all: Record<string, SearchFn> = { ...builtIn };
  if (modulePath) {
    const mod = await import(path.resolve(modulePath));
    const m = mod.default?.searchers || mod.searchers ? (mod.searchers ?? mod.default.searchers) : null;
    if (m) Object.assign(all, m);
    else if (typeof mod.default === "function") all[path.basename(modulePath).replace(/\.[jt]sx?$/, "")] = mod.default;
    else if (typeof mod.default?.default === "function")
      all[path.basename(modulePath).replace(/\.[jt]sx?$/, "")] = mod.default.default;
  }
  const picked: Record<string, SearchFn> = {};
  for (const n of names.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (!all[n]) throw new Error(`Unknown searcher "${n}". Known: ${Object.keys(all).join(", ")}`);
    picked[n] = all[n];
  }
  return picked;
}
