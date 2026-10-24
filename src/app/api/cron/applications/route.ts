import { nudgeQuietApplications } from "@/lib/applications";
import { dueApplications } from "@/lib/apply-agent";
import { appUrl } from "@/lib/notify";

// Keeps applications moving while nobody's looking: starts a browser run per external application
// that's due a check (each in its own function, via the run route), and nudges the guest when a
// host has been quiet for 3 days. Vercel Cron calls this (see vercel.ts). The Hobby plan only
// allows a daily cron, so opening the app also re-checks applications (at most every 30 min).

export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "Cron only." } }, { status: 401 });
  }
  const due = await dueApplications();
  const started = await Promise.all(
    due.map((id) =>
      fetch(appUrl("/api/applications/run"), {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      })
        .then((r) => r.ok)
        .catch(() => false),
    ),
  );
  const nudged = await nudgeQuietApplications();
  return Response.json({ due: due.length, started: started.filter(Boolean).length, nudged });
}
