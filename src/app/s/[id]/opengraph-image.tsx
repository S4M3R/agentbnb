import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { getShareLink } from "@/lib/share-links";
import { dateRange } from "../../requests/ui";

// The preview image iMessage (and Slack, WhatsApp, ...) shows when someone gets a /s/<id> link:
// the listing's photo, or a mosaic of the picks, with the headline on top. Previews are small on
// a phone, so the text is big and short.

export const alt = "Stays picked by AgentBnB";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const RAUSCH = "#ff385c";
const TYPE_LABEL: Record<string, string> = {
  house_sit: "House sit",
  work_exchange: "Work exchange",
  farm_stay: "Farm stay",
  couch: "Couch",
  private_room: "Private room",
  shared_room: "Shared room",
  entire_place: "Entire place",
};

const fonts = Promise.all(
  [500, 700].map(async (weight) => ({
    name: "Inter",
    data: await readFile(join(process.cwd(), `assets/fonts/Inter-${weight}.ttf`)),
    weight: weight as 500 | 700,
    style: "normal" as const,
  })),
);

/**
 * A listing photo as a data URL, or null. Satori only draws JPEG/PNG/GIF and gives up on the
 * whole image if one fails, so fetch each photo ourselves and drop the ones it can't use.
 */
async function photo(url: string | undefined) {
  if (!url) return null;
  try {
    const res = await fetch(url, {
      headers: { accept: "image/jpeg,image/png;q=0.9,image/gif;q=0.5" },
      signal: AbortSignal.timeout(4000),
    });
    const type = res.headers.get("content-type")?.split(";")[0] ?? "";
    if (!res.ok || !["image/jpeg", "image/png", "image/gif"].includes(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 6_000_000) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function short(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await getShareLink(id);
  const listings = view?.listings ?? [];
  const single = listings.length === 1 ? listings[0] : null;

  // One listing: up to 3 of its photos. Several: each pick's cover.
  const sources = single ? single.photos.slice(0, 3) : listings.slice(0, 3).map((l) => l.photos[0]);
  const photos = (await Promise.all(sources.map(photo))).filter((p): p is string => !!p);

  const title = short(single?.title ?? view?.title ?? "A place to stay", single ? 70 : 60);
  const subtitle = single
    ? [single.location, TYPE_LABEL[single.type] ?? single.type, single.dates[0] && dateRange(single.dates[0].start, single.dates[0].end)]
    : [`${listings.length} stay${listings.length === 1 ? "" : "s"}`, view && dateRange(view.startDate, view.endDate)];
  const meta = subtitle.filter(Boolean).join("  ·  ");
  const sender = view?.agent ? `via ${view.agent.name}` : null;

  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: RAUSCH, fontFamily: "Inter", position: "relative" }}>
        {photos.length > 0 && <Mosaic photos={photos} />}
        {/* Darken the bottom so the headline reads on any photo. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: photos.length ? 380 : 630,
            display: "flex",
            backgroundImage: photos.length ? "linear-gradient(to top, rgba(0,0,0,0.82), rgba(0,0,0,0))" : "none",
          }}
        />
        <div style={{ position: "absolute", top: 36, left: 40, right: 40, display: "flex", justifyContent: "space-between" }}>
          <div
            style={{
              display: "flex",
              background: "white",
              color: RAUSCH,
              fontSize: 34,
              fontWeight: 700,
              letterSpacing: -1,
              padding: "8px 22px 12px",
              borderRadius: 999,
            }}
          >
            agentbnb
          </div>
          {listings.length > 3 && (
            <div style={{ display: "flex", background: "rgba(0,0,0,0.6)", color: "white", fontSize: 28, fontWeight: 700, padding: "10px 22px", borderRadius: 999 }}>
              +{listings.length - 3} more
            </div>
          )}
        </div>
        <div style={{ position: "absolute", left: 48, right: 48, bottom: 44, display: "flex", flexDirection: "column", color: "white" }}>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 700, lineHeight: 1.08, letterSpacing: -1.5 }}>{title}</div>
          {(meta || sender) && (
            <div style={{ display: "flex", marginTop: 18, fontSize: 30, fontWeight: 500, opacity: 0.92 }}>
              {[meta, sender].filter(Boolean).join("  ·  ")}
            </div>
          )}
        </div>
      </div>
    ),
    { ...size, fonts: await fonts },
  );
}

function Mosaic({ photos }: { photos: string[] }) {
  const [first, ...rest] = photos;
  const img = (src: string, w: number, h: number) => (
    // eslint-disable-next-line jsx-a11y/alt-text -- decorative, inside a generated image
    <img src={src} width={w} height={h} style={{ objectFit: "cover", width: w, height: h }} />
  );
  if (!rest.length) return <div style={{ display: "flex", position: "absolute", inset: 0 }}>{img(first, 1200, 630)}</div>;
  if (rest.length === 1)
    return (
      <div style={{ display: "flex", position: "absolute", inset: 0, gap: 6, background: "white" }}>
        {img(first, 597, 630)}
        {img(rest[0], 597, 630)}
      </div>
    );
  return (
    <div style={{ display: "flex", position: "absolute", inset: 0, gap: 6, background: "white" }}>
      {img(first, 776, 630)}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {img(rest[0], 418, 312)}
        {img(rest[1], 418, 312)}
      </div>
    </div>
  );
}
