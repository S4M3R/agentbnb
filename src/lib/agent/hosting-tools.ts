import { tool } from "ai";
import { z } from "zod";
import {
  getHostListing,
  HostingError,
  listHostListings,
  ListingDraft,
  publishInternal,
  saveListingDraft,
} from "@/lib/hosting/listings";
import { recommendNetworks } from "@/lib/hosting/networks";
import { queuePublication } from "@/lib/hosting/publications";
import type { WebSession } from "@/lib/session";

// Tools for the host side: list my place, publish it on AgentBnB, and on external networks.
// They act for the person behind the chat's session cookie.

/** Tool errors the model should relay to the user, instead of failing the whole turn. */
async function friendly<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HostingError) return { error: err.message };
    throw err;
  }
}

export function hostingTools(session: WebSession) {
  async function hostId() {
    const user = await session.user();
    if (!user) throw new HostingError("You haven't listed a place yet.");
    return user.id;
  }

  return {
    saveListingDraft: tool({
      description:
        "Create or update the user's own listing as a draft from what they told you and the photos they attached. " +
        "The user sees it as a preview card. Call again with listingId to apply edits.",
      inputSchema: ListingDraft,
      execute: (input) =>
        friendly(async () => {
          const user = await session.ensureUser(input.hostName);
          return saveListingDraft(user.id, input);
        }),
    }),

    publishListing: tool({
      description:
        "Put the user's listing live on AgentBnB's own network so guests can find it. Only after the user approved " +
        "the preview, unless they told you up front to publish without asking.",
      inputSchema: z.object({ listingId: z.uuid() }),
      execute: ({ listingId }) => friendly(async () => publishInternal(await hostId(), listingId)),
    }),

    recommendNetworks: tool({
      description:
        "External networks (Trustroots, BeWelcome, TrustedHousesitters, Workaway, ...) that fit the user's listing, " +
        "best first, with the recommended ones marked. The user sees them with one-click Add buttons.",
      inputSchema: z.object({ listingId: z.uuid() }),
      execute: ({ listingId }) =>
        friendly(async () => {
          const listing = await getHostListing(await hostId(), listingId);
          const published = new Map(listing.publications.map((p) => [p.network, p]));
          return {
            listingId,
            networks: recommendNetworks(listing).map((n) => ({
              ...n,
              publication: published.get(n.id) ?? null,
            })),
          };
        }),
    }),

    addToNetworks: tool({
      description:
        "Start publishing the listing on external networks. A browser agent opens each site in a live window in the " +
        "chat; the user logs in there when asked. Use when the user says yes to your recommendation or names networks.",
      inputSchema: z.object({
        listingId: z.uuid(),
        networks: z.array(z.string()).min(1).max(6).describe('Network ids from recommendNetworks, e.g. ["trustroots"].'),
      }),
      execute: ({ listingId, networks }) =>
        friendly(async () => {
          const userId = await hostId();
          const publications = [];
          for (const n of networks) publications.push(await queuePublication(userId, listingId, n));
          return { publications };
        }),
    }),

    getMyListings: tool({
      description: "The user's own listings with their status and where each is published.",
      inputSchema: z.object({}),
      execute: async () => {
        const user = await session.user();
        return { listings: user ? await listHostListings(user.id) : [] };
      },
    }),
  };
}
