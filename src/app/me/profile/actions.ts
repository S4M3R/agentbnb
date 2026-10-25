"use server";

import { refresh } from "next/cache";
import { ProfileError, ProfileInput, updateProfile } from "@/lib/profile";
import { webSession } from "@/lib/session";

export type SaveProfileResult = { ok: true; id: string } | { ok: false; error: string; field?: string };

/** The form always sends a name; the other fields can be blank. */
const ProfileForm = ProfileInput.required({ name: true });

/** Save the profile form. Creates this browser's member on first save. */
export async function saveProfile(input: unknown): Promise<SaveProfileResult> {
  const parsed = ProfileForm.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue.path[0] === undefined ? undefined : String(issue.path[0]);
    return { ok: false, error: field === "name" && issue.code !== "too_big" ? "Add your name." : issue.message, field };
  }
  try {
    const user = await (await webSession()).ensureUser(parsed.data.name);
    const profile = await updateProfile(user.id, parsed.data);
    refresh();
    return { ok: true, id: profile.id };
  } catch (err) {
    if (err instanceof ProfileError) return { ok: false, error: err.message, field: err.field };
    console.error(err);
    return { ok: false, error: "Couldn't save your profile. Try again." };
  }
}
