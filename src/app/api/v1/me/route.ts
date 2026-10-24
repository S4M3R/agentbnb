import { authenticate, errorResponse, parseBody, unauthenticated } from "@/lib/api-auth";
import { profilePath, ProfileInput, updateProfile } from "@/lib/profile";

// Who a key belongs to: the person, and the agent holding it (null if the person holds it).
export async function GET(req: Request) {
  const principal = await authenticate(req);
  if (!principal) return unauthenticated();
  return Response.json(principal);
}

// Update the person's public profile. Fields left out keep their value.
export async function PATCH(req: Request) {
  const principal = await authenticate(req);
  if (!principal) return unauthenticated();
  try {
    const input = await parseBody(req, ProfileInput.strict());
    const profile = await updateProfile(principal.user.id, input);
    const url = new URL(profilePath(profile.id), req.url).href;
    return Response.json({ profile: { ...profile, url } });
  } catch (err) {
    return errorResponse(err);
  }
}
