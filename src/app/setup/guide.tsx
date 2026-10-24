import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PageShell } from "@/components/shell/page-shell";
import { connectPrompt, setupPath, type ConnectableAgent } from "@/lib/connect-agent";
import { setupGuide, type GuideBlock } from "@/lib/setup-guide";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { ConnectIllustration } from "./connect-illustration";
import { CopyPrompt } from "./copy-prompt";

// The /setup pages, one per agent plus a generic one. Two readers: a person, who only needs the
// prompt at the top, and their agent, who fetches the same URL and reads the steps below. Agents'
// fetch tools usually turn HTML into text, so the steps are plain server-rendered HTML (headings,
// an ordered list, <pre> blocks) with no client JS in the way. The steps come from
// src/lib/setup-guide.ts, which also renders /setup.md.

export function setupMetadata(agent: ConnectableAgent | undefined): Metadata {
  const name = agent?.name ?? "your agent";
  const title = `Connect ${name} to ${SITE_NAME}`;
  const description = `Paste one line to ${name} and it signs you up for ${SITE_NAME}: it can find you a couch or host travelers for you. This page has the steps it follows.`;
  const path = setupPath(agent);
  const image = {
    url: `/og/setup${agent ? `-${agent.id}` : ""}.gif`,
    width: 1200,
    height: 630,
    type: "image/gif",
    alt: `${agent ? `${agent.name}'s icon` : "Agent icons"} linking up with Couchbot, the ${SITE_NAME} mark`,
  };
  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: path,
      types: { "text/markdown": `/setup.md${agent ? `?agent=${agent.id}` : ""}` },
    },
    openGraph: { type: "website", siteName: SITE_NAME, url: path, title, description, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export function SetupPage({ agent }: { agent: ConnectableAgent | undefined }) {
  const guide = setupGuide(SITE_URL, agent);
  const name = agent?.name ?? "your agent";

  return (
    <PageShell>
      <article className="pt-4 nav:pt-6">
        <header className="flex flex-col items-center pb-10 text-center sm:pb-12">
          <ConnectIllustration agent={agent} />
          <h1 className="mt-8 text-[28px] font-bold leading-tight tracking-[-0.01em] sm:text-[32px]">
            Connect {agent ? agent.name : "your agent"} to {SITE_NAME}
          </h1>
          <p className="mt-2 max-w-md text-[15px] leading-relaxed text-muted sm:text-base">
            This page is for {name}. You only need to paste the prompt below into {agent ? agent.name : "it"}; it
            follows the steps and asks you for anything it needs.
          </p>
          <CopyPrompt agentId={agent?.id} prompt={connectPrompt(agent, SITE_URL)} />
        </header>

        <section aria-labelledby="steps-title" className="border-t border-hairline-soft pt-10">
          <h2 id="steps-title" className="text-[22px] font-semibold tracking-[-0.02em]">
            {guide.title}
            {agent && <span className="text-muted"> with {agent.name}</span>}
          </h2>
          <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-body">
            {guide.intro.map((block, i) => (
              <Block key={i} block={block} />
            ))}
          </div>

          <ol className="mt-10 space-y-10 [counter-reset:step]">
            {guide.steps.map((step, i) => (
              <li key={step.title} id={`step-${i + 1}`} className="relative scroll-mt-24 pl-12 [counter-increment:step]">
                <span
                  aria-hidden="true"
                  className="absolute top-0 left-0 flex size-8 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white before:content-[counter(step)]"
                />
                <h3 className="pt-1 text-[18px] font-semibold leading-snug">{step.title}</h3>
                <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-body">
                  {step.blocks.map((block, j) => (
                    <Block key={j} block={block} />
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </section>
      </article>
    </PageShell>
  );
}

function Block({ block }: { block: GuideBlock }) {
  switch (block.type) {
    case "p":
      return (
        <p>
          <Inline text={block.text} />
        </p>
      );
    case "list":
      return (
        <ul className="list-disc space-y-1.5 pl-5 marker:text-muted">
          {block.items.map((item) => (
            <li key={item}>
              <Inline text={item} />
            </li>
          ))}
        </ul>
      );
    case "code":
      return (
        <pre className="overflow-x-auto rounded-card border border-hairline bg-surface-soft p-4 text-[13px] leading-[1.6] text-ink">
          <code className={`language-${block.lang}`}>{block.code}</code>
        </pre>
      );
    case "table":
      return (
        <div className="overflow-x-auto rounded-card border border-hairline">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-soft">
              <tr>
                {block.head.map((cell) => (
                  <th key={cell} scope="col" className="px-4 py-2.5 font-semibold">
                    <Inline text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row[0]} className="border-t border-hairline-soft">
                  {row.map((cell, i) => (
                    <td key={i} className="px-4 py-2.5 align-top">
                      <Inline text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

const INLINE = /(\*\*.+?\*\*|`[^`]+`|https?:\/\/[^\s`]+)/g;

/** The guide's Markdown inline subset: **bold**, `code` and bare URLs (trailing punctuation left out). */
function Inline({ text }: { text: string }): ReactNode {
  return text.split(INLINE).map((part, i) => {
    if (i % 2 === 0) return part;
    if (part.startsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-ink">
          <Inline text={part.slice(2, -2)} />
        </strong>
      );
    }
    if (part.startsWith("`")) {
      return (
        <code key={i} className="rounded-[6px] bg-surface-strong px-1.5 py-0.5 text-[0.88em] text-ink">
          {part.slice(1, -1)}
        </code>
      );
    }
    const url = part.replace(/[.,;:)]+$/, "");
    return (
      <span key={i}>
        <a href={url} className="font-medium text-ink underline decoration-hairline underline-offset-2 hover:decoration-ink">
          {url}
        </a>
        {part.slice(url.length)}
      </span>
    );
  });
}
