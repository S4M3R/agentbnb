"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarCard } from "@/components/calendar/calendar-card";
import { CalendarView } from "@/components/calendar/calendar-view";
import { Composer, ComposerTool } from "@/components/chat/composer";
import { ChatColumn, ComposerDock, Conversation } from "@/components/chat/conversation";
import { ActivityPill, ChatHome } from "@/components/chat/home";
import { MatchFilters } from "@/components/chat/match-filters";
import { AssistantMessage, AssistantText, SystemNote, UserMessage } from "@/components/chat/messages";
import { SearchTrace } from "@/components/chat/search-trace";
import { StarterCards } from "@/components/chat/starter-cards";
import { Suggestions } from "@/components/chat/suggestions";
import { NightsPill } from "@/components/nights/nights";
import { ConfirmStayCard, StayConfirmed } from "@/components/requests/confirm-stay";
import { RequestTracker } from "@/components/requests/request-tracker";
import { TripCard } from "@/components/requests/trip-card";
import type { StayRequest } from "@/components/requests/types";
import { AppShell } from "@/components/shell/app-shell";
import { SidePanel } from "@/components/shell/side-panel";
import { Sidebar, type SidebarNavItem } from "@/components/shell/sidebar";
import { TopBar } from "@/components/shell/top-bar";
import { CalendarPage } from "../../calendar/shell";
import { ExternalMatches } from "@/components/stays/external-matches";
import { StayLink } from "@/components/stays/stay-link";
import { StayPanel } from "@/components/stays/stay-panel";
import { StayResults } from "@/components/stays/stay-results";
import { Button } from "@/components/ui/button";
import { CalendarIcon, HomeIcon, MoonIcon, SearchIcon, ShareIcon, SuitcaseIcon, UsersIcon } from "@/components/ui/icons";
import * as data from "./fixtures";
import { screenHref, type Screen } from "./fixtures";

const NAV: SidebarNavItem[] = [
  { label: "Search chats", href: "#", icon: <SearchIcon size={18} strokeWidth={1.9} /> },
  { label: "Trips", href: screenHref("requests"), icon: <SuitcaseIcon size={18} strokeWidth={1.9} />, count: 3 },
  { label: "Hosting", href: "#", icon: <HomeIcon size={18} strokeWidth={1.9} />, alert: "1 request" },
  { label: "Calendar", href: screenHref("calendar"), icon: <CalendarIcon size={18} strokeWidth={1.9} /> },
];

const noop = () => {};

/** The design screens with sample data: one shell, the sidebar filled in, and each screen's turns. */
export function DesignScreen({ screen }: { screen: Screen }) {
  const router = useRouter();
  const go = (s: Screen) => router.push(screenHref(s));
  const [arrival, setArrival] = useState<string | null>(null);

  const requests: StayRequest[] = arrival
    ? data.requests.map((r, i) =>
        i === 0
          ? { ...r, status: "confirmed", note: `Arriving ${arrival} on Fri 30 Oct.`, noteFrom: "agent", timeLeft: undefined }
          : { ...r, status: "withdrawn", note: "I told her you found a place.", noteFrom: "agent", timeLeft: undefined },
      )
    : data.requests;
  const nights = arrival ? { ...data.nights, balance: data.nights.balance - 2 } : data.nights;

  return (
    <AppShell
      sidebar={
        <Sidebar
          onNewChat={() => go("home")}
          nav={NAV}
          requests={{ items: requests, limit: 3, href: screenHref("requests") }}
          chats={data.chats}
          activeChatId={screen === "home" ? undefined : "lisbon"}
          nights={nights}
          user={data.user}
        />
      }
    >
      {screen === "home" && <Home go={go} />}
      {(screen === "results" || screen === "stay") && <Results go={go} withListing={screen === "stay"} />}
      {screen === "calendar" && (
        <CalendarPage>
          <CalendarView data={data.calendar} />
        </CalendarPage>
      )}
      {screen === "requests" && (
        <Requests requests={requests} arrival={arrival} onConfirm={setArrival} onUndo={() => setArrival(null)} />
      )}
    </AppShell>
  );
}

function Home({ go }: { go: (s: Screen) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <ChatColumn>
      <TopBar actions={<NightsPill balance={data.nights.balance} />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ChatHome
          greeting="Where to next, Agustin?"
          subtitle="Tell me where you're going and who you'd like to meet."
          activity={<ActivityPill href={screenHref("requests")}>Your agent is following 3 requests in Lisbon</ActivityPill>}
          composer={
            <Composer
              large
              value={draft}
              onChange={setDraft}
              onSubmit={() => go("results")}
              onStop={noop}
              busy={false}
              placeholder="Lisbon next weekend, with a founder who surfs…"
              onAttach={noop}
              onDictate={noop}
              toolbar={
                <>
                  <ComposerTool icon={<CalendarIcon size={16} />} onClick={noop}>
                    Dates
                  </ComposerTool>
                  <ComposerTool icon={<UsersIcon size={16} />} onClick={noop}>
                    Who you want to meet
                  </ComposerTool>
                </>
              }
            />
          }
          resume={
            <TripCard
              href={screenHref("requests")}
              trip={data.trip}
              requests={data.requests}
              status={
                <>
                  <strong className="font-semibold text-success">Marta said yes.</strong> Confirm within 3h 40m.
                </>
              }
            />
          }
          starters={<StarterCards starters={data.starters} onPick={() => go("results")} />}
        />
      </div>
    </ChatColumn>
  );
}

function ChatTopBar({ balance }: { balance: number }) {
  return (
    <TopBar
      title="Lisbon, founders who surf"
      actions={
        <>
          <Button variant="ghost" size="sm" className="max-sm:hidden">
            <ShareIcon size={16} />
            Share
          </Button>
          <NightsPill balance={balance} />
        </>
      }
    />
  );
}

function FollowUp() {
  const [draft, setDraft] = useState("");
  return (
    <ComposerDock note="Your agent can get things wrong. Check details with the host.">
      <Composer
        value={draft}
        onChange={setDraft}
        onSubmit={() => setDraft("")}
        onStop={noop}
        busy={false}
        placeholder="Ask a follow-up…"
        onAttach={noop}
        onDictate={noop}
      />
    </ComposerDock>
  );
}

function Results({ go, withListing }: { go: (s: Screen) => void; withListing: boolean }) {
  const [filters, setFilters] = useState(["Founders", "Surf or snow", "Fri 30 Oct – Sun 1 Nov"]);
  const [saved, setSaved] = useState(new Set<string>());

  return (
    <>
      <ChatColumn>
        <ChatTopBar balance={data.nights.balance} />
        <Conversation>
          <UserMessage>
            Heading to Lisbon next weekend for a few founder dinners. I&apos;d love to stay with another founder, ideally
            someone who surfs or snowboards.
          </UserMessage>
          <AssistantMessage>
            <SearchTrace
              summary="Searched AgentBnB and 14 marketplaces, 20 hosts free"
              sources={["AgentBnB", "Couchsurfing", "BeWelcome", "Trustroots"]}
              steps={[
                "Read your profile: founder, snowboards, surfs",
                "Searched AgentBnB and 14 marketplaces for Fri 30 Oct – Sun 1 Nov",
                "Ranked 20 free hosts by what you have in common",
              ]}
            />
            <AssistantText text="Lisbon has **12 AgentBnB hosts** free from Fri 30 Oct to Sun 1 Nov. These three fit you best: two are founders, and two of them ride." />
            <MatchFilters
              filters={filters}
              suggestions={["Fintech only"]}
              onRemove={(f) => setFilters(filters.filter((x) => x !== f))}
              onAdd={(s) => setFilters([...filters, s])}
            />
            <StayResults
              stays={data.cards}
              onOpen={() => go("stay")}
              saved={saved}
              onToggleSave={(s) => {
                const next = new Set(saved);
                if (!next.delete(s.id)) next.add(s.id);
                setSaved(next);
              }}
            />
            <ExternalMatches count={8} sources={["Couchsurfing", "BeWelcome"]} hosts={data.externalHosts} onShow={noop} />
            <AssistantText text="Want me to ask all three? You can have **3 requests** out at once, and each host gets 4 hours to answer. Their agents usually reply first." />
            <Suggestions
              primaryFirst
              items={["Ask all three", "Only fintech founders", "Show them on a map"]}
              onPick={(t) => t === "Ask all three" && go("requests")}
            />
          </AssistantMessage>

          {withListing && (
            <>
              <UserMessage>Tell me more about Marta&apos;s place</UserMessage>
              <AssistantMessage>
                <AssistantText text="Marta runs a payments startup and only hosts founders, so you qualify. She rides Serra da Estrela every winter, and her room looks over the river in Alfama." />
                <StayLink
                  title={data.martaPanel.title}
                  detail="Alfama · 2 nights · open in the panel"
                  photo={data.cards[0].photo}
                  open
                  onOpen={noop}
                />
                <AssistantText text="Two things to know: she has a cat named Pastel, and the house is quiet after 23:00. Want me to send her your intro?" />
                <Suggestions items={["Show me the intro first", "Compare with João"]} onPick={noop} />
              </AssistantMessage>
            </>
          )}
        </Conversation>
        <FollowUp />
      </ChatColumn>

      {withListing && (
        <SidePanel label="Marta's place" onClose={() => go("results")}>
          <StayPanel
            stay={data.martaPanel}
            label="Spare room · Alfama"
            onClose={() => go("results")}
            hostAction={
              <Button variant="secondary" size="sm">
                Message
              </Button>
            }
            footer={
              <>
                <div>
                  <p className="flex items-center gap-1.5 text-xl font-bold tabular-nums">
                    <MoonIcon size={17} className="text-rausch" />2 nights
                  </p>
                  <p className="text-[13px] text-muted">You have 5. Uses 1 of your 3 requests.</p>
                </div>
                <Button onClick={() => go("requests")}>Request to stay</Button>
              </>
            }
          />
        </SidePanel>
      )}
    </>
  );
}

function Requests({
  requests,
  arrival,
  onConfirm,
  onUndo,
}: {
  requests: StayRequest[];
  arrival: string | null;
  onConfirm: (arrival: string) => void;
  onUndo: () => void;
}) {
  return (
    <ChatColumn>
      <ChatTopBar balance={arrival ? data.nights.balance - 2 : data.nights.balance} />
      <Conversation>
        <SystemNote>Today 18:05 · You asked me to request all three</SystemNote>
        <RequestTracker
          trip={data.trip}
          requests={requests}
          note={
            arrival
              ? "Booked with Marta. Your 3 request slots are free again."
              : "Hosts have 4 hours to answer. I follow up for you."
          }
        />
        <AssistantMessage>
          {arrival ? (
            <>
              <StayConfirmed
                host={requests[0].host}
                detail={`Fri 30 Oct, arriving ${arrival}. I told João and Inês you found a place, and sent Marta your arrival time.`}
                onMessage={noop}
                onUndo={onUndo}
              />
              <AssistantText text="Here's your trip now. Porto with Rui starts Monday, so **Sunday 1 Nov is still open**. Want me to find you a couch for that night?" />
              <CalendarCard data={data.calendar} side="trip" />
            </>
          ) : (
            <>
              <AssistantText text="**Marta said yes.** Confirming spends 2 of your nights, leaves you 3, and withdraws João and Inês. Lock it in?" />
              <ConfirmStayCard
                photo={data.cards[0].photo}
                title="Stay with Marta in Alfama"
                details="Fri 30 Oct – Sun 1 Nov · 2 nights"
                arrivalOptions={["18:00", "19:30", "21:00", "Later"]}
                defaultArrival="19:30"
                onConfirm={onConfirm}
                onWait={noop}
                waitLabel="Wait for João"
              />
            </>
          )}
        </AssistantMessage>
      </Conversation>
      <FollowUp />
    </ChatColumn>
  );
}
