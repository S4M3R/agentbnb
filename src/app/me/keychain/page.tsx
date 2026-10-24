import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeading, PageShell } from "@/components/shell/page-shell";
import { db, schema } from "@/db";
import { latestAsk } from "@/lib/access";
import { browserSessions, getSettings, listEntries } from "@/lib/keychain";
import { currentUser } from "@/lib/session";
import { KeychainManager, type PendingAsk } from "./keychain-manager";

export const metadata: Metadata = {
  title: "Keychain",
  description: "Your logins on other sites, so your agent can sign in for you.",
};

export default function KeychainPage() {
  return (
    <PageShell>
      <PageHeading
        title="Keychain"
        lead="Your logins on other sites. When a site needs you to be signed in, your agent uses these instead of asking you, and it can create an account for you when you don't have one."
      />
      <Suspense fallback={<div className="h-80 animate-pulse rounded-[14px] bg-surface-soft" />}>
        <Keychain />
      </Suspense>
    </PageShell>
  );
}

const { applications, applicationEvents: events, listings, sources, users } = schema;

/** Applications whose browser run is waiting for a login or an email right now. */
async function pendingAsks(userId: string): Promise<PendingAsk[]> {
  const waiting = await db
    .select({ id: applications.id, statusMessage: applications.statusMessage, title: listings.title })
    .from(applications)
    .innerJoin(listings, eq(listings.id, applications.listingId))
    .where(and(eq(applications.userId, userId), eq(applications.status, "needs_user")));
  if (!waiting.length) return [];
  const timeline = await db
    .select({ applicationId: events.applicationId, kind: events.kind, data: events.data })
    .from(events)
    .where(and(inArray(events.applicationId, waiting.map((w) => w.id)), eq(events.kind, "status")))
    .orderBy(asc(events.createdAt));
  return waiting.flatMap((w) => {
    const ask = latestAsk("needs_user", timeline.filter((e) => e.applicationId === w.id));
    return ask && ask.kind !== "browser" ? [{ applicationId: w.id, title: w.title, message: w.statusMessage, ask }] : [];
  });
}

async function Keychain() {
  const user = await currentUser();
  const [entries, sessions, settings, siteList, [profile], pending] = await Promise.all([
    user ? listEntries(user.id) : [],
    user ? browserSessions(user.id) : [],
    user ? getSettings(user.id) : { allowSignUp: true },
    db
      .select({ id: sources.id, name: sources.name, url: sources.baseUrl })
      .from(sources)
      .where(and(eq(sources.enabled, true), ne(sources.id, "internal")))
      .orderBy(asc(sources.name)),
    user ? db.select({ email: users.email }).from(users).where(eq(users.id, user.id)) : [],
    user ? pendingAsks(user.id) : [],
  ]);

  return (
    <KeychainManager
      entries={entries.map((e) => ({
        ...e,
        lastUsedAt: e.lastUsedAt?.toISOString() ?? null,
        updatedAt: e.updatedAt.toISOString(),
      }))}
      sessions={sessions.map((s) => ({ ...s, connectedAt: s.connectedAt?.toISOString() ?? null }))}
      sites={siteList}
      allowSignUp={settings.allowSignUp}
      email={profile?.email ?? null}
      pending={pending}
    />
  );
}
