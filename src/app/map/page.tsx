import type { Metadata } from "next";
import { Suspense } from "react";
import { getMapListings } from "@/lib/map-listings";
import { ListingsMap } from "./listings-map";
import { PageShell } from "@/components/shell/page-shell";

export const metadata: Metadata = {
  title: "Map",
  description: "Every stay AgentBnB knows about, on one map.",
};

export default function MapPage() {
  return (
    <PageShell bleed title="Map of stays">
      <Suspense fallback={<MapSkeleton />}>
        <MapData />
      </Suspense>
    </PageShell>
  );
}

async function MapData() {
  const listings = await getMapListings();
  return <ListingsMap listings={listings} />;
}

/** The split view's frame while listings load: category strip, a few card plates, the map. */
function MapSkeleton() {
  return (
    <div className="flex min-w-0 flex-1 flex-col" aria-busy="true">
      <div className="flex h-[73px] shrink-0 items-center gap-8 border-b border-hairline-soft px-4 nav:px-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div className="size-6 rounded-md bg-surface-strong" />
            <div className="h-2.5 w-12 rounded-full bg-surface-strong" />
          </div>
        ))}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="@container w-full overflow-hidden px-4 pt-5 nav:w-[60%] nav:px-6 min-[1128px]:w-[58%]">
          <div className="mb-5 h-4 w-40 rounded-full bg-surface-strong" />
          <div className="grid grid-cols-1 gap-x-4 gap-y-8 @min-[28rem]:grid-cols-2 @min-[50rem]:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="space-y-3">
                <div className="aspect-[20/19] animate-shimmer rounded-card bg-surface-strong motion-reduce:animate-none" />
                <div className="h-3 w-2/3 rounded-full bg-surface-strong" />
                <div className="h-3 w-1/2 rounded-full bg-surface-strong" />
              </div>
            ))}
          </div>
        </div>
        <div className="hidden flex-1 items-center justify-center bg-surface-soft text-sm text-muted nav:flex">
          Loading the map…
        </div>
      </div>
    </div>
  );
}
