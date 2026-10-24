import type { Metadata } from "next";
import { Suspense } from "react";
import { getMapListings } from "@/lib/map-listings";
import { ListingsMap } from "./listings-map";

export const metadata: Metadata = {
  title: "Map · AgentBnB",
  description: "Every stay AgentBnB knows about, on one map.",
};

export default function MapPage() {
  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-white text-zinc-900">
      <Suspense fallback={<MapSkeleton />}>
        <MapData />
      </Suspense>
    </main>
  );
}

async function MapData() {
  const listings = await getMapListings();
  return <ListingsMap listings={listings} />;
}

function MapSkeleton() {
  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <div className="h-[40dvh] border-zinc-200 md:h-auto md:w-96 md:border-r" />
      <div className="flex flex-1 items-center justify-center bg-zinc-100 text-sm text-zinc-500">
        Loading listings…
      </div>
    </div>
  );
}
