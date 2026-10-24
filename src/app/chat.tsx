"use client";

import { useChat, type UseChatHelpers } from "@ai-sdk/react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { lastAssistantMessageIsCompleteWithToolCalls, type FileUIPart } from "ai";
import { Fragment, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AttachmentTray } from "@/components/chat/attachments";
import { AttentionList } from "@/components/chat/attention";
import { Composer } from "@/components/chat/composer";
import { ChatColumn, ComposerDock, Conversation } from "@/components/chat/conversation";
import { CalendarCard } from "@/components/calendar/calendar-card";
import { ConnectAgentBanner } from "@/components/chat/connect-agent";
import { ChatHome } from "@/components/chat/home";
import { AssistantMessage, AssistantText, ToolStatus, UserMessage } from "@/components/chat/messages";
import { RecentChats } from "@/components/chat/recent-chats";
import { StarterCards, type Starter } from "@/components/chat/starter-cards";
import { PROFILE_CHANGED } from "@/components/shell/nav";
import { SidePanel } from "@/components/shell/side-panel";
import { SiteShell } from "@/components/shell/site-shell";
import { toApplyListItem, toStayCard, toStayPanel } from "@/components/stays/adapters";
import { ApplyList, ApplyListDock, ApplyListPill, ApplyListSheet } from "@/components/stays/apply-list";
import { TYPE_LABEL } from "@/components/stays/format";
import { StayLink } from "@/components/stays/stay-link";
import { LiveSearch } from "@/components/stays/search-progress";
import { StayResults } from "@/components/stays/stay-results";
import type { StayDetails } from "@/components/stays/types";
import { Button, ButtonLink } from "@/components/ui/button";
import { SiteIcon } from "@/components/ui/site-name";
import { CheckIcon, ExternalIcon, NewChatIcon } from "@/components/ui/icons";
import type { AgentUIMessage } from "@/lib/agent/tools";
import {
  addToApplyList,
  APPLY_LIST_MAX,
  applyListPrompt,
  clearApplyList,
  getApplyList,
  getServerApplyList,
  removeFromApplyList,
  subscribeApplyList,
  type ApplyListItem,
} from "@/lib/apply-list";
import { CONNECTABLE_AGENTS, connectPrompt, HOME_AGENT_TILES } from "@/lib/connect-agent";
import { useAttention, useChatHistory } from "./chat-history";
import { uploadPhoto } from "./photo-upload";

// Cards and panels that only appear once a conversation needs them load on demand, so the home screen
// hydrates with just the composer and its own sections (the location card alone pulls in MapLibre).
const StayPanel = dynamic(() => import("@/components/stays/stay-panel").then((m) => m.StayPanel));
const ApplicationCards = dynamic(() => import("./application-cards").then((m) => m.ApplicationCards));
const ApplicationPanel = dynamic(() => import("./application-panel").then((m) => m.ApplicationPanel));
const DateRequest = dynamic(() => import("./date-request").then((m) => m.DateRequest));
const LocationRequest = dynamic(() => import("./location-request").then((m) => m.LocationRequest));
const PhotoRequest = dynamic(() => import("./photo-request").then((m) => m.PhotoRequest));
const ListingPreview = dynamic(() => import("./hosting").then((m) => m.ListingPreview));
const NetworkPicker = dynamic(() => import("./hosting").then((m) => m.NetworkPicker));
const PublicationCard = dynamic(() => import("./hosting").then((m) => m.PublicationCard));

// Written for someone who lives in San Francisco: trips out of town, and hosting at home. Photos are
// Unsplash shots, resized and served from /public/starters so the home doesn't wait on a third party.
const STARTERS: Starter[] = [
  {
    title: "Pitching in New York",
    prompt: "Couch in New York next week for investor meetings",
    photo: "/starters/new-york.webp",
  },
  {
    title: "Host for Dreamforce",
    prompt: "Put my Mission spare room up during Dreamforce",
    photo: "/starters/dreamforce.webp",
  },
  {
    title: "Tahoe powder weekend",
    prompt: "Any snowboarders hosting near Tahoe this weekend?",
    photo: "/starters/tahoe.webp",
  },
  {
    title: "Sonoma house sit",
    prompt: "House sit in Sonoma for two weeks, working remote",
    photo: "/starters/sonoma.webp",
  },
];

/** The prompt that connects a personal agent, pointing at whichever host this page is served from. "Any agent" gets the generic guide. */
function promptFor(id: string) {
  return connectPrompt(CONNECTABLE_AGENTS.find((a) => a.id === id), window.location.origin);
}

type Part = AgentUIMessage["parts"][number];

type Attachment = { id: string; preview: string; file?: FileUIPart; failed?: boolean };

/**
 * What the side panel can show: every listing the agent has loaded in this chat (by tool call id)
 * and every application it drafted or sent (by application id), plus the newest of either.
 */
function panelsIn(messages: AgentUIMessage[]) {
  const listings = new Map<string, StayDetails>();
  const applications = new Set<string>();
  let newest: string | null = null;
  for (const m of messages)
    for (const p of m.parts) {
      if (p.type === "tool-getListing" && p.state === "output-available" && !("error" in p.output)) {
        listings.set(p.toolCallId, p.output);
        newest = p.toolCallId;
      }
      const cards =
        p.type === "tool-applyToListings" && p.state === "output-available" && !("error" in p.output)
          ? p.output.drafts
          : p.type === "tool-sendApplications" && p.state === "output-available" && !("error" in p.output)
            ? p.output.applications
            : [];
      cards.forEach((c) => applications.add(c.id));
      newest = cards[0]?.id ?? newest;
    }
  return { listings, applications, newest };
}

export function Chat({ initialMessages }: { initialMessages?: AgentUIMessage[] }) {
  const { messages, setMessages, sendMessage, status, stop, error, regenerate, addToolOutput } =
    useChat<AgentUIMessage>({
      messages: initialMessages,
      // askForDates / askForLocation / askForPhotos are answered in the browser; send once they are.
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    });
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

  // The newest stay the agent loads, or application it drafts, opens in the side panel; the guest
  // can close it or open another.
  const { listings, applications, newest } = panelsIn(messages);
  const [panelId, setPanelId] = useState(newest);
  const [seenNewest, setSeenNewest] = useState(newest);
  if (newest !== seenNewest) {
    setSeenNewest(newest);
    setPanelId(newest);
  }
  const panel = panelId ? listings.get(panelId) : undefined;
  const applicationPanel = panelId && applications.has(panelId) ? panelId : null;

  // Saved conversations (this browser) and what's waiting on the member, for the home screen.
  const showChat = useCallback(
    (next: AgentUIMessage[]) => {
      setMessages(next);
      setPanelId(null);
      setSeenNewest(panelsIn(next).newest); // a reopened chat doesn't pop its last listing open
    },
    [setMessages, setPanelId, setSeenNewest],
  );
  const history = useChatHistory({ enabled: !initialMessages, messages, status, stop, onSwitch: showChat });
  const attention = useAttention(empty);

  // The apply list (this browser): stays picked with "Add to list", applied to in one message. It
  // docks on the right from lg up unless a listing or application has that side; below lg, and
  // whenever it's out of view, a pill brings it up.
  const applyList = useSyncExternalStore(subscribeApplyList, getApplyList, getServerApplyList);
  const inList = new Set(applyList.map((i) => i.id));
  const [listOpen, setListOpen] = useState(false);
  const [listHidden, setListHidden] = useState(false);
  const docked = applyList.length > 0 && !panel && !applicationPanel && !listHidden;

  function showList() {
    if (window.matchMedia("(min-width: 64rem)").matches) {
      setPanelId(null);
      setListHidden(false);
    } else setListOpen(true);
  }

  function toggleInList(item: Omit<ApplyListItem, "addedAt">) {
    if (inList.has(item.id)) return removeFromApplyList(item.id);
    if (addToApplyList(item)) setListHidden(false);
    else showList(); // full: show why
  }

  function applyToList() {
    if (!applyList.length || busy || uploading) return;
    send(applyListPrompt(applyList));
    clearApplyList();
    setListOpen(false);
  }

  const applyListView = (onClose: () => void) => (
    <ApplyList
      items={applyList}
      max={APPLY_LIST_MAX}
      onRemove={removeFromApplyList}
      onApply={applyToList}
      onClear={clearApplyList}
      onClose={onClose}
      disabled={busy || uploading}
    />
  );
  const listPill = (className = "") => (
    <ApplyListPill count={applyList.length} onClick={showList} className={`${docked ? "lg:hidden" : ""} ${className}`} />
  );

  useEffect(() => {
    if (!empty) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status, empty]);

  // When the agent saves the member's profile, the header reloads their name and photo.
  const profileSaves = messages.reduce(
    (n, m) => n + m.parts.filter((p) => p.type === "tool-updateProfile" && p.state === "output-available").length,
    0,
  );
  useEffect(() => {
    if (profileSaves > 0) window.dispatchEvent(new Event(PROFILE_CHANGED));
  }, [profileSaves]);


  function send(text: string) {
    const t = text.trim();
    if ((!t && !ready.length) || busy || uploading) return;
    if (empty) history.started();
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
    history.newChat();
  }

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
    <SiteShell
      onNewChat={newChat}
      actions={
        !empty && (
          <Button variant="ghost" size="sm" onClick={newChat} aria-label="New chat" className="rounded-full max-nav:size-10 max-nav:px-0">
            <NewChatIcon size={17} />
            <span className="max-nav:hidden">New chat</span>
          </Button>
        )
      }
    >
      {history.urlWatcher}
      <Suspense fallback={null}>
        <PromptParam onPrompt={setInput} />
      </Suspense>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => attach(e.currentTarget.files)}
      />
      <ChatColumn>

        {empty ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ChatHome
              activity={applyList.length > 0 && listPill("self-start sm:self-center")}
              greeting="Where to next?"
              subtitle="Tell me where you're going, or put your own place up."
              composer={composer}
              attention={<AttentionList items={attention} />}
              recent={
                <RecentChats
                  chats={history.chats}
                  onOpen={history.openChat}
                  onDelete={history.deleteChat}
                  undo={history.undo}
                />
              }
              starters={<StarterCards starters={STARTERS} onPick={send} />}
              banner={<ConnectAgentBanner agents={HOME_AGENT_TILES} getPrompt={promptFor} />}
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
                  <AssistantMessage
                    key={m.id}
                    live={m.id === messages.at(-1)?.id}
                    mood={busy && m.id === messages.at(-1)?.id ? "thinking" : "idle"}
                  >
                    {m.parts.map((p, i) => {
                      const key = `${m.id}-${i}`;
                      return (
                        <PartView
                          key={key}
                          part={p}
                          send={send}
                          openPanel={panelId}
                          onOpenPanel={setPanelId}
                          stale={(id) => latestCard.get(id) !== key}
                          last={m.id === messages.at(-1)?.id}
                          addToolOutput={addToolOutput}
                          inList={inList}
                          onToggleList={toggleInList}
                        />
                      );
                    })}
                  </AssistantMessage>
                ),
              )}
              {status === "submitted" && (
                <AssistantMessage mood="thinking" live>
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
            {applyList.length > 0 && !listOpen && (
              <div className={`pointer-events-none relative z-10 h-0 ${docked ? "lg:hidden" : ""}`}>
                <div className="absolute inset-x-0 bottom-3 flex justify-center">
                  {listPill("pointer-events-auto")}
                </div>
              </div>
            )}
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
                    <SiteIcon site={panel.source.id} />
                    View on {panel.source.name}
                    <ExternalIcon size={16} />
                  </ButtonLink>
                )}
                <span className="ml-auto flex gap-2">
                  <Button variant="secondary" size="sm" aria-pressed={inList.has(panel.id)} onClick={() => toggleInList(toApplyListItem(panel))}>
                    {inList.has(panel.id) ? (
                      <>
                        <CheckIcon size={16} strokeWidth={2.4} />
                        Added
                      </>
                    ) : (
                      "Add to list"
                    )}
                  </Button>
                  <Button size="sm" onClick={() => send(applyPrompt(panel.title, panel.id))}>
                    Apply now
                  </Button>
                </span>
              </>
            }
          />
        </SidePanel>
      )}
      {applicationPanel && (
        <SidePanel label="Your application" onClose={() => setPanelId(null)}>
          <ApplicationPanel key={applicationPanel} id={applicationPanel} onClose={() => setPanelId(null)} />
        </SidePanel>
      )}
      {docked && <ApplyListDock>{applyListView(() => setListHidden(true))}</ApplyListDock>}
      {listOpen && <ApplyListSheet onClose={() => setListOpen(false)}>{applyListView(() => setListOpen(false))}</ApplyListSheet>}
    </SiteShell>
  );
}

/** What the Apply buttons send; the agent drafts the application from it. */
const applyPrompt = (title: string | null, id: string) => `Apply to "${title ?? "this listing"}" for me (listing ${id})`;

function PartView({
  part: p,
  send,
  openPanel,
  onOpenPanel,
  stale,
  last,
  addToolOutput,
  inList,
  onToggleList,
}: {
  part: Part;
  send: (text: string) => void;
  /** What the side panel shows: a getListing tool call id or an application id. */
  openPanel: string | null;
  onOpenPanel: (id: string) => void;
  /** Whether a newer card for this host listing appears later in the chat. */
  stale: (listingId: string) => boolean;
  /** Whether this part's message is the newest; older browser-answered tools are read-only. */
  last: boolean;
  addToolOutput: UseChatHelpers<AgentUIMessage>["addToolOutput"];
  /** Listing ids on the apply list. */
  inList: Set<string>;
  onToggleList: (item: Omit<ApplyListItem, "addedAt">) => void;
}) {
  switch (p.type) {
    case "text":
      return p.text ? <AssistantText text={p.text} /> : null;
    case "tool-searchStays":
      if (p.state === "output-error") return <ToolStatus failed label="The search failed." />;
      return (
        <LiveSearch done={p.state === "output-available"} location={p.input?.location} sources={p.input?.sources}>
          {p.state === "output-available" && (
            <StayResults
              stays={p.output.results.map(toStayCard)}
              total={p.output.total}
              onOpen={(s) => send(`Tell me more about "${s.title}"`)}
              onApply={(s) => send(applyPrompt(s.title, s.id))}
              inList={inList}
              onAddToList={(s) => {
                const r = p.output.results.find((x) => x.id === s.id);
                if (r) onToggleList(toApplyListItem(r));
              }}
            />
          )}
        </LiveSearch>
      );
    case "tool-getListing":
      if (p.state === "output-available") {
        if ("error" in p.output) return <ToolStatus failed label="That listing is gone." />;
        const l = p.output;
        return (
          <StayLink
            title={l.title ?? "This listing"}
            detail={[l.location, l.source.name].filter(Boolean).join(" · ")}
            photo={l.photos[0]}
            open={openPanel === p.toolCallId}
            onOpen={() => onOpenPanel(p.toolCallId)}
          />
        );
      }
      if (p.state === "output-error") return <ToolStatus failed label="Couldn't load that listing." />;
      return <ToolStatus label="Reading the listing…" />;
    case "tool-askForDates":
      if (p.state === "input-streaming") return <ToolStatus label="Opening the calendar…" />;
      if (p.state === "output-error") return <ToolStatus failed label="Couldn't get the dates." />;
      return (
        <DateRequest
          input={p.input}
          done={p.state === "output-available" ? p.output : undefined}
          disabled={!last}
          onDone={(output) => addToolOutput({ tool: "askForDates", toolCallId: p.toolCallId, output })}
        />
      );
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
        ) : "networks" in p.output && p.output.networks ? (
          // The picker with the networks the agent queued already publishing (a few at a time).
          <NetworkPicker listingId={p.output.listingId} networks={p.output.networks} initialSelected={[]} />
        ) : (
          // Chats saved before the picker showed this result.
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
          <ApplicationCards
            cards={p.output.drafts}
            problems={p.output.problems}
            openId={openPanel}
            onOpen={onOpenPanel}
          />
        );
      if (p.state === "output-error") return <ToolStatus failed label="Couldn't draft the applications." />;
      return <ToolStatus label="Writing your applications…" />;
    case "tool-sendApplications":
      if (p.state === "output-available")
        return "error" in p.output ? (
          <ToolStatus failed label={p.output.error} />
        ) : (
          <ApplicationCards cards={p.output.applications} openId={openPanel} onOpen={onOpenPanel} />
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

/**
 * "Edit in chat" and "Add a place" on /hosting open /?prompt=…: hands the line to the composer
 * once, for the host to finish and send, and drops it from the URL. Inside Suspense, as
 * useSearchParams needs on a prerendered page.
 */
function PromptParam({ onPrompt }: { onPrompt: (text: string) => void }) {
  const prompt = useSearchParams().get("prompt");
  useEffect(() => {
    if (!prompt) return;
    onPrompt(prompt.slice(0, 500));
    const url = new URL(window.location.href);
    url.searchParams.delete("prompt");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [prompt, onPrompt]);
  return null;
}
