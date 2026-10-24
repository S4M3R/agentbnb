import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Fetches a public web page for the background-check agent and turns it into plain text. Only
// public http(s) pages: no cookies, no private network addresses, a few redirects at most.

const MAX_BYTES = 1_500_000;
const MAX_TEXT = 8000;
const TIMEOUT_MS = 12_000;
const USER_AGENT = "Mozilla/5.0 (compatible; AgentBnB-check/1.0; +https://agentbnb.vercel.app/docs.md)";

export type PageResult =
  | {
      ok: true;
      url: string;
      title: string | null;
      description: string | null;
      /** Profile photo or share image, when the page declares one. */
      image: string | null;
      text: string;
      truncated: boolean;
      /** The page only showed a sign-in wall. */
      loginRequired: boolean;
    }
  | { ok: false; url: string; error: string };

function isPrivateAddress(ip: string) {
  if (ip.includes(":")) {
    const v6 = ip.toLowerCase();
    if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
    return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

async function assertPublic(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http(s) pages can be read.");
  if (url.username || url.password) throw new Error("URLs with credentials aren't allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new Error("That address isn't public.");
  }
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error("That address isn't public.");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(s: string) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function meta(html: string, ...names: string[]) {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`,
      "i",
    );
    const m = html.match(re);
    const v = m?.[1] ?? m?.[2];
    if (v?.trim()) return decode(v.trim());
  }
  return null;
}

export function htmlToText(html: string) {
  return decode(
    html
      .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/header|\/footer)[^>]*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n• ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const LOGIN_HINT = /\b(log ?in|sign ?in|sign up|create an account|join now)\b/i;

export async function readPage(rawUrl: string): Promise<PageResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, url: rawUrl, error: "Not a valid URL." };
  }

  try {
    let res: Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      await assertPublic(url);
      res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain;q=0.9" },
      });
      const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!next) break;
      url = new URL(next, url);
      res = null;
    }
    if (!res) return { ok: false, url: url.href, error: "Too many redirects." };
    if (!res.ok) return { ok: false, url: url.href, error: `The page answered ${res.status}.` };

    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|xhtml|text\/plain|json/i.test(type)) {
      return { ok: false, url: url.href, error: `Not a web page (${type || "unknown type"}).` };
    }

    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
    }
    const body = new TextDecoder().decode(Buffer.concat(chunks));
    const isHtml = /html/i.test(type);
    const text = isHtml ? htmlToText(body) : body.trim();
    const title = isHtml ? decode(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "") || null : null;
    const image = isHtml ? meta(body, "og:image", "twitter:image") : null;
    const loginRequired =
      /\/(login|signin|sign-in|auth)\b/i.test(url.pathname) || (text.length < 1500 && LOGIN_HINT.test(text));

    return {
      ok: true,
      url: url.href,
      title,
      description: isHtml ? meta(body, "description", "og:description") : null,
      image: image ? new URL(image, url).href : null,
      text: text.slice(0, MAX_TEXT),
      truncated: text.length > MAX_TEXT,
      loginRequired,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, url: url.href, error: message.includes("aborted") ? "The page took too long." : message };
  }
}
