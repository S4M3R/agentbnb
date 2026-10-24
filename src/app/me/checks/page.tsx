import type { Metadata } from "next";
import { Suspense } from "react";
import { checksAboutMe, getCheck } from "@/lib/checks";
import { currentUser } from "@/lib/requests";
import { BackgroundCheck } from "../../requests/background-check";
import { toJson } from "../../requests/check-types";
import { TopNav } from "../../requests/ui";

export const metadata: Metadata = {
  title: "Checks about you · AgentBnB",
  description: "Background checks hosts ran before answering your stay requests.",
};

export default function ChecksAboutMePage() {
  return (
    <div className="min-h-dvh bg-white text-[#222]">
      <TopNav active="checks" />
      <main className="mx-auto max-w-3xl px-5 pt-8 pb-16">
        <h1 className="text-[28px] font-bold leading-tight">Checks about you</h1>
        <p className="mt-1 text-[15px] leading-relaxed text-[#6a6a6a]">
          Hosts can ask AgentBnB to look up your public profile before they answer a request. It covers public
          information only: your profiles on other platforms, references and reviews. Never criminal, court or credit
          records. Here&apos;s exactly what each host saw.
        </p>
        <Suspense fallback={<div className="mt-8 h-64 animate-pulse rounded-[14px] bg-[#f7f7f7]" />}>
          <Checks />
        </Suspense>
      </main>
    </div>
  );
}

async function Checks() {
  const user = await currentUser();
  const list = user ? await checksAboutMe(user.id) : [];
  if (!user || !list.length) {
    return <p className="mt-8 text-[15px] text-[#6a6a6a]">No host has run a check on you.</p>;
  }
  const checks = await Promise.all(list.map((c) => getCheck(user.id, c.id)));
  return (
    <div className="mt-8 space-y-8">
      {checks.map(
        (c) =>
          c && (
            <div key={c.id}>
              <p className="mb-2 text-[13px] text-[#6a6a6a]">
                Run {new Date(c.startedAt).toLocaleDateString("en-US", { month: "long", day: "numeric" })} for a request on{" "}
                {c.source.name}
              </p>
              <BackgroundCheck requestId={null} guestName={c.guest.name} guestIsMember initial={toJson(c)} />
            </div>
          ),
      )}
    </div>
  );
}
