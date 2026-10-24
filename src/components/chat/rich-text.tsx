import type { ReactNode } from "react";

/** Just enough markdown for chat replies: **bold** and links. */
export function RichText({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)/g;
  const link = "font-medium underline underline-offset-2 hover:text-muted";
  let last = 0;
  for (const m of text.matchAll(re)) {
    nodes.push(text.slice(last, m.index));
    if (m[1]) nodes.push(<strong key={m.index} className="font-semibold">{m[1]}</strong>);
    else
      nodes.push(
        <a key={m.index} href={m[3] ?? m[4]} target="_blank" rel="noreferrer" className={link}>
          {m[2] ?? m[4]}
        </a>,
      );
    last = m.index + m[0].length;
  }
  nodes.push(text.slice(last));
  return <>{nodes}</>;
}
