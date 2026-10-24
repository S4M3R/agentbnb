import { errorResponse, parseBody, register, Registration } from "@/lib/api-auth";

// Public: a person registers themself, or an agent registers on behalf of its person.
// The API key in the response is shown only once.
export async function POST(req: Request) {
  try {
    const input = await parseBody(req, Registration);
    return Response.json(await register(input), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
