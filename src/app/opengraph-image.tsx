import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// The card link previews show for agentbnb itself: Couchbot asking where you're headed, next to
// the wordmark and what the product does.

export const alt = "AgentBnB: Couchbot asks “Where to next?”";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const RAUSCH = "#ff385c";
const asset = (path: string) => readFile(join(process.cwd(), "assets", path));

export default async function Image() {
  const [bricolage, inter500, inter700, couchbot] = await Promise.all([
    asset("fonts/BricolageGrotesque-800.ttf"),
    asset("fonts/Inter-500.ttf"),
    asset("fonts/Inter-700.ttf"),
    asset("couchbot.png"),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          padding: "72px 80px",
          background: "radial-gradient(circle at 78% 58%, #ffe3ea 0%, #fff6f8 38%, #ffffff 70%)",
          fontFamily: "Inter",
          color: "#222222",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 640 }}>
          <div style={{ display: "flex", fontFamily: "Bricolage", fontSize: 44, color: RAUSCH, letterSpacing: -1.8 }}>
            agentbnb
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div style={{ display: "flex", fontFamily: "Bricolage", fontSize: 76, lineHeight: 1.02, letterSpacing: -3 }}>
              Your agent for finding a couch, anywhere.
            </div>
            <div style={{ display: "flex", fontSize: 28, lineHeight: 1.4, color: "#6a6a6a" }}>
              Searches Couchsurfing, BeWelcome, Trustroots, house sits and its own hosts at once, then asks for you.
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1 }}>
          <div
            style={{
              display: "flex",
              marginBottom: 6,
              marginLeft: 40,
              padding: "16px 26px",
              borderRadius: 28,
              background: "#ffffff",
              boxShadow: "0 8px 24px rgba(163, 13, 54, 0.16)",
              fontSize: 30,
              fontWeight: 700,
            }}
          >
            Where to next?
          </div>
          <img src={`data:image/png;base64,${couchbot.toString("base64")}`} width={360} height={360} alt="" />
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Bricolage", data: bricolage, weight: 800, style: "normal" },
        { name: "Inter", data: inter500, weight: 500, style: "normal" },
        { name: "Inter", data: inter700, weight: 700, style: "normal" },
      ],
    },
  );
}
