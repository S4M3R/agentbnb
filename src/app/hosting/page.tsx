import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Couchbot } from "@/components/brand/logo";
import { chatWith } from "@/components/hosting/adapters";
import { HostingTabs } from "@/components/hosting/hosting-tabs";
import { PageHeading, PageShell } from "@/components/shell/page-shell";
import { PlusIcon } from "@/components/ui/icons";
import { listHostListings } from "@/lib/hosting/listings";
import { networksForListing } from "@/lib/hosting/networks";
import { currentUser } from "@/lib/session";
import { HostListings } from "./listings";

export const metadata: Metadata = {
  title: "Listings",
  description: "Your places, and every site each one is listed on.",
};

const ADD_PLACE = chatWith("Put my place up");

export default function HostingPage() {
  return (
    <PageShell width="wide">
      <HostingTabs active="listings" />
      <PageHeading
        title="Your listings"
        lead="Your places, and every site each one is on. Pick more sites and I publish them for you."
        action={
          <Link
            href={ADD_PLACE}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-ink bg-canvas px-4 text-sm font-medium text-ink transition-colors hover:bg-surface-soft"
          >
            <PlusIcon size={15} />
            Add a place
          </Link>
        }
      />
      <Suspense fallback={<ListSkeleton />}>
        <Listings />
      </Suspense>
    </PageShell>
  );
}

async function Listings() {
  const user = await currentUser();
  const listings = user ? await listHostListings(user.id) : [];
  if (!listings.length) return <Empty />;
  return <HostListings listings={listings.map((l) => ({ ...l, networks: networksForListing(l) }))} />;
}

function Empty() {
  return (
    <div className="flex flex-col items-center rounded-[14px] border border-dashed border-hairline px-6 py-14 text-center">
      <Couchbot size={72} mood="sleepy" className="mb-3" />
      <p className="text-[20px] font-semibold">No listings yet</p>
      <p className="mx-auto mt-2 max-w-md text-[15px] text-muted">
        Tell me about your couch or spare room in the chat, in a sentence or two. I write the listing, put it on
        AgentBnB, and publish it to Trustroots, BeWelcome and the rest when you want.
      </p>
      <Link
        href={ADD_PLACE}
        className="mt-6 inline-flex h-12 items-center rounded-lg bg-rausch px-6 text-base font-medium text-white transition-colors hover:bg-rausch-active"
      >
        Put my place up
      </Link>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-[560px] animate-pulse rounded-[14px] bg-surface-soft" />
      ))}
    </div>
  );
}
