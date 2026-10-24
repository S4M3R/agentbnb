import { errorResponse, parseBody, unauthenticated } from "@/lib/api-auth";
import { schema } from "@/db";
import { ImportedRequest, importRequest, listRequests, requestUser, type RequestStatus } from "@/lib/requests";

const STATUSES = new Set<string>(schema.requestStatus.enumValues);

// Stay requests the person has received as a host, from AgentBnB and every external network.
export async function GET(req: Request) {
  const user = await requestUser(req);
  if (!user) return unauthenticated();
  const status = new URL(req.url).searchParams
    .get("status")
    ?.split(",")
    .filter((s): s is RequestStatus => STATUSES.has(s));
  return Response.json({ requests: await listRequests(user.id, { status }) });
}

// Import a request the person received on an external platform (their agent read it there).
export async function POST(req: Request) {
  const user = await requestUser(req);
  if (!user) return unauthenticated();
  try {
    const input = await parseBody(req, ImportedRequest);
    return Response.json({ request: await importRequest(user.id, input) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
