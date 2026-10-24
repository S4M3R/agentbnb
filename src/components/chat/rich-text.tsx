import type { ReactNode } from "react";
import { SiteIcon } from "@/components/ui/site-name";
import { faviconFor, SITE_MENTIONS } from "@/lib/source-logos";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MENTION = new RegExp(`(?<![\\w-])(${SITE_MENTIONS.map((m) => escape(m.name)).join("|")})(?![\\w-])`, "g");
const MENTION_ID = new Map(SITE_MENTIONS.map((m) => [m.name, m.id]));

/** Plain text with a favicon in front of every site name we know ("found 5 on Workaway"). */
function withSiteIcons(text: string, key: string | number): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION)) {
    nodes.push(text.slice(last, m.index));
    nodes.push(
      <span key={`${key}-${m.index}`} className="whitespace-nowrap">
        <SiteIcon site={MENTION_ID.get(m[1])} size={14} className="mr-1 -mt-0.5 align-middle" />
        {m[1]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  nodes.push(text.slice(last));
  return nodes;
}

/** Just enough markdown for chat replies: **bold** and links, with favicons next to sites we know. */
export function RichText({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)/g;
  const link = "font-medium underline underline-offset-2 hover:text-muted";
  let last = 0;
  for (const m of text.matchAll(re)) {
    nodes.push(...withSiteIcons(text.slice(last, m.index), `t${m.index}`));
    if (m[1])
      nodes.push(
        <strong key={m.index} className="font-semibold">
          {withSiteIcons(m[1], `b${m.index}`)}
        </strong>,
      );
    else {
      const href = m[3] ?? m[4];
      nodes.push(
        <a key={m.index} href={href} target="_blank" rel="noreferrer" className={link}>
          {faviconFor(href) && <SiteIcon site={href} size={14} className="mr-1 -mt-0.5 align-middle" />}
          {m[2] ?? m[4]}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  nodes.push(...withSiteIcons(text.slice(last), "end"));
  return <>{nodes}</>;
}
