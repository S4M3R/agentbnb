import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { apiError, errorResponse, parseBody } from "@/lib/api-auth";
import { currentUser, webSession } from "@/lib/session";

// This browser's Web Push subscription. The page saves it after the person turns notifications on
// (a click, so creating the person here is fine), and public/sw.js saves the new one when the
// browser rotates it (`pushsubscriptionchange`), passing the old endpoint so the row is replaced.

const { pushSubscriptions: subs } = schema;

const Subscription = z.object({
  endpoint: z.url({ protocol: /^https$/ }),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

const SaveBody = z.object({ subscription: Subscription, oldEndpoint: z.url().optional() });

/** GET /api/push/subscription: the server's VAPID public key, for the service worker to re-subscribe with. */
export function GET() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) return apiError(503, "PUSH_UNAVAILABLE", "Push notifications aren't set up on this server.");
  return Response.json({ publicKey });
}

/** POST /api/push/subscription { subscription, oldEndpoint? } */
export async function POST(req: Request) {
  try {
    const { subscription: s, oldEndpoint } = await parseBody(req, SaveBody);
    // The service worker's request carries the session cookie; if it somehow doesn't, holding the
    // old endpoint (a secret URL only that browser knows) is enough to move its row over.
    let userId = (await currentUser())?.id;
    if (!userId && oldEndpoint) {
      const [old] = await db.select({ userId: subs.userId }).from(subs).where(eq(subs.endpoint, oldEndpoint));
      userId = old?.userId;
    }
    if (!userId) userId = (await (await webSession()).ensureUser()).id;

    if (oldEndpoint && oldEndpoint !== s.endpoint) {
      await db.delete(subs).where(and(eq(subs.endpoint, oldEndpoint), eq(subs.userId, userId)));
    }
    const userAgent = req.headers.get("user-agent")?.slice(0, 300) ?? null;
    await db
      .insert(subs)
      .values({ userId, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, userAgent })
      .onConflictDoUpdate({ target: subs.endpoint, set: { userId, p256dh: s.keys.p256dh, auth: s.keys.auth, userAgent } });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE /api/push/subscription { endpoint }: the person turned notifications off on this browser. */
export async function DELETE(req: Request) {
  try {
    const { endpoint } = await parseBody(req, z.object({ endpoint: z.url() }));
    const user = await currentUser();
    if (!user) return apiError(401, "NO_SESSION", "No AgentBnB session in this browser.");
    await db.delete(subs).where(and(eq(subs.endpoint, endpoint), eq(subs.userId, user.id)));
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
