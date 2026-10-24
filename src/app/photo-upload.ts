import { upload } from "@vercel/blob/client";

const MAX_EDGE = 1600;

/**
 * Shrink a phone photo to ≤1600px JPEG before upload: faster on mobile data and small enough for
 * the model to look at. Falls back to the original file if the browser can't decode it (HEIC
 * outside Safari).
 */
async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  } catch {
    return file;
  }
}

/** Upload a photo the host attached in the chat (or a profile photo, under `avatars`). Returns its public Blob URL. */
export async function uploadPhoto(file: File, folder: "hosting" | "avatars" = "hosting") {
  const body = await shrink(file);
  const base = file.name.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "-").slice(0, 40) || "photo";
  const ext = body.type === "image/jpeg" ? "jpg" : (file.name.split(".").pop() ?? "jpg");
  const blob = await upload(`${folder}/${base}.${ext}`, body, {
    access: "public",
    handleUploadUrl: "/api/hosting/photos",
    contentType: body.type || file.type,
  });
  return { url: blob.url, mediaType: body.type || file.type, filename: file.name };
}
