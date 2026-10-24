// Renders the animated link previews for the /setup pages: the agent's app icon and Couchbot
// (AgentBnB) side by side, with a pulse running down the dotted line between them and each tile
// bumping as it lands. One GIF per agent in CONNECTABLE_AGENTS, plus a generic one for /setup.
//
// GIF because it's what link unfurlers handle best: iMessage can play it, and clients that only
// show a still (WhatsApp, most Slack/agent apps) take the first frame, which is the calm,
// fully-linked state. Frames are flat colors over a flat background so they stay small.
//
// Rerun after changing an agent, its icon or the design:
//   pnpm exec tsx tools/setup-previews.tsx
// Writes public/og/setup-<agent id>.gif and public/og/setup.gif.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { ReactNode } from "react";
import sharp from "sharp";
import { CONNECTABLE_AGENTS } from "@/lib/connect-agent";

const W = 1200;
const H = 630;
const FRAMES = 48;
const DELAY_MS = 50;
/** The last frame holds the calm state a moment before the loop starts again (3 s in all). */
const REST_MS = 650;

const RAUSCH = "#ff385c";
const INK = "#222222";
const MUTED = "#6a6a6a";
const BG = "#fff5f7";
const DOT = [244, 199, 209] as const; // a pale Rausch for the resting line
const RAUSCH_RGB = [255, 56, 92] as const;

// Layout: two 176px tiles, a 248px dotted gap between them, all inside the centre square that
// square-cropping clients (WhatsApp's small preview) keep.
const TILE = 176;
const GAP = 248;
const TILE_TOP = 118;
const LEFT_X = (W - GAP) / 2 - TILE;
const RIGHT_X = (W + GAP) / 2;
const DOTS = 7;

const root = process.cwd();
const asset = (path: string) => readFile(join(root, path));
const dataUrl = (buf: Buffer, type: string) => `data:${type};base64,${buf.toString("base64")}`;
const mime = (path: string) => (path.endsWith(".png") ? "image/png" : "image/jpeg");

const clamp = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => {
  const t = clamp(x);
  return t * t * (3 - 2 * t);
};
/** 0 → 1 → 0 over [start, end), for the tile bumps and ripples. */
const bump = (frame: number, start: number, end: number) =>
  frame < start || frame >= end ? 0 : Math.sin(((frame - start) / (end - start)) * Math.PI);
const mix = (a: readonly number[], b: readonly number[], t: number) =>
  `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;

type State = {
  /** Where the pulse is along the line, in dot units (-2 and DOTS + 1 are off the ends). */
  pulse: number;
  leftScale: number;
  rightScale: number;
  /** 0..1 progress of the ring that ripples out from a tile when the pulse lands, or -1. */
  leftRing: number;
  rightRing: number;
};

// 0-5 rest · 6-17 pulse to AgentBnB · 16-23 Couchbot bumps · 24-35 pulse back · 34-41 agent bumps · rest
function state(frame: number): State {
  const out = frame >= 6 && frame < 18 ? ease((frame - 6) / 11) : -1;
  const back = frame >= 24 && frame < 36 ? ease((frame - 24) / 11) : -1;
  const pulse = out >= 0 ? -2 + out * (DOTS + 3) : back >= 0 ? DOTS + 1 - back * (DOTS + 3) : -9;
  return {
    pulse,
    rightScale: 1 + 0.07 * bump(frame, 16, 24),
    leftScale: 1 + 0.07 * bump(frame, 34, 42),
    rightRing: frame >= 16 && frame < 26 ? (frame - 16) / 10 : -1,
    leftRing: frame >= 34 && frame < 44 ? (frame - 34) / 10 : -1,
  };
}

function Ring({ x, progress }: { x: number; progress: number }) {
  if (progress < 0) return null;
  const grow = 10 + progress * 34;
  return (
    <div
      style={{
        position: "absolute",
        left: x - grow,
        top: TILE_TOP - grow,
        width: TILE + grow * 2,
        height: TILE + grow * 2,
        borderRadius: 44 + grow,
        border: `4px solid ${RAUSCH}`,
        opacity: 0.5 * (1 - progress),
        display: "flex",
      }}
    />
  );
}

function Tile({ x, scale, children }: { x: number; scale: number; children: ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: TILE_TOP,
        width: TILE,
        height: TILE,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 44,
        background: "#ffffff",
        boxShadow: "0 12px 32px rgba(163, 13, 54, 0.14)",
        overflow: "hidden",
        transform: `scale(${scale})`,
      }}
    >
      {children}
    </div>
  );
}

function Frame({ s, left, couchbot, title }: { s: State; left: ReactNode; couchbot: string; title: string }) {
  const step = GAP / (DOTS + 1);
  return (
    <div style={{ display: "flex", width: W, height: H, background: BG, position: "relative", fontFamily: "Inter" }}>
      <Ring x={LEFT_X} progress={s.leftRing} />
      <Ring x={RIGHT_X} progress={s.rightRing} />
      {Array.from({ length: DOTS }, (_, i) => {
        const glow = Math.exp(-((i - s.pulse) ** 2) / 1.3);
        const d = 14 + 12 * glow;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: LEFT_X + TILE + step * (i + 1) - d / 2,
              top: TILE_TOP + TILE / 2 - d / 2,
              width: d,
              height: d,
              borderRadius: d,
              background: mix(DOT, RAUSCH_RGB, glow),
              display: "flex",
            }}
          />
        );
      })}
      <Tile x={LEFT_X} scale={s.leftScale}>
        {left}
      </Tile>
      <Tile x={RIGHT_X} scale={s.rightScale}>
        {/* eslint-disable-next-line @next/next/no-img-element -- satori, not the DOM */}
        <img src={couchbot} width={150} height={150} alt="" style={{ marginTop: 6 }} />
      </Tile>
      <div
        style={{
          position: "absolute",
          left: 60,
          right: 60,
          top: 360,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        <div style={{ display: "flex", fontFamily: "Bricolage", fontSize: 60, letterSpacing: -2.2, color: INK }}>{title}</div>
        <div style={{ display: "flex", marginTop: 18, fontSize: 30, fontWeight: 500, color: MUTED }}>
          Paste one line to your agent. It sets everything up.
        </div>
      </div>
    </div>
  );
}

async function main() {
  const [bricolage, inter500, couchbotPng] = await Promise.all([
    asset("assets/fonts/BricolageGrotesque-800.ttf"),
    asset("assets/fonts/Inter-500.ttf"),
    asset("assets/couchbot.png"),
  ]);
  const fonts = [
    { name: "Bricolage", data: bricolage, weight: 800 as const, style: "normal" as const },
    { name: "Inter", data: inter500, weight: 500 as const, style: "normal" as const },
  ];
  const couchbot = dataUrl(couchbotPng, "image/png");
  const icons = Object.fromEntries(
    await Promise.all(
      CONNECTABLE_AGENTS.map(async (a) => [a.id, dataUrl(await asset(join("public", a.icon)), mime(a.icon))] as const),
    ),
  );

  // eslint-disable-next-line @next/next/no-img-element -- satori, not the DOM
  const appIcon = (src: string) => <img src={src} width={TILE} height={TILE} alt="" />;
  // The generic preview: all four agents in one tile.
  const grid = (
    <div style={{ display: "flex", flexWrap: "wrap", width: 132, gap: 12 }}>
      {CONNECTABLE_AGENTS.map((a) => (
        // eslint-disable-next-line @next/next/no-img-element -- satori, not the DOM
        <img key={a.id} src={icons[a.id]} width={60} height={60} alt="" style={{ borderRadius: 15 }} />
      ))}
    </div>
  );

  const variants = [
    ...CONNECTABLE_AGENTS.map((a) => ({ file: `setup-${a.id}.gif`, title: `Connect ${a.name} to AgentBnB`, left: appIcon(icons[a.id]) })),
    { file: "setup.gif", title: "Connect your agent to AgentBnB", left: grid },
  ];

  await mkdir(join(root, "public/og"), { recursive: true });
  for (const v of variants) {
    const frames: Buffer[] = [];
    for (let f = 0; f < FRAMES; f++) {
      const res = new ImageResponse(<Frame s={state(f)} left={v.left} couchbot={couchbot} title={v.title} />, {
        width: W,
        height: H,
        fonts,
      });
      frames.push(Buffer.from(await res.arrayBuffer()));
    }
    const gif = await sharp(frames, { join: { animated: true } })
      .gif({ loop: 0, delay: Array.from({ length: FRAMES }, (_, f) => (f === FRAMES - 1 ? REST_MS : DELAY_MS)), effort: 10, dither: 0, interFrameMaxError: 6, reuse: true })
      .toBuffer();
    await writeFile(join(root, "public/og", v.file), gif);
    console.log(`public/og/${v.file}  ${FRAMES} frames  ${(gif.length / 1024).toFixed(0)} KB`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
