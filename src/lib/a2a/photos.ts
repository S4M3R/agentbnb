import { isIP } from "node:net";
import { put } from "@vercel/blob";
import type { InPart } from "./protocol";

// Photos another agent attaches (a host's place, sent over A2A as file parts) are copied into our
// Blob store: listings only take photos we host, and the caller's URLs may be short-lived.

const TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PHOTOS = 10;

type FilePart = Extract<InPart, { kind: "file" }>;

export function isImagePart(p: InPart): boolean {
  if (p.kind !== "file") return false;
  if (p.mediaType) return p.mediaType.startsWith("image/");
  return /\.(jpe?g|png|webp|heic)$/i.test(p.filename ?? p.url?.split("?")[0] ?? "");
}

/** Only fetch public https URLs: never our own network or a bare IP. */
function fetchable(raw: string) {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    return url.protocol === "https:" && !isIP(host) && host.includes(".") && !/(^|\.)(localhost|internal|local)$/i.test(host);
  } catch {
    return false;
  }
}

async function bytesOf(p: FilePart): Promise<{ buf: Buffer; type: string } | null> {
  if (p.bytes) {
    const buf = Buffer.from(p.bytes, "base64");
    return { buf, type: p.mediaType ?? "image/jpeg" };
  }
  if (!p.url || !fetchable(p.url)) return null;
  const res = await fetch(p.url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
  const type = res.headers.get("content-type")?.split(";")[0].trim() ?? p.mediaType ?? "";
  return { buf: Buffer.from(await res.arrayBuffer()), type };
}

/** Copy the image parts to Blob. Ones we can't read or that aren't photos are skipped. */
export async function storePhotos(parts: InPart[]) {
  const images = parts.filter((p): p is FilePart => isImagePart(p)).slice(0, MAX_PHOTOS);
  const stored = await Promise.all(
    images.map(async (p) => {
      try {
        const file = await bytesOf(p);
        const ext = file && TYPES[file.type];
        if (!file || !ext || file.buf.length > MAX_BYTES) return null;
        const blob = await put(`hosting/a2a/photo.${ext}`, file.buf, {
          access: "public",
          addRandomSuffix: true,
          contentType: file.type,
        });
        return { url: blob.url, mediaType: file.type };
      } catch {
        return null;
      }
    }),
  );
  return {
    photos: stored.filter((s): s is { url: string; mediaType: string } => !!s),
    skipped: images.length - stored.filter(Boolean).length,
  };
}
