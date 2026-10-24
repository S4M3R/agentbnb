import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { CONFIRMED, IN_PROGRESS, listForGuest, listForHost, type ApplicationSummary } from "@/lib/applications";
import { getNetwork } from "@/lib/hosting/networks";
import { listRequests } from "@/lib/requests";

// "Needs your attention" on the home screen: everything waiting on this person, as guest and as
// host, built from the same rows the Applications and Hosting tabs read. Only the person's own
// data, and only display strings: no emails, intros or other private fields.

const { notifications, applicationEvents: events, listingPublications: pubs, listings } = schema;

export type AttentionKind =
  | "application_needs_user" // the browser agent needs the guest to sign in or finish a step
  | "application_failed" // couldn't send the application
  | "confirm_arrival" // the host said yes; the guest still has to say when they arrive
  | "withdraw_overlapping" // a stay is confirmed; other applications for the same dates are still out
  | "message" // the other side wrote and it hasn't been read
  | "stay_request" // a guest asked to stay at the host's place
  | "publication_needs_user" // a network publish is waiting on the host in the live browser
  | "publication_failed" // a network publish failed
  | "notification"; // any other unread notification

export type AttentionItem = {
  id: string;
  kind: AttentionKind;
  title: string;
  detail: string;
  /** A path in the app, or the live browser's URL while a session is open. */
  href: string;
  /** Source id of the website it's about, for the favicon. */
  site?: string;
  /** ISO time it started needing attention. */
  at: string;
  urgency: "urgent" | "normal";
};

const MAX_ITEMS = 20;
const OPEN_FOR_OVERLAP = [...IN_PROGRESS.filter((s) => s !== "draft"), ...CONFIRMED];

const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
function dates(start: string | null, end: string | null) {
  if (!start) return null;
  const s = fmt.format(new Date(`${start}T00:00:00Z`));
  return !end || end === start ? s : `${s} – ${fmt.format(new Date(`${end}T00:00:00Z`))}`;
}

const line = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(" · ");
const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const iso = (d: Date | string) => new Date(d).toISOString();
const appPath = (id: string) => `/applications/${id}`;
const titleOf = (a: ApplicationSummary) => a.listing.title ?? "your stay";
const siteOf = (a: ApplicationSummary) => (a.source.id === "internal" ? undefined : a.source.id);

/** Whether two date ranges (YYYY-MM-DD, end optional) share a night. */
function overlaps(a: ApplicationSummary, b: ApplicationSummary) {
  if (!a.startDate || !b.startDate) return false;
  return a.startDate <= (b.endDate ?? b.startDate) && b.startDate <= (a.endDate ?? a.startDate);
}

/** Everything waiting on `userId`, urgent first, then newest first. */
export async function attentionFor(userId: string): Promise<AttentionItem[]> {
  const [mine, hosted, requests, publications, unread] = await Promise.all([
    listForGuest(userId),
    listForHost(userId),
    listRequests(userId, { status: ["new"] }),
    db
      .select({
        id: pubs.id,
        status: pubs.status,
        sourceId: pubs.sourceId,
        statusMessage: pubs.statusMessage,
        error: pubs.error,
        liveViewUrl: pubs.liveViewUrl,
        browserSessionId: pubs.browserSessionId,
        updatedAt: pubs.updatedAt,
        listingTitle: listings.title,
      })
      .from(pubs)
      .innerJoin(listings, eq(listings.id, pubs.listingId))
      .where(and(eq(listings.hostUserId, userId), inArray(pubs.status, ["needs_user", "failed"])))
      .orderBy(desc(pubs.updatedAt))
      .limit(10),
    db
      .select({
        id: notifications.id,
        applicationId: notifications.applicationId,
        title: notifications.title,
        body: notifications.body,
        url: notifications.url,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .orderBy(desc(notifications.createdAt))
      .limit(50),
  ]);

  const items: AttentionItem[] = [];
  /** Applications that already have an item; their notifications aren't repeated. */
  const covered = new Set<string>();
  const add = (item: AttentionItem, applicationId?: string | null) => {
    items.push(item);
    if (applicationId) covered.add(applicationId);
  };

  // --- Guest: applications that need a step from them --------------------------------------
  for (const a of mine) {
    if (a.status === "needs_user")
      add(
        {
          id: `app:${a.id}:needs_user`,
          kind: "application_needs_user",
          title: `Finish signing in on ${a.source.name}`,
          detail: line(titleOf(a), a.statusMessage ?? "Open the live browser to continue."),
          href: appPath(a.id),
          site: siteOf(a),
          at: iso(a.updatedAt),
          urgency: "urgent",
        },
        a.id,
      );
    else if (a.status === "failed")
      add(
        {
          id: `app:${a.id}:failed`,
          kind: "application_failed",
          title: `Couldn't send: ${titleOf(a)}`,
          detail: `Retry, or apply yourself on ${a.source.name}.`,
          href: appPath(a.id),
          site: siteOf(a),
          at: iso(a.updatedAt),
          urgency: "normal",
        },
        a.id,
      );
    else if (a.status === "accepted" && !a.arrival)
      add(
        {
          id: `app:${a.id}:arrival`,
          kind: "confirm_arrival",
          title: `Accepted! Confirm your arrival`,
          detail: line(titleOf(a), dates(a.startDate, a.endDate)),
          href: appPath(a.id),
          site: siteOf(a),
          at: iso(a.updatedAt),
          urgency: "urgent",
        },
        a.id,
      );

    if (CONFIRMED.includes(a.status)) {
      const others = mine.filter((o) => o.id !== a.id && OPEN_FOR_OVERLAP.includes(o.status) && overlaps(a, o));
      // Two confirmed stays for the same dates nudge once, from the older one.
      if (others.some((o) => CONFIRMED.includes(o.status) && o.updatedAt < a.updatedAt)) continue;
      if (others.length)
        add(
          {
            id: `app:${a.id}:overlap`,
            kind: "withdraw_overlapping",
            title: `Withdraw ${others.length} other application${others.length === 1 ? "" : "s"}?`,
            detail: line(`You're set at ${titleOf(a)}`, dates(a.startDate, a.endDate)),
            href: appPath(a.id),
            site: siteOf(a),
            at: iso(a.updatedAt),
            urgency: "normal",
          },
          a.id,
        );
    }
  }

  // --- Host: requests waiting for an answer ------------------------------------------------
  for (const r of requests) {
    const site = r.source.id === "internal" ? undefined : r.source.id;
    add(
      {
        id: `request:${r.id}`,
        kind: "stay_request",
        title: `${r.guest.name} wants to stay`,
        detail: line(r.listing?.title, dates(r.startDate, r.endDate), site && `via ${r.source.name}`),
        href: `/requests/${r.id}`,
        site,
        at: iso(r.receivedAt),
        urgency: "urgent",
      },
      r.applicationId,
    );
  }
  // Internal applications to the host's listings normally show up above, through the inbox.
  for (const a of hosted)
    if (a.status === "sent" && !covered.has(a.id))
      add(
        {
          id: `app:${a.id}:host`,
          kind: "stay_request",
          title: `${a.guestName} wants to stay`,
          detail: line(titleOf(a), dates(a.startDate, a.endDate)),
          href: appPath(a.id),
          at: iso(a.sentAt ?? a.updatedAt),
          urgency: "urgent",
        },
        a.id,
      );

  // --- Hosting: publishing to other networks -----------------------------------------------
  for (const p of publications) {
    if (p.status === "failed" && p.error === "Stopped by you.") continue;
    const network = getNetwork(p.sourceId)?.name ?? p.sourceId;
    const live = p.browserSessionId != null && p.liveViewUrl ? p.liveViewUrl : null;
    add({
      id: `publication:${p.id}`,
      kind: p.status === "needs_user" ? "publication_needs_user" : "publication_failed",
      title: p.status === "needs_user" ? `Finish publishing on ${network}` : `Couldn't publish on ${network}`,
      detail: line(
        p.listingTitle,
        p.status === "needs_user" ? (p.statusMessage ?? "Sign in in the live browser.") : "Try again from the chat.",
      ),
      // The live browser while a session is open; otherwise the Hosting tab.
      href: live ?? "/requests",
      site: p.sourceId,
      at: iso(p.updatedAt),
      urgency: p.status === "needs_user" ? "urgent" : "normal",
    });
  }

  // --- Unread notifications: new messages, then anything else ------------------------------
  const unreadApps = [...new Set(unread.flatMap((n) => (n.applicationId && !covered.has(n.applicationId) ? [n.applicationId] : [])))];
  const byId = new Map([...mine, ...hosted].map((a) => [a.id, a]));
  const lastEvents = unreadApps.length
    ? await db
        .selectDistinctOn([events.applicationId], {
          applicationId: events.applicationId,
          kind: events.kind,
          actor: events.actor,
          body: events.body,
          createdAt: events.createdAt,
        })
        .from(events)
        .where(inArray(events.applicationId, unreadApps))
        .orderBy(events.applicationId, desc(events.createdAt))
    : [];

  for (const e of lastEvents) {
    const a = byId.get(e.applicationId);
    if (!a || e.kind !== "message" || !e.body) continue;
    const guestView = a.userId === userId;
    // Only messages from the other side are news.
    if ((guestView && e.actor !== "host") || (!guestView && e.actor !== "guest")) continue;
    add(
      {
        id: `app:${a.id}:message`,
        kind: "message",
        title: guestView ? `The host replied · ${titleOf(a)}` : `New message from ${a.guestName}`,
        detail: clip(e.body.replace(/\s+/g, " ").trim()),
        href: appPath(a.id),
        site: siteOf(a),
        at: iso(e.createdAt),
        urgency: "urgent",
      },
      a.id,
    );
  }

  const seen = new Set<string>();
  for (const n of unread) {
    if (n.applicationId && covered.has(n.applicationId)) continue;
    // One row per application: its newest notification.
    const key = n.applicationId ?? n.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const a = n.applicationId ? byId.get(n.applicationId) : undefined;
    items.push({
      id: `notification:${n.id}`,
      kind: "notification",
      title: n.title,
      detail: clip((n.body ?? "").replace(/\s+/g, " ").trim()),
      href: n.url?.startsWith("/") ? n.url : n.applicationId ? appPath(n.applicationId) : "/applications",
      site: a ? siteOf(a) : undefined,
      at: iso(n.createdAt),
      urgency: "normal",
    });
  }

  return items
    .sort((x, y) => Number(y.urgency === "urgent") - Number(x.urgency === "urgent") || y.at.localeCompare(x.at))
    .slice(0, MAX_ITEMS);
}
