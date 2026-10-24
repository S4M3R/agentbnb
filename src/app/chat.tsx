"use client";

import { useChat } from "@ai-sdk/react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { AgentUIMessage } from "@/lib/agent/tools";

type SearchOutput = Extract<AgentUIMessage["parts"][number], { type: "tool-searchStays"; state: "output-available" }>["output"];
type ListingCard = SearchOutput["results"][number];
type ListingOutput = Extract<AgentUIMessage["parts"][number], { type: "tool-getListing"; state: "output-available" }>["output"];

const SUGGESTIONS = [
  "I just got to Oakland and need a place this weekend",
  "Any cat sits in San Francisco in December?",
  "Find me a farm work exchange in California",
  "What can you search right now?",
];

export function Chat() {
  const { messages, sendMessage, status, stop, error, regenerate } = useChat<AgentUIMessage>();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    sendMessage({ text: t });
    setInput("");
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-background/90 py-4 backdrop-blur">
        <span className="text-sm font-semibold tracking-tight">AgentBnB</span>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-sm text-zinc-500 hover:text-foreground"
          >
            New chat
          </button>
        )}
      </header>

      <main className="flex flex-1 flex-col gap-6 pb-6">
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col justify-center gap-6 py-16">
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight">Where do you need a place to stay?</h1>
              <p className="max-w-lg text-zinc-600 dark:text-zinc-400">
                I search house sits, work exchanges and couches across every marketplace, then help you
                reach out to the host.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full border border-zinc-200 px-3.5 py-1.5 text-sm text-zinc-700 transition-colors hover:border-zinc-400 hover:text-foreground dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-zinc-100 px-4 py-2.5 dark:bg-zinc-800">
                  {m.parts.map((p, i) => (p.type === "text" ? <Fragment key={i}>{p.text}</Fragment> : null))}
                </div>
              </div>
            ) : (
              <div key={m.id} className="flex flex-col gap-3">
                {m.parts.map((p, i) => {
                  const key = `${m.id}-${i}`;
                  switch (p.type) {
                    case "text":
                      return (
                        <div key={key} className="whitespace-pre-wrap leading-relaxed">
                          <RichText text={p.text} />
                        </div>
                      );
                    case "tool-searchStays":
                      if (p.state === "output-available")
                        return <SearchResults key={key} output={p.output} onAsk={send} />;
                      if (p.state === "output-error") return <ToolError key={key} label="Search failed" />;
                      return <ToolPending key={key} label={searchLabel(p.input)} />;
                    case "tool-getListing":
                      if (p.state === "output-available") return <ListingDetail key={key} output={p.output} />;
                      if (p.state === "output-error") return <ToolError key={key} label="Couldn't load listing" />;
                      return <ToolPending key={key} label="Reading the listing…" />;
                    case "tool-getCoverage":
                      if (p.state === "output-error") return <ToolError key={key} label="Couldn't load coverage" />;
                      if (p.state !== "output-available") return <ToolPending key={key} label="Checking coverage…" />;
                      return null;
                    default:
                      return null;
                  }
                })}
              </div>
            ),
          )
        )}

        {status === "submitted" && <ToolPending label="Thinking…" />}
        {error && (
          <div className="flex items-center gap-3 text-sm text-red-600 dark:text-red-400">
            Something went wrong.
            <button type="button" onClick={() => regenerate()} className="underline underline-offset-2">
              Try again
            </button>
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="sticky bottom-0 bg-background pb-4"
      >
        <div className="flex items-end gap-2 rounded-2xl border border-zinc-200 p-2 shadow-sm focus-within:border-zinc-400 dark:border-zinc-800 dark:focus-within:border-zinc-600">
          <textarea
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder="Tell me where and when…"
            className="field-sizing-content max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 outline-none placeholder:text-zinc-400"
          />
          {busy ? (
            <button
              type="button"
              onClick={() => stop()}
              className="rounded-xl bg-zinc-200 px-3.5 py-1.5 text-sm font-medium dark:bg-zinc-800"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="rounded-xl bg-foreground px-3.5 py-1.5 text-sm font-medium text-background disabled:opacity-30"
            >
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function searchLabel(input: { location?: string } | undefined) {
  return input?.location ? `Searching ${input.location}…` : "Searching…";
}

function ToolPending({ label }: { label: string }) {
  return <div className="animate-pulse text-sm text-zinc-500">{label}</div>;
}

function ToolError({ label }: { label: string }) {
  return <div className="text-sm text-red-600 dark:text-red-400">{label}</div>;
}

function SearchResults({ output, onAsk }: { output: SearchOutput; onAsk: (text: string) => void }) {
  if (output.results.length === 0) return <div className="text-sm text-zinc-500">No matches.</div>;
  return (
    <div className="space-y-2">
      <div className="text-xs text-zinc-500">
        Showing {output.results.length} of {output.total} matches
      </div>
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
        {output.results.map((l) => (
          <Card key={l.id} listing={l} onAsk={onAsk} />
        ))}
      </div>
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = {
  house_sit: "House sit",
  work_exchange: "Work exchange",
  farm_stay: "Farm stay",
  couch: "Couch",
  private_room: "Private room",
  shared_room: "Shared room",
  entire_place: "Entire place",
};

function Card({ listing: l, onAsk }: { listing: ListingCard; onAsk: (text: string) => void }) {
  return (
    <article className="flex w-64 shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
      <div className="aspect-[4/3] bg-zinc-100 dark:bg-zinc-900">
        {l.photo && (
          // eslint-disable-next-line @next/next/no-img-element -- third-party listing photos
          <img src={l.photo} alt="" loading="lazy" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3 text-sm">
        <div className="text-xs text-zinc-500">
          {TYPE_LABEL[l.type] ?? l.type} · {l.source.name}
        </div>
        <h3 className="line-clamp-2 font-medium leading-snug">{l.title}</h3>
        <div className="text-zinc-600 dark:text-zinc-400">
          {l.location}
          {l.distanceKm != null && l.distanceKm > 0 && ` · ${l.distanceKm} km`}
        </div>
        {l.dates.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {l.dates.map((d) => (
              <span key={d.start} className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                {formatRange(d.start, d.end)}
              </span>
            ))}
          </div>
        )}
        {l.highlights.length > 0 && (
          <div className="line-clamp-2 text-xs text-zinc-500">{l.highlights.join(" · ")}</div>
        )}
        <div className="mt-auto flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={() => onAsk(`Tell me more about "${l.title}"`)}
            className="text-sm font-medium hover:underline"
          >
            Details
          </button>
          {l.url && (
            <a href={l.url} target="_blank" rel="noreferrer" className="text-xs text-zinc-500 hover:text-foreground">
              Open ↗
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

function ListingDetail({ output }: { output: ListingOutput }) {
  if ("error" in output) return <ToolError label="Listing not found" />;
  return (
    <div className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      {output.photos.length > 0 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1">
          {output.photos.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element -- third-party listing photos
            <img key={src} src={src} alt="" loading="lazy" className="h-28 w-40 shrink-0 rounded-lg object-cover" />
          ))}
        </div>
      )}
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <div className="min-w-0">
          <div className="truncate font-medium">{output.title}</div>
          <div className="text-zinc-500">
            {output.location} · {output.source.name}
            {output.host?.name && ` · hosted by ${output.host.name}`}
          </div>
        </div>
        {output.url && (
          <a
            href={output.url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background"
          >
            Apply on {output.source.name} ↗
          </a>
        )}
      </div>
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatRange(start: string, end: string) {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const s = `${MONTHS[sm - 1]} ${sd}`;
  if (sy !== ey) return `${s}, ${sy} – ${MONTHS[em - 1]} ${ed}, ${ey}`;
  return sm === em ? `${s} – ${ed}` : `${s} – ${MONTHS[em - 1]} ${ed}`;
}

/** Just enough markdown for chat replies: **bold** and links. */
function RichText({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    nodes.push(text.slice(last, m.index));
    const link = "underline underline-offset-2 hover:text-zinc-500";
    if (m[1]) nodes.push(<strong key={m.index}>{m[1]}</strong>);
    else if (m[2])
      nodes.push(
        <a key={m.index} href={m[3]} target="_blank" rel="noreferrer" className={link}>
          {m[2]}
        </a>,
      );
    else
      nodes.push(
        <a key={m.index} href={m[4]} target="_blank" rel="noreferrer" className={link}>
          {m[4]}
        </a>,
      );
    last = m.index + m[0].length;
  }
  nodes.push(text.slice(last));
  return <>{nodes}</>;
}
