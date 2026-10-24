"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { HostingError, pauseInternal, publishInternal } from "@/lib/hosting/listings";
import { currentUser } from "@/lib/session";

export type Result = { ok: true } | { ok: false; error: string };

/** Publish the listing on AgentBnB's own network (`live`), or pause it there. */
export async function setLiveOnAgentBnb(listingId: string, live: boolean): Promise<Result> {
  const id = z.uuid().safeParse(listingId);
  if (!id.success) return { ok: false, error: "That listing doesn't exist." };
  const user = await currentUser();
  if (!user) return { ok: false, error: "List your place in the chat first." };
  try {
    await (live ? publishInternal : pauseInternal)(user.id, id.data);
  } catch (err) {
    if (err instanceof HostingError) return { ok: false, error: err.message };
    throw err;
  }
  refresh();
  return { ok: true };
}
