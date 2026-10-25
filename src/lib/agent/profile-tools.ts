import { tool } from "ai";
import { z } from "zod";
import { getMyProfile, profilePath, ProfileError, ProfileInput, updateProfile } from "@/lib/profile";
import type { WebSession } from "@/lib/session";

// The member's public profile (/people/[id]): the agent reads it and fills it in from the
// conversation ("I'm Agus from Buenos Aires, I speak Spanish and English").

/** What the model sees: the profile, plus where it lives. */
function view(p: NonNullable<Awaited<ReturnType<typeof getMyProfile>>>, withEmail: boolean) {
  return {
    name: p.name,
    ...(withEmail && { email: p.email }),
    bio: p.bio,
    homeCity: p.homeCity,
    languages: p.languages,
    hasPhoto: Boolean(p.avatarUrl),
    verified: p.verified,
    url: profilePath(p.id),
  };
}

/**
 * `email`: let the agent save the member's (private) email too. On for the web chat, where it's
 * how we reach them about replies; off where a key-holding agent talks for them.
 */
export function profileTools(session: WebSession, { email: withEmail = true } = {}) {
  const Input = ProfileInput.extend({
    email: ProfileInput.shape.email.describe(
      withEmail
        ? "Private: the email their agent signs up and logs in on other sites with, and where we send updates when " +
            "hosts reply. Never shown. Save it as soon as they give it to you."
        : "Not available here; leave it out.",
    ),
  });

  return {
    getMyProfile: tool({
      description:
        "The user's public AgentBnB profile (name, bio, home city, languages, whether they have a photo) and its URL. " +
        "Hosts read it before saying yes. Null if they haven't told us anything yet.",
      inputSchema: z.object({}),
      execute: async () => {
        const user = await session.user();
        const profile = user && (await getMyProfile(user.id));
        return { profile: profile ? view(profile, withEmail) : null };
      },
    }),

    updateProfile: tool({
      description:
        "Fill in the user's public profile from what they told you about themself. Send only the fields you learned; " +
        "the rest keep their value. bio and languages replace what's there: call getMyProfile first and merge, so " +
        "you don't lose what they wrote before. For a photo they " +
        "attached in this chat, pass its URL as avatarUrl. Email is private.",
      inputSchema: Input,
      execute: async (input) => {
        if (input.email !== undefined && !withEmail) {
          return { error: "Email can't be changed here; the person can do it in AgentBnB." };
        }
        const user = await session.ensureUser();
        try {
          const profile = await updateProfile(user.id, input);
          return { ok: true, profile: view(profile, withEmail) };
        } catch (err) {
          if (err instanceof ProfileError) return { error: err.message };
          throw err;
        }
      },
    }),
  };
}
