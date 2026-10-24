"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { chatWith, toHostListingCard, toListedPlaces, type NetworkWithPublication } from "@/components/hosting/adapters";
import { HostListingCard } from "@/components/hosting/listing-card";
import { Sheet } from "@/components/hosting/sheet";
import { Button } from "@/components/ui/button";
import { MessageIcon, PlusIcon } from "@/components/ui/icons";
import type { HostListing } from "@/lib/hosting/listings";
import { NetworkPicker } from "../hosting";
import { setLiveOnAgentBnb } from "./actions";

export type ListingWithNetworks = HostListing & { networks: NetworkWithPublication[] };

const REFRESH_MS = 4000;

/**
 * The host's listings with their controls: AgentBnB publish/pause, retry a failed network, and
 * the publish picker in a sheet (also how they watch a run or step in when a site needs them).
 * While a run is going the page refreshes itself, so statuses move without a reload.
 */
export function HostListings({ listings }: { listings: ListingWithNetworks[] }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<{ listingId: string; select?: string[] } | null>(null);
  const [busy, setBusy] = useState<{ listingId: string; place: string } | null>(null);
  const [error, setError] = useState<{ listingId: string; message: string } | null>(null);
  const [, startTransition] = useTransition();

  // The sheet's cards poll on their own; the page catches up when it closes.
  const moving = listings.some((l) => l.publications.some((p) => p.status === "running"));
  useEffect(() => {
    if (!moving || sheet) return;
    const timer = setInterval(() => document.visibilityState === "visible" && router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [moving, sheet, router]);

  const closeSheet = useCallback(() => {
    setSheet(null);
    router.refresh();
  }, [router]);

  function run(listingId: string, place: string, work: () => Promise<string | null>) {
    setBusy({ listingId, place });
    setError(null);
    startTransition(async () => {
      const message = await work().catch(() => "That didn't work. Try again.");
      if (message) setError({ listingId, message });
      setBusy(null);
    });
  }

  function onPlace(l: ListingWithNetworks, place: string) {
    if (place === "internal") {
      return run(l.id, place, async () => {
        const res = await setLiveOnAgentBnb(l.id, l.status !== "active");
        return res.ok ? null : res.error;
      });
    }
    const pub = l.networks.find((n) => n.id === place)?.publication;
    if (pub?.status === "failed") {
      // Retry through the batch path, so it waits its turn if browsers are busy.
      return run(l.id, place, async () => {
        const res = await fetch("/api/hosting/publications", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ listingId: l.id, networks: [place] }),
        });
        if (!res.ok) return (await res.json().catch(() => null))?.error?.message ?? "Couldn't retry.";
        router.refresh();
        return null;
      });
    }
    // Add: open the picker with just this one ticked. Watch / Open: the picker shows its live browser.
    setSheet({ listingId: l.id, select: pub ? [] : [place] });
  }

  const open = sheet && listings.find((l) => l.id === sheet.listingId);

  return (
    <>
      <ul className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {listings.map((l) => (
          <li key={l.id} className="flex flex-col gap-2">
            <HostListingCard
              listing={toHostListingCard(l)}
              places={toListedPlaces(l, l.networks)}
              busyPlace={busy?.listingId === l.id ? busy.place : null}
              onPlaceAction={(place) => onPlace(l, place)}
              actions={
                <>
                  <Button size="sm" variant="secondary" onClick={() => setSheet({ listingId: l.id })}>
                    <PlusIcon size={15} />
                    List on more sites
                  </Button>
                  <Link
                    href={chatWith(`Edit my listing "${l.title}" (listing ${l.id}): `)}
                    className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-strong"
                  >
                    <MessageIcon size={15} />
                    Edit in chat
                  </Link>
                </>
              }
            />
            {error?.listingId === l.id && (
              <p role="alert" className="px-1 text-sm text-error">
                {error.message}
              </p>
            )}
          </li>
        ))}
      </ul>

      {open && (
        <Sheet title="List on more sites" subtitle={open.title} onClose={closeSheet}>
          <NetworkPicker
            key={open.id}
            listingId={open.id}
            networks={open.networks}
            initialSelected={sheet.select}
            framed={false}
          />
        </Sheet>
      )}
    </>
  );
}
