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

const PhotoShot = z.object({
  id: z.string().describe('Short slug, e.g. "bed".'),
  label: z.string().describe('What to photograph, e.g. "Where you\'ll sleep".'),
  tip: z.string().describe('One concrete tip, e.g. "Stand in the doorway so the whole bed is in frame. Open the curtains."'),
});

/**
 * Client-side tool (no execute): the chat shows a shot list with a camera view, and the browser
 * returns the uploaded photos with addToolOutput. The model gets them back as images.
 */
export const askForPhotos = tool({
  description:
    "Ask the host for photos of their place. The user sees your shot list with a tip per shot and can open " +
    "their camera right in the chat (or upload from their library). Returns the photos once they're done.",
  inputSchema: z.object({
    intro: z.string().max(200).describe("One friendly line shown above the shot list."),
    shots: z.array(PhotoShot).min(1).max(6).describe("Tailored to their place, most important first."),
  }),
  outputSchema: z.object({
    photos: z.array(z.object({ url: z.string(), shot: z.string().nullable() })),
    skipped: z.boolean().optional(),
  }),
  toModelOutput: ({ output }) => ({
    type: "content",
    value: output.photos.length
      ? output.photos.flatMap((p, i) => [
          { type: "text" as const, text: `Photo ${i + 1}${p.shot ? ` (${p.shot})` : ""}: ${p.url}` },
          { type: "file" as const, mediaType: "image/jpeg", data: { type: "url" as const, url: new URL(p.url) } },
        ])
      : [{ type: "text" as const, text: "The user skipped photos for now." }],
  }),
});

/**
 * Client-side tool (no execute): the chat shows "Use my location" and a map to drop a pin on.
 * Returns the chosen point and a short place name.
 */
export const askForLocation = tool({
  description:
    "Ask where the host's place is. The user can share their current location or pick the spot on a map (and " +
    "search it). Use this instead of asking them to type an address. Pass the result's point to saveListingDraft.",
  inputSchema: z.object({
    intro: z.string().max(200).describe('One friendly line, e.g. "Where\'s your place? Only guests you accept see the exact spot."'),
  }),
  outputSchema: z.object({
    point: z.object({ lat: z.number(), lng: z.number() }),
    label: z.string().describe('Short place name, e.g. "Mission, San Francisco".'),
    address: z.string().describe("Full address from the map, kept private."),
    source: z.enum(["gps", "map"]),
  }),
});

export function hostingTools(session: WebSession) {
  async function hostId() {
    const user = await session.user();
    if (!user) throw new HostingError("You haven't listed a place yet.");
    return user.id;
  }

  return {
    askForLocation,
    askForPhotos,

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
