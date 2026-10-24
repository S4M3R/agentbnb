"use client";

import { useChat, type UseChatHelpers } from "@ai-sdk/react";
import { lastAssistantMessageIsCompleteWithToolCalls, type FileUIPart } from "ai";
import { Fragment, useEffect, useRef, useState } from "react";
import { AttachmentTray } from "@/components/chat/attachments";
import { Composer } from "@/components/chat/composer";
import { ChatColumn, ComposerDock, Conversation } from "@/components/chat/conversation";
import { CalendarCard } from "@/components/calendar/calendar-card";
import { ChatHome } from "@/components/chat/home";
import { AssistantMessage, AssistantText, ToolStatus, UserMessage } from "@/components/chat/messages";
import { StarterCards, type Starter } from "@/components/chat/starter-cards";
import { AppShell } from "@/components/shell/app-shell";
import { SidePanel } from "@/components/shell/side-panel";
import { Sidebar } from "@/components/shell/sidebar";
import { TopBar } from "@/components/shell/top-bar";
import { toStayCard, toStayPanel } from "@/components/stays/adapters";
import { TYPE_LABEL } from "@/components/stays/format";
import { StayLink } from "@/components/stays/stay-link";
import { StayPanel } from "@/components/stays/stay-panel";
import { StayResults } from "@/components/stays/stay-results";
import type { StayDetails } from "@/components/stays/types";
import { Button, ButtonLink } from "@/components/ui/button";
import { ExternalIcon, NewChatIcon } from "@/components/ui/icons";
import type { AgentUIMessage } from "@/lib/agent/tools";
import { ApplicationCards } from "./application-cards";
import { ListingPreview, NetworkPicker, PublicationCard } from "./hosting";
import { LocationRequest } from "./location-request";
import { navItems, useUnreadApplications } from "./nav";
import { PhotoRequest } from "./photo-request";
import { uploadPhoto } from "./photo-upload";

const unsplash = (id: string) => `https://images.unsplash.com/photo-${id}?w=600&q=70&auto=format&fit=crop`;

const STARTERS: Starter[] = [
  {
    title: "A couch tonight",
    prompt: "I just got to Oakland and need a place this weekend",
    photo: unsplash("1555041469-a586c61ea9bc"),
  },
  {
    title: "Host this weekend",
    prompt: "Put my place up for this weekend",
    photo: unsplash("1505693416388-ac5ce068fe85"),
  },
  {
    title: "Sit a cat",
    prompt: "Any cat sits in San Francisco in December?",
    photo: unsplash("1514888286974-6c03e2ca1dba"),
  },
  {
    title: "Work on a farm",
    prompt: "Find me a farm work exchange in California",
    photo: unsplash("1500382017468-9049fed747ef"),
  },
];

type Part = AgentUIMessage["parts"][number];

type Attachment = { id: string; preview: string; file?: FileUIPart; failed?: boolean };

/** Every listing the agent has loaded in this chat, by tool call id. */
function listingsIn(messages: AgentUIMessage[]) {
  const found = new Map<string, StayDetails>();
  for (const m of messages)
    for (const p of m.parts)
      if (p.type === "tool-getListing" && p.state === "output-available" && !("error" in p.output))
        found.set(p.toolCallId, p.output);
  return found;
}

export function Chat({ initialMessages }: { initialMessages?: AgentUIMessage[] }) {
  const { messages, setMessages, sendMessage, status, stop, error, regenerate, addToolOutput } =
    useChat<AgentUIMessage>({
      messages: initialMessages,
      // askForLocation / askForPhotos are answered in the browser; send once they are.
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    });
  const unread = useUnreadApplications();
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = status === "submitted" || status === "streaming";
  const empty = messages.length === 0;
  const uploading = attachments.some((a) => !a.file && !a.failed);
  const ready = attachments.flatMap((a) => (a.file ? [a.file] : []));

  // Each host listing card is a snapshot; only the newest one for a listing keeps its buttons.
  const latestCard = new Map<string, string>();
  for (const m of messages)
    m.parts.forEach((p, i) => {
      if ((p.type === "tool-saveListingDraft" || p.type === "tool-publishListing") && p.state === "output-available")
        if (!("error" in p.output)) latestCard.set(p.output.id, `${m.id}-${i}`);
    });

  // The newest stay the agent loads opens in the side panel; the guest can close it or open another.
  const listings = listingsIn(messages);
  const newest = [...listings.keys()].at(-1) ?? null;
  const [panelId, setPanelId] = useState(newest);
  const [seenNewest, setSeenNewest] = useState(newest);
  if (newest !== seenNewest) {
    setSeenNewest(newest);
    setPanelId(newest);
  }
  const panel = panelId ? listings.get(panelId) : undefined;

  useEffect(() => {
    if (!empty) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status, empty]);

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

  function removeAttachment(id: string) {
    setAttachments((list) =>
      list.filter((a) => {
        if (a.id === id) URL.revokeObjectURL(a.preview);
        return a.id !== id;
      }),
    );
  }

  function newChat() {
    stop();
    setMessages([]);
    setPanelId(null);
  }

  const firstQuestion = messages.find((m) => m.role === "user")?.parts.find((p) => p.type === "text")?.text;

  const composer = (
    <Composer
      value={input}
      onChange={setInput}
      onSubmit={() => send(input)}
      onStop={stop}
      busy={busy}
      large={empty}
      autoFocus={empty}
      placeholder={empty ? "Where do you need to stay, or what do you want to list?" : "Ask a follow-up…"}
      onAttach={() => fileRef.current?.click()}
      canSend={(Boolean(input.trim()) || ready.length > 0) && !uploading}
      attachments={
        attachments.length > 0 && (
          <AttachmentTray
            items={attachments.map((a) => ({
              id: a.id,
              preview: a.preview,
              state: a.failed ? "failed" : a.file ? "ready" : "uploading",
            }))}
            onRemove={removeAttachment}
          />
        )
      }
    />
  );

  return (
    <AppShell sidebar={<Sidebar onNewChat={newChat} nav={navItems(unread)} />}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => attach(e.currentTarget.files)}
      />
      <ChatColumn>
        <TopBar
          title={firstQuestion}
          actions={
            !empty && (
              <Button variant="ghost" size="sm" onClick={newChat} aria-label="New chat" className="max-sm:px-3">
                <NewChatIcon size={16} />
                <span className="max-sm:hidden">New chat</span>
              </Button>
            )
          }
        />

        {empty ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ChatHome
              greeting="Where to next?"
              subtitle="Tell me where you're going, or put your own place up."
              composer={composer}
              starters={<StarterCards starters={STARTERS} onPick={send} />}
            />
          </div>
        ) : (
          <>
            <Conversation endRef={bottomRef}>
              {messages.map((m) =>
                m.role === "user" ? (
                  <UserMessage
                    key={m.id}
                    photos={m.parts.flatMap((p) =>
                      p.type === "file" && p.mediaType.startsWith("image/") ? [p.url] : [],
                    )}
                  >
                    {m.parts.map((p, i) => (p.type === "text" ? <Fragment key={i}>{p.text}</Fragment> : null))}
                  </UserMessage>
                ) : (
                  <AssistantMessage key={m.id}>
                    {m.parts.map((p, i) => {
                      const key = `${m.id}-${i}`;
                      return (
                        <PartView
                          key={key}
                          part={p}
                          send={send}
                          openListing={panelId}
                          onOpenListing={setPanelId}
                          stale={(id) => latestCard.get(id) !== key}
                          last={m.id === messages.at(-1)?.id}
                          addToolOutput={addToolOutput}
                        />
                      );
                    })}
                  </AssistantMessage>
                ),
              )}
              {status === "submitted" && (
                <AssistantMessage>
                  <ToolStatus label="Thinking…" />
                </AssistantMessage>
              )}
              {error && (
                <div className="flex items-center gap-3 text-sm text-error">
                  Something went wrong.
                  <button type="button" onClick={() => regenerate()} className="font-medium underline underline-offset-2">
                    Try again
                  </button>
                </div>
              )}
            </Conversation>
            <ComposerDock note="Your agent can get things wrong. Check the details on the host's listing.">
              {composer}
            </ComposerDock>
          </>
        )}
      </ChatColumn>

      {panel && (
        <SidePanel label={panel.title ?? "Listing"} onClose={() => setPanelId(null)}>
          <StayPanel
            stay={toStayPanel(panel)}
            label={[TYPE_LABEL[panel.type] ?? panel.type, panel.source.name].join(" · ")}
            onClose={() => setPanelId(null)}
            footer={
              <>
                {panel.url && (
                  <ButtonLink href={panel.url} variant="secondary" size="sm">
                    View on {panel.source.name}
                    <ExternalIcon size={16} />
                  </ButtonLink>
                )}
                <Button size="sm" onClick={() => send(applyPrompt(panel.title, panel.id))}>
                  Apply
                </Button>
              </>
            }
          />
        </SidePanel>
      )}
    </AppShell>
  );
}

/** What the Apply buttons send; the agent drafts the application from it. */
const applyPrompt = (title: string | null, id: string) => `Apply to "${title ?? "this listing"}" for me (listing ${id})`;

function PartView({
  part: p,
  send,
  openListing,
  onOpenListing,
  stale,
  last,
  addToolOutput,
}: {
  part: Part;
  send: (text: string) => void;
  openListing: string | null;
  onOpenListing: (toolCallId: string) => void;
  /** Whether a newer card for this host listing appears later in the chat. */
  stale: (listingId: string) => boolean;
  /** Whether this part's message is the newest; older browser-answered tools are read-only. */
  last: boolean;
  addToolOutput: UseChatHelpers<AgentUIMessage>["addToolOutput"];
}) {
  switch (p.type) {
    case "text":
      return p.text ? <AssistantText text={p.text} /> : null;
    case "tool-searchStays":
      if (p.state === "output-available")
        return (
          <StayResults
            stays={p.output.results.map(toStayCard)}
            total={p.output.total}
            onOpen={(s) => send(`Tell me more about "${s.title}"`)}
            onApply={(s) => send(applyPrompt(s.title, s.id))}
          />
        );
      if (p.state === "output-error") return <ToolStatus failed label="The search failed." />;
      return <ToolStatus label={p.input?.location ? `Searching ${p.input.location}…` : "Searching…"} />;
    case "tool-getListing":
      if (p.state === "output-available") {
        if ("error" in p.output) return <ToolStatus failed label="That listing is gone." />;
        const l = p.output;
        return (
          <StayLink
            title={l.title ?? "This listing"}
            detail={[l.location, l.source.name].filter(Boolean).join(" · ")}
            photo={l.photos[0]}
            open={openListing === p.toolCallId}
            onOpen={() => onOpenListing(p.toolCallId)}
          />
        );
      }
      if (p.state === "output-error") return <ToolStatus failed label="Couldn't load that listing." />;
      return <ToolStatus label="Reading the listing…" />;
    case "tool-askForLocation":
      if (p.state === "input-streaming") return <ToolStatus label="Opening the map…" />;
      if (p.state === "output-error") return <ToolStatus failed label="Couldn't get the location." />;
      return (
        <LocationRequest
          input={p.input}
          done={p.state === "output-available" ? p.output : undefined}
          disabled={!last}
          onDone={(output) => addToolOutput({ tool: "askForLocation", toolCallId: p.toolCallId, output })}
        />
      );
    case "tool-askForPhotos":
      if (p.state === "input-streaming") return <ToolStatus label="Making a shot list…" />;
      if (p.state === "output-error") return <ToolStatus failed label="Couldn't get the photos." />;
      return (
        <PhotoRequest
          input={p.input}
          done={p.state === "output-available" ? p.output : undefined}
          disabled={!last}
          onDone={(output) => addToolOutput({ tool: "askForPhotos", toolCallId: p.toolCallId, output })}
        />
      );
    case "tool-saveListingDraft":
    case "tool-publishListing":
      if (p.state === "output-available")
        return "error" in p.output ? (
          <ToolStatus failed label={p.output.error} />
        ) : (
          <ListingPreview listing={p.output} onSend={send} stale={stale(p.output.id)} />
        );
      if (p.state === "output-error") return <ToolStatus failed label="Couldn't save the listing." />;
      return <ToolStatus label={p.type === "tool-publishListing" ? "Publishing…" : "Writing your listing…"} />;
    case "tool-recommendNetworks":
      if (p.state === "output-available")
        return "error" in p.output ? (
          <ToolStatus failed label={p.output.error} />
        ) : (
          <NetworkPicker listingId={p.output.listingId} networks={p.output.networks} />
        );
      if (p.state === "output-error") return <ToolStatus failed label="Couldn't load networks." />;
      return <ToolStatus label="Picking networks…" />;
    case "tool-addToNetworks":
      if (p.state === "output-available")
        return "error" in p.output ? (
          <ToolStatus failed label={p.output.error} />
        ) : (
          <div className="space-y-2">
            {p.output.publications.map((pub) => (
              <PublicationCard key={pub.id} initial={pub} />
            ))}
          </div>
        );
      if (p.state === "output-error") return <ToolStatus failed label="Couldn't start publishing." />;
      return <ToolStatus label="Opening the sites…" />;
    case "tool-getMyListings":
      if (p.state === "output-available")
        return (
          <div className="space-y-3">
            {p.output.listings.map((l) => (
              <ListingPreview key={l.id} listing={l} onSend={send} />
            ))}
          </div>
        );
      if (p.state === "output-error") return <ToolStatus failed label="Couldn't load your listings." />;
      return <ToolStatus label="Checking your listings…" />;
    case "tool-applyToListings":
      if (p.state === "output-available")
        return "error" in p.output ? (
          <ToolStatus failed label={p.output.error} />
        ) : (
          <ApplicationCards cards={p.output.drafts} problems={p.output.problems} />
        );
      if (p.state === "output-error") return <ToolStatus failed label="Couldn't draft the applications." />;
      return <ToolStatus label="Writing your applications…" />;
    case "tool-sendApplications":
      if (p.state === "output-available")
        return "error" in p.output ? (
          <ToolStatus failed label={p.output.error} />
        ) : (
          <ApplicationCards cards={p.output.applications} />
        );
      if (p.state === "output-error") return <ToolStatus failed label="Couldn't send." />;
      return <ToolStatus label="Sending…" />;
    case "tool-getMyApplications":
      if (p.state === "output-error") return <ToolStatus failed label="Couldn't load your applications." />;
      if (p.state !== "output-available") return <ToolStatus label="Checking your applications…" />;
      return null;
    case "tool-getMyCalendar":
      if (p.state === "output-available")
        return <CalendarCard data={p.output.data} month={p.output.month} side={p.output.side} />;
      if (p.state === "output-error") return <ToolStatus failed label="Couldn't load your calendar." />;
      return <ToolStatus label="Checking your calendar…" />;
    case "tool-getCoverage":
      if (p.state === "output-error") return <ToolStatus failed label="Couldn't check coverage." />;
      if (p.state !== "output-available") return <ToolStatus label="Checking what I can search…" />;
      return null;
    default:
      return null;
  }
}
