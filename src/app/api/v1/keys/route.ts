import {
  authenticate,
  createKey,
  errorResponse,
  listKeys,
  NewKey,
  parseBody,
  unauthenticated,
} from "@/lib/api-auth";

export async function GET(req: Request) {
  const principal = await authenticate(req);
  if (!principal) return unauthenticated();
  return Response.json({ data: await listKeys(principal) });
}

// Another key for the same person, e.g. so a second agent can connect.
export async function POST(req: Request) {
  const principal = await authenticate(req);
  if (!principal) return unauthenticated();
  try {
    const input = await parseBody(req, NewKey);
    return Response.json(await createKey(principal, input), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
