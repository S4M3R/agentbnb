import { sql, type SQL } from "drizzle-orm";

// How easily the agent can apply on a guest's behalf, per source, so search puts the places a guest can
// actually get into first. Based on each site's rules as of Oct 2026; re-check when a site changes pricing.
//   1  free for guests: simple sign-up, then message the host (or AgentBnB's own hosts)
//   2  no account: a contact / lead form (furnished rentals); a leasing agent follows up
//   3  everything else: paid membership to apply, phone verification, payment, or no way to apply online
export const APPLY_EASE: Record<string, 1 | 2> = {
  internal: 1,
  volunteersbase: 1,
  workingtraveller: 1,
  sabbaticalhomes: 1,
  spareroom: 1,
  couchers: 1,
  bewelcome: 1,
  trustroots: 1,
  blueground: 2,
  landing: 2,
  tripalink: 2,
  bungalow: 2,
  anyplace: 2,
  outsite: 2,
  zumper: 2,
  apartmentlist: 2,
};

export function applyEase(sourceId: string): 1 | 2 | 3 {
  return APPLY_EASE[sourceId] ?? 3;
}

/** SQL sort key for a source id column: 1 (easiest) to 3. */
export function applyEaseRank(sourceId: SQL | unknown): SQL<number> {
  const tiers = Object.entries(APPLY_EASE);
  return sql<number>`case ${sql.join(
    tiers.map(([id, tier]) => sql`when ${sourceId} = ${id} then ${tier}`),
    sql` `,
  )} else 3 end`;
}
