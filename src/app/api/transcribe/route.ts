import { openai } from "@ai-sdk/openai";
import { transcribe } from "ai";

// Speech to text for the chat composer's mic. The browser records a short clip (MediaRecorder:
// webm/opus on Chrome and Firefox, mp4/aac on Safari) and posts the raw bytes here; the text goes
// back into the composer for the person to check before sending.
// POST /api/transcribe   body: audio bytes, content-type: audio/*

export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024; // ~2 minutes of opus; under Vercel's 4.5 MB request limit

// Names the model should spell right when it hears them.
const PROMPT =
  "AgentBnB: couches, spare rooms, house sits, work exchanges, home swaps. Workaway, TrustedHousesitters, " +
  "Couchsurfing, HomeExchange, Worldpackers, WWOOF, Airbnb. San Francisco, Oakland, Lake Merritt, Tahoe, Sonoma.";

const fail = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status });

export async function POST(req: Request) {
  // Only our own pages may spend transcription minutes.
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) {
    return fail(403, "FORBIDDEN_ORIGIN", "Dictation only works on AgentBnB.");
  }
  if (!process.env.OPENAI_API_KEY) return fail(503, "UNAVAILABLE", "Dictation isn't set up.");

  const type = req.headers.get("content-type") ?? "";
  if (!type.startsWith("audio/")) return fail(415, "UNSUPPORTED_MEDIA", "Send the recording as audio/*.");
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return fail(413, "TOO_LONG", "That recording is too long. Keep it under 2 minutes.");

  const audio = new Uint8Array(await req.arrayBuffer());
  if (audio.byteLength > MAX_BYTES) return fail(413, "TOO_LONG", "That recording is too long. Keep it under 2 minutes.");
  if (audio.byteLength < 1000) return Response.json({ text: "" }); // a tap with nothing said

  try {
    const { text } = await transcribe({
      model: openai.transcription("gpt-4o-transcribe"),
      audio,
      providerOptions: { openai: { prompt: PROMPT } },
      abortSignal: req.signal,
    });
    return Response.json({ text: text.trim() });
  } catch (err) {
    console.error("transcribe failed", err);
    return fail(502, "TRANSCRIBE_FAILED", "Couldn't make out that recording. Try again.");
  }
}
