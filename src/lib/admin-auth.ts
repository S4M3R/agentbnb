import { timingSafeEqual } from "node:crypto";

/**
 * Bearer-token check for admin/automation endpoints (ingest, listing admin).
 * Uses INGEST_TOKEN until real auth exists.
 */
export function isAdminRequest(req: Request) {
  const expected = process.env.INGEST_TOKEN;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!expected || !given || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
