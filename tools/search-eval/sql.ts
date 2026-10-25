/**
 * Read-only SQL for poking at listing data.
 *   pnpm exec tsx --env-file=.env.local tools/search-eval/sql.ts "select count(*) from listings"
 * Runs inside a READ ONLY transaction, so writes fail. JSON=1 prints JSON instead of a table.
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  const query = process.argv.slice(2).join(" ");
  if (!query) throw new Error("usage: sql.ts <query>");
  const sql = neon(process.env.DATABASE_URL!);
  const [rows] = (await sql.transaction([sql.query(query)], { readOnly: true })) as unknown as [
    Record<string, unknown>[],
  ];
  if (process.env.JSON) console.log(JSON.stringify(rows, null, 2));
  else console.table(rows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
