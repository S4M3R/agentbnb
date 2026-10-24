import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { apiError } from "@/lib/api-auth";
import { webSession } from "@/lib/session";

// Client uploads for photos the host attaches in the chat: the browser sends the file straight
// to Vercel Blob (no 4.5 MB function body limit); this route only hands out the token.

export async function POST(req: Request) {
  const body = (await req.json()) as HandleUploadBody;
  await webSession(); // make sure this browser has a session before it uploads
  try {
    const result = await handleUpload({
      request: req,
      body,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith("hosting/")) throw new Error("Uploads go under hosting/.");
        return {
          allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "image/heic"],
          maximumSizeInBytes: 10 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
    });
    return Response.json(result);
  } catch (err) {
    return apiError(400, "UPLOAD_REJECTED", err instanceof Error ? err.message : "Upload rejected.");
  }
}
