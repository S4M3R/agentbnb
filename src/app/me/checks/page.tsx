import type { Metadata } from "next";
import { Suspense } from "react";
import { checksAboutMe, getCheck } from "@/lib/checks";
import { currentUser } from "@/lib/requests";
import { BackgroundCheck } from "../../requests/background-check";
import { toJson } from "../../requests/check-types";
import { PageShell, PageHeading } from "@/components/shell/page-shell";
import { SiteName } from "@/components/ui/site-name";

export const metadata: Metadata = {
  title: "Checks about you",
  description: "Background checks hosts ran before answering your stay requests.",
};

export default function ChecksAboutMePage() {
  return (
    <PageShell>
      <PageHeading
        title="Checks about you"
        lead={
          <>
            Hosts can ask AgentBnB to look up your public profile before they answer a request. It covers public
            information only: your profiles on other platforms, references and reviews. Never criminal, court or credit
            records. Here&apos;s exactly what each host saw.
          </>
        }
      />
      <Suspense fallback={<div className="h-64 animate-pulse rounded-[14px] bg-surface-soft" />}>
        <Checks />
      </Suspense>
    </PageShell>
  );
}

async function Checks() {
  const user = await currentUser();
  const list = user ? await checksAboutMe(user.id) : [];
  if (!user || !list.length) {
    return (
      <p className="rounded-[14px] border border-dashed border-hairline px-6 py-12 text-center text-[15px] text-muted">
        No host has run a check on you.
      </p>
    );
  }
  const checks = await Promise.all(list.map((c) => getCheck(user.id, c.id)));
  return (
    <div className="space-y-8">
      {checks.map(
        (c) =>
          c && (
            <div key={c.id}>
              <p className="mb-2 text-[13px] text-muted">
                Run {new Date(c.startedAt).toLocaleDateString("en-US", { month: "long", day: "numeric" })} for a request on{" "}
                <SiteName site={c.source.id} size={14}>
                  {c.source.name}
                </SiteName>
              </p>
              <BackgroundCheck requestId={null} guestName={c.guest.name} guestIsMember initial={toJson(c)} />
            </div>
          ),
      )}
    </div>
  );
}
