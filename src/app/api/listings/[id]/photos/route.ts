import { isAdminRequest } from "@/lib/admin-auth";
import { addListingPhoto, ListingError } from "@/lib/listings";

// Admin: upload one or more photos (multipart field "file") to an internal listing.
export async function POST(req: Request, ctx: RouteContext<"/api/listings/[id]/photos">) {
  if (!isAdminRequest(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const form = await req.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) return Response.json({ error: 'expected multipart field "file"' }, { status: 400 });

  try {
    const caption = form.get("caption");
    const photos = [];
    for (const file of files) {
      photos.push(await addListingPhoto(id, file, typeof caption === "string" ? caption : undefined));
    }
    return Response.json({ photos }, { status: 201 });
  } catch (err) {
    if (err instanceof ListingError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
