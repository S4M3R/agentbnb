"use client";

import { useChat } from "@ai-sdk/react";
import { lastAssistantMessageIsCompleteWithToolCalls, type FileUIPart } from "ai";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { AgentUIMessage } from "@/lib/agent/tools";
import { ListingPreview, NetworkPicker, PublicationCard } from "./hosting";
import { LocationRequest } from "./location-request";
import { PhotoRequest } from "./photo-request";
import { uploadPhoto } from "./photo-upload";

type SearchOutput = Extract<AgentUIMessage["parts"][number], { type: "tool-searchStays"; state: "output-available" }>["output"];
type ListingCard = SearchOutput["results"][number];
type ListingOutput = Extract<AgentUIMessage["parts"][number], { type: "tool-getListing"; state: "output-available" }>["output"];

type Attachment = { id: string; preview: string; file?: FileUIPart; failed?: boolean };

const SUGGESTIONS = [
  "I just got to Oakland and need a place this weekend",
  "Put my place up for this weekend",
  "Any cat sits in San Francisco in December?",
  "Find me a farm work exchange in California",
  "What can you search right now?",
];

export function Chat() {
  const { messages, sendMessage, status, stop, error, regenerate, addToolOutput } = useChat<AgentUIMessage>({
    // askForLocation / askForPhotos are answered in the browser; send once they are.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = status === "submitted" || status === "streaming";
  const uploading = attachments.some((a) => !a.file && !a.failed);
  // Each listing card is a snapshot; only the newest one for a listing keeps its buttons.
  const latestCard = new Map<string, string>();
  for (const m of messages)
    m.parts.forEach((p, i) => {
      if ((p.type === "tool-saveListingDraft" || p.type === "tool-publishListing") && p.state === "output-available")
        if (!("error" in p.output)) latestCard.set(p.output.id, `${m.id}-${i}`);
    });
  const ready = attachments.flatMap((a) => (a.file ? [a.file] : []));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  function send(text: string) {
    const t = text.trim();
    if ((!t && !ready.length) || busy || uploading) return;
    sendMessage({ text: t || "Here are the photos.", files: ready.length ? ready : undefined });
    setInput("");
    attachments.forEach((a) => URL.revokeObjectURL(a.preview));
    setAttachments([]);
  }

  function attach(files: FileList | null) {
    for (const file of Array.from(files ?? []).filter((f) => f.type.startsWith("image/"))) {
      const id = crypto.randomUUID();
      setAttachments((list) => [...list, { id, preview: URL.createObjectURL(file) }]);
      uploadPhoto(file).then(
        ({ url, mediaType, filename }) =>
          setAttachments((list) =>
            list.map((a) => (a.id === id ? { ...a, file: { type: "file", url, mediaType, filename } } : a)),
          ),
        () => setAttachments((list) => list.map((a) => (a.id === id ? { ...a, failed: true } : a))),
      );
    }
    if (fileRef.current) fileRef.current.value = "";
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
                reach out to the host. Got a spare couch? I can list it everywhere for you.
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
                <div className="flex max-w-[80%] flex-col items-end gap-2">
                  {m.parts.some((p) => p.type === "file") && (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {m.parts.map((p, i) =>
                        p.type === "file" && p.mediaType.startsWith("image/") ? (
                          // eslint-disable-next-line @next/next/no-img-element -- user-uploaded Blob photos
                          <img key={i} src={p.url} alt="" className="h-24 w-24 rounded-xl object-cover" />
                        ) : null,
                      )}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap rounded-2xl bg-zinc-100 px-4 py-2.5 dark:bg-zinc-800">
                    {m.parts.map((p, i) => (p.type === "text" ? <Fragment key={i}>{p.text}</Fragment> : null))}
                  </div>
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
                    case "tool-askForLocation":
                      if (p.state === "input-streaming") return <ToolPending key={key} label="Opening the map…" />;
                      if (p.state === "output-error") return <ToolError key={key} label="Couldn't get the location" />;
                      return (
                        <LocationRequest
                          key={key}
                          input={p.input}
                          done={p.state === "output-available" ? p.output : undefined}
                          disabled={m.id !== messages.at(-1)?.id}
                          onDone={(output) =>
                            addToolOutput({ tool: "askForLocation", toolCallId: p.toolCallId, output })
                          }
                        />
                      );
                    case "tool-askForPhotos":
                      if (p.state === "input-streaming") return <ToolPending key={key} label="Making a shot list…" />;
                      if (p.state === "output-error") return <ToolError key={key} label="Couldn't get the photos" />;
                      return (
                        <PhotoRequest
                          key={key}
                          input={p.input}
                          done={p.state === "output-available" ? p.output : undefined}
                          disabled={m.id !== messages.at(-1)?.id}
                          onDone={(output) => addToolOutput({ tool: "askForPhotos", toolCallId: p.toolCallId, output })}
                        />
                      );
                    case "tool-saveListingDraft":
                    case "tool-publishListing":
                      if (p.state === "output-available")
                        return "error" in p.output ? (
                          <ToolError key={key} label={p.output.error} />
                        ) : (
                          <ListingPreview
                            key={key}
                            listing={p.output}
                            onSend={send}
                            stale={latestCard.get(p.output.id) !== key}
                          />
                        );
                      if (p.state === "output-error") return <ToolError key={key} label="Couldn't save the listing" />;
                      return (
                        <ToolPending
                          key={key}
                          label={p.type === "tool-publishListing" ? "Publishing…" : "Writing your listing…"}
                        />
                      );
                    case "tool-recommendNetworks":
                      if (p.state === "output-available")
                        return "error" in p.output ? (
                          <ToolError key={key} label={p.output.error} />
                        ) : (
                          <NetworkPicker key={key} listingId={p.output.listingId} networks={p.output.networks} />
                        );
                      if (p.state === "output-error") return <ToolError key={key} label="Couldn't load networks" />;
                      return <ToolPending key={key} label="Picking networks…" />;
                    case "tool-addToNetworks":
                      if (p.state === "output-available")
                        return "error" in p.output ? (
                          <ToolError key={key} label={p.output.error} />
                        ) : (
                          <div key={key} className="space-y-2">
                            {p.output.publications.map((pub) => (
                              <PublicationCard key={pub.id} initial={pub} />
                            ))}
                          </div>
                        );
                      if (p.state === "output-error") return <ToolError key={key} label="Couldn't start publishing" />;
                      return <ToolPending key={key} label="Opening the sites…" />;
                    case "tool-getMyListings":
                      if (p.state === "output-available")
                        return (
                          <div key={key} className="space-y-3">
                            {p.output.listings.map((l) => (
                              <ListingPreview key={l.id} listing={l} onSend={send} />
                            ))}
                          </div>
                        );
                      if (p.state === "output-error") return <ToolError key={key} label="Couldn't load your listings" />;
                      return <ToolPending key={key} label="Checking your listings…" />;
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
        {/* scroll margin keeps the last message clear of the sticky composer */}
        <div ref={bottomRef} className="scroll-mb-36" />
      </main>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="sticky bottom-0 bg-background pb-4"
      >
        <div className="rounded-2xl border border-zinc-200 p-2 shadow-sm focus-within:border-zinc-400 dark:border-zinc-800 dark:focus-within:border-zinc-600">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-1 pb-2">
              {attachments.map((a) => (
                <div key={a.id} className="relative h-16 w-16 overflow-hidden rounded-lg">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
                  <img
                    src={a.preview}
                    alt=""
                    className={`h-full w-full object-cover ${a.file ? "" : "opacity-50"} ${a.failed ? "grayscale" : ""}`}
                  />
                  {!a.file && !a.failed && (
                    <div className="absolute inset-0 animate-pulse bg-white/30" aria-label="Uploading" />
                  )}
                  {a.failed && (
                    <div className="absolute inset-x-0 bottom-0 bg-red-600 text-center text-[10px] text-white">Failed</div>
                  )}
                  <button
                    type="button"
                    aria-label="Remove photo"
                    onClick={() => {
                      URL.revokeObjectURL(a.preview);
                      setAttachments((list) => list.filter((x) => x.id !== a.id));
                    }}
                    className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-xs text-white"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => attach(e.currentTarget.files)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label="Add photos"
              title="Add photos"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 hover:text-foreground dark:hover:bg-zinc-800"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.2-1.8A1.5 1.5 0 0 1 10.5 3.5h3a1.5 1.5 0 0 1 1.2.7L15.9 6h1.6A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
            </button>
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
              placeholder="Where do you need to stay, or what do you want to list?"
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
                disabled={(!input.trim() && !ready.length) || uploading}
                className="rounded-xl bg-foreground px-3.5 py-1.5 text-sm font-medium text-background disabled:opacity-30"
              >
                Send
              </button>
            )}
          </div>
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
