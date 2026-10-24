import { tool } from "ai";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import * as apps from "@/lib/applications";
import type { WebSession } from "@/lib/session";

// Tools for the guest side: apply to stays, follow up, schedule. And for hosts on AgentBnB's own
// network: answer the requests they get. They act for the person behind the chat's session cookie.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

/** Errors the model should relay to the user, instead of failing the whole turn. */
async function friendly<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof apps.ApplicationError) return { error: err.message };
    throw err;
  }
}

/** What the chat cards need for each application. */
function card(a: apps.ApplicationSummary) {
  return {
    id: a.id,
    status: a.status,
    statusMessage: a.statusMessage,
    title: a.listing.title,
    source: a.source.name,
    photo: a.photo,
    startDate: a.startDate,
    endDate: a.endDate,
    intro: a.intro,
    url: `/applications/${a.id}`,
  };
}

export type ApplicationCard = ReturnType<typeof card>;

export function applyTools(session: WebSession) {
  async function userId() {
    const user = await session.user();
    if (!user) throw new apps.ApplicationError("NOT_FOUND", "You don't have any applications yet.");
    return user.id;
  }

  return {
    getMyApplications: tool({
      description:
        "The user's profile (what hosts will read about them) and their applications with status and latest news, " +
        "plus requests to their own listing if they host. Call before drafting a first application, and when they " +
        "ask how their applications are going.",
      inputSchema: z.object({}),
      execute: async () => {
        const user = await session.user();
        if (!user) return { profile: null, applications: [], requests: [] };
        const [[profile], mine, requests] = await Promise.all([
          db
            .select({
              name: schema.users.name,
              email: schema.users.email,
              bio: schema.users.bio,
              homeCity: schema.users.homeCity,
              languages: schema.users.languages,
            })
            .from(schema.users)
            .where(eq(schema.users.id, user.id)),
          apps.listForGuest(user.id),
          apps.listForHost(user.id),
        ]);
        const brief = (a: apps.ApplicationSummary) => ({
          id: a.id,
          listing: a.listing.title,
          source: a.source.name,
          status: a.status,
          dates: a.startDate && `${a.startDate} to ${a.endDate ?? a.startDate}`,
          latest: a.statusMessage ?? a.lastEvent,
        });
        return { profile, applications: mine.slice(0, 30).map(brief), requests: requests.slice(0, 30).map(brief) };
      },
    }),

    updateMyProfile: tool({
      description:
        "Save what the user told you about themself, so hosts see it and future applications can use it. " +
        "Email is where we send updates when hosts reply.",
      inputSchema: z.object({
        name: z.string().trim().min(1).max(120).optional(),
        email: z.email().optional(),
        bio: z.string().trim().max(1000).optional().describe("A few sentences in their voice: who they are, what they do, why they travel."),
        homeCity: z.string().trim().max(120).optional(),
        languages: z.array(z.string()).max(10).optional(),
      }),
      execute: (input) =>
        friendly(async () => {
          const user = await session.ensureUser(input.name);
          const { name: _name, email, ...rest } = input;
          try {
            await db
              .update(schema.users)
              .set({ ...rest, ...(email && { email: email.toLowerCase() }) })
              .where(eq(schema.users.id, user.id));
          } catch {
            throw new apps.ApplicationError("INVALID_INPUT", "That email is already used by another account.");
          }
          return { ok: true };
        }),
    }),

    applyToListings: tool({
      description:
        "Draft applications to one or more listings from searchStays (any source). The user sees each draft as a " +
        "card with a Send button and a Send all button. Nothing is sent until they approve. Calling again for the " +
        "same listing updates its draft.",
      inputSchema: z.object({
        applications: z
          .array(
            z.object({
              listingId: z.uuid(),
              startDate: isoDate.optional(),
              endDate: isoDate.optional(),
              intro: z
                .string()
                .min(40)
                .max(2500)
                .describe(
                  "The message the host reads, in the user's voice: who they are, why they're coming, the exact dates, " +
                    "and why they're a good fit for this place (pets, skills, what the host asked for). 80-180 words.",
                ),
            }),
          )
          .min(1)
          .max(10),
      }),
      execute: ({ applications }) =>
        friendly(async () => {
          const user = await session.ensureUser();
          const results = await apps.draftApplications(user.id, applications);
          const ids = results.flatMap((r) => (r.applicationId && !r.error ? [r.applicationId] : []));
          const drafts = await apps.getSummaries(ids);
          return {
            drafts: drafts.map(card),
            problems: results.filter((r) => r.error).map((r) => ({ listingId: r.listingId, error: r.error! })),
          };
        }),
    }),

    sendApplications: tool({
      description:
        "Send drafted applications. Only when the user explicitly approved these drafts in their last message " +
        '("send it", "yes, apply"); otherwise let them tap Send on the cards. AgentBnB hosts get it right away; ' +
        "on external sites a browser agent applies for them and may need them to log in once.",
      inputSchema: z.object({ applicationIds: z.array(z.uuid()).min(1).max(10) }),
      execute: ({ applicationIds }) =>
        friendly(async () => {
          // External ones start in the browser once the chat card shows them (it calls the run route).
          await apps.approve(await userId(), applicationIds);
          return { applications: (await apps.getSummaries(applicationIds)).map(card) };
        }),
    }),

    messageHost: tool({
      description:
        "Send a message on an application's thread: a reply to the host, a follow-up, or an answer to their question. " +
        "Write it in the user's voice and confirm the wording with them first unless they dictated it.",
      inputSchema: z.object({ applicationId: z.uuid(), message: z.string().min(1).max(4000) }),
      execute: ({ applicationId, message }) =>
        friendly(async () => {
          await apps.postMessage(await userId(), applicationId, message);
          return { ok: true };
        }),
    }),

    withdrawApplications: tool({
      description: "Withdraw applications the user no longer wants, e.g. the others once one was accepted.",
      inputSchema: z.object({ applicationIds: z.array(z.uuid()).min(1).max(20) }),
      execute: ({ applicationIds }) =>
        friendly(async () => {
          const id = await userId();
          for (const a of applicationIds) await apps.withdraw(id, a);
          return { ok: true };
        }),
    }),

    scheduleStay: tool({
      description: "Once a host accepted, confirm the dates and when the guest arrives. Both sides are notified.",
      inputSchema: z.object({
        applicationId: z.uuid(),
        arrival: z.string().min(1).max(200).describe('e.g. "Friday Dec 12 around 6pm"'),
        startDate: isoDate.optional(),
        endDate: isoDate.optional(),
      }),
      execute: ({ applicationId, ...input }) =>
        friendly(async () => {
          await apps.schedule(await userId(), applicationId, input);
          return { ok: true };
        }),
    }),

    respondToRequest: tool({
      description: "For hosts: accept or decline a guest's request to stay at their AgentBnB listing, with an optional message.",
      inputSchema: z.object({
        applicationId: z.uuid(),
        decision: z.enum(["accept", "decline"]),
        message: z.string().max(4000).optional(),
      }),
      execute: ({ applicationId, decision, message }) =>
        friendly(async () => {
          await apps.respond(await userId(), applicationId, decision, message);
          return { ok: true };
        }),
    }),
  };
}
