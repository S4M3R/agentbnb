import { eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import { db, schema } from "@/db";
import { sendEmail } from "@/lib/email";
import { SITE_URL } from "@/lib/site";

// Keeping people in the loop. Every notification lands in the in-app inbox (the Applications
// tab), and is also pushed to each browser the person enabled notifications on and emailed when
// we have their address. Push and email are best effort: a failure never loses the inbox row.

const { notifications, pushSubscriptions, users } = schema;

export type Notice = {
  title: string;
  body?: string;
  /** Path to open, e.g. `/applications/<id>`. */
  url?: string;
  applicationId?: string;
};

let vapidReady = false;
function vapid() {
  if (vapidReady) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(`mailto:${process.env.NOTIFY_CONTACT_EMAIL ?? "hello@agentbnb.app"}`, publicKey, privateKey);
  vapidReady = true;
  return true;
}

export function appUrl(path = "/") {
  return new URL(path, SITE_URL).toString();
}

/** Record a notification and deliver it everywhere the person can be reached. */
export async function notify(userId: string, notice: Notice) {
  const [row] = await db
    .insert(notifications)
    .values({
      userId,
      applicationId: notice.applicationId,
      title: notice.title,
      body: notice.body,
      url: notice.url,
    })
    .returning({ id: notifications.id });

  const [pushed, emailed] = await Promise.all([
    push(userId, notice).catch((err) => {
      console.error("push failed", err);
      return false;
    }),
    email(userId, notice).catch((err) => {
      console.error("email failed", err);
      return false;
    }),
  ]);

  if (pushed || emailed) {
    const now = new Date();
    await db
      .update(notifications)
      .set({ pushedAt: pushed ? now : null, emailedAt: emailed ? now : null })
      .where(eq(notifications.id, row.id));
  }
  return row.id;
}

async function push(userId: string, notice: Notice) {
  if (!vapid()) return false;
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  if (!subs.length) return false;

  const payload = JSON.stringify({ title: notice.title, body: notice.body, url: notice.url ?? "/applications" });
  const gone: string[] = [];
  const results = await Promise.all(
    subs.map((s) =>
      webpush
        .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24 })
        .then(() => true)
        .catch((err: { statusCode?: number }) => {
          // 404/410: the browser unsubscribed or the subscription expired.
          if (err.statusCode === 404 || err.statusCode === 410) gone.push(s.id);
          else console.error("push to subscription failed", err);
          return false;
        }),
    ),
  );
  if (gone.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
  return results.some(Boolean);
}

async function email(userId: string, notice: Notice) {
  const [user] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, userId));
  if (!user?.email) return false;
  const link = appUrl(notice.url ?? "/applications");
  return sendEmail({
    to: user.email,
    subject: notice.title,
    text: [notice.body, `Open in AgentBnB: ${link}`].filter(Boolean).join("\n\n"),
    html: emailHtml(notice, link),
  });
}

function escape(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function emailHtml(notice: Notice, link: string) {
  const body = notice.body ? `<p style="margin:0 0 20px;color:#3f3f3f;line-height:1.5;white-space:pre-wrap">${escape(notice.body)}</p>` : "";
  return `<div style="font-family:Inter,-apple-system,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#222">
<p style="margin:0 0 16px;font-size:14px;font-weight:600">AgentBnB</p>
<h1 style="margin:0 0 12px;font-size:20px;font-weight:600;line-height:1.25">${escape(notice.title)}</h1>
${body}
<a href="${escape(link)}" style="display:inline-block;background:#ff385c;color:#fff;text-decoration:none;font-weight:500;padding:12px 20px;border-radius:8px">Open in AgentBnB</a>
</div>`;
}
