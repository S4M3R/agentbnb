import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { buildCalendar } from "@/components/calendar/calendar";
import { CalendarView } from "@/components/calendar/calendar-view";
import { calendarToday, getCalendar } from "@/lib/calendar";
import { currentUser } from "@/lib/session";
import { PageHeading, PageShell } from "@/components/shell/page-shell";

export const metadata: Metadata = {
  title: "Calendar · AgentBnB",
  description: "Who's staying at your place, and where you sleep each night of your trips.",
};

export default function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  return (
    <PageShell width="wide">
      <PageHeading
        title="Calendar"
        lead="Who's staying at your place, which nights you've blocked, and where you sleep each night of a trip, so nothing slips through the gaps."
      />
      <Suspense fallback={<CalendarSkeleton />}>
        <Calendar searchParams={searchParams} />
      </Suspense>
    </PageShell>
  );
}

async function Calendar({ searchParams }: { searchParams: PageProps<"/calendar">["searchParams"] }) {
  const { month } = await searchParams;
  await connection(); // "today" is per request
  const user = await currentUser();
  const data = user
    ? await getCalendar(user.id)
    : buildCalendar({ today: calendarToday(), places: [], guests: [], stays: [] });
  const initial = typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : undefined;
  return <CalendarView data={data} initialMonth={initial} />;
}

function CalendarSkeleton() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-4">
        <div className="h-9 w-56 animate-pulse rounded-lg bg-surface-strong" />
        <div className="h-[560px] animate-pulse rounded-card bg-surface-soft" />
      </div>
      <div className="h-64 animate-pulse rounded-card bg-surface-soft" />
    </div>
  );
}
