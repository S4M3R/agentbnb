import { authenticate, unauthenticated } from "@/lib/api-auth";

// Who a key belongs to: the person, and the agent holding it (null if the person holds it).
export async function GET(req: Request) {
  const principal = await authenticate(req);
  if (!principal) return unauthenticated();
  return Response.json(principal);
}
