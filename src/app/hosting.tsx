"use client";

import { useEffect, useRef, useState } from "react";
import type { HostListing } from "@/lib/hosting/listings";
import type { NetworkFit } from "@/lib/hosting/networks";
import type { PublicationView } from "@/lib/hosting/publications";

// Host-side cards in the chat: the listing preview, the network picker, and the live browser
// where the agent publishes to an external network (and the host takes over when asked).

const primary =
  "rounded-lg bg-[#ff385c] px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#e00b41] disabled:bg-[#ffd1da]";
const secondary =
  "rounded-lg border border-zinc-300 px-3.5 py-1.5 text-sm font-medium transition-colors hover:border-zinc-500 dark:border-zinc-700";

const TYPE_LABEL: Record<string, string> = {
  couch: "Couch",
  private_room: "Private room",
  shared_room: "Shared room",
  entire_place: "Entire place",
};

const STATUS_LABEL: Record<HostListing["status"], string> = {
  draft: "Draft",
  active: "Live on AgentBnB",
  paused: "Paused",
  gone: "Removed",
};

export function ListingPreview({
  listing: l,
  onSend,
  stale = false,
}: {
  listing: HostListing;
  onSend: (text: string) => void;
  /** A newer version of this listing appears later in the chat: show it faded, without actions. */
  stale?: boolean;
}) {
  const [cover, ...rest] = l.photos;
  return (
    <article
      className={`overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 ${stale ? "opacity-50" : ""}`}
    >
      {cover ? (
        <div className="grid grid-cols-4 gap-1">
          {/* eslint-disable-next-line @next/next/no-img-element -- Blob photos */}
          <img src={cover} alt="" className={`aspect-[4/3] h-full w-full object-cover ${rest.length ? "col-span-3" : "col-span-4"}`} />
          {rest.length > 0 && (
            <div className="grid gap-1">
              {rest.slice(0, 3).map((src) => (
                // eslint-disable-next-line @next/next/no-img-element -- Blob photos
                <img key={src} src={src} alt="" className="h-full w-full object-cover" />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex aspect-[4/1] items-center justify-center bg-zinc-100 text-sm text-zinc-500 dark:bg-zinc-900">
          No photos yet. Attach a few and I&apos;ll add them.
        </div>
      )}

      <div className="space-y-3 p-4 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-zinc-500">
              {TYPE_LABEL[l.type] ?? l.type}
              {l.publicLocation && ` · ${l.publicLocation}`}
            </div>
            <h3 className="text-base font-semibold leading-snug">{l.title}</h3>
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
              l.status === "active"
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            }`}
          >
            {STATUS_LABEL[l.status]}
          </span>
        </div>

        <p className="line-clamp-6 whitespace-pre-wrap leading-relaxed text-zinc-700 dark:text-zinc-300">{l.description}</p>

        <div className="flex flex-wrap gap-1">
          {[
            l.maxGuests && `Up to ${l.maxGuests} guest${l.maxGuests === 1 ? "" : "s"}`,
            l.pets,
            ...l.amenities.slice(0, 5),
            ...l.dates.map((d) => (d.start === d.end ? d.start : `${d.start} → ${d.end}`)),
          ]
            .filter(Boolean)
            .map((chip) => (
              <span key={String(chip)} className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                {chip}
              </span>
            ))}
        </div>

        {l.address && (
          <div className="text-xs text-zinc-500">
            Exact address, only shared with guests you accept: {l.address}
          </div>
        )}

        {l.publications.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            {l.publications.map((p) => (
              <span key={p.id}>
                {p.networkName}: {p.status === "live" ? "live" : p.status.replace("_", " ")}
              </span>
            ))}
          </div>
        )}

        {l.status === "draft" && !stale && (
          <div className="flex items-center gap-3 pt-1">
            <button type="button" className={primary} onClick={() => onSend("Looks good, publish it on AgentBnB.")}>
              Publish on AgentBnB
            </button>
            <span className="text-xs text-zinc-500">Or tell me what to change.</span>
          </div>
        )}
      </div>
    </article>
  );
}

type NetworkRow = NetworkFit & { publication: { id: string; status: string } | null };

export function NetworkPicker({ listingId, networks }: { listingId: string; networks: NetworkRow[] }) {
  const [pubs, setPubs] = useState<Record<string, PublicationView | { id: string; status: string }>>(() =>
    Object.fromEntries(networks.filter((n) => n.publication).map((n) => [n.id, n.publication!])),
  );
  const [adding, setAdding] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function add(network: string) {
    setAdding((a) => [...a, network]);
    setError(null);
    try {
      const res = await fetch("/api/hosting/publications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingId, network }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Couldn't start.");
      setPubs((p) => ({ ...p, [network]: body.publication }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start.");
    } finally {
      setAdding((a) => a.filter((n) => n !== network));
    }
  }

  const pending = networks.filter((n) => n.recommended && !pubs[n.id]);

  return (
    <div className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="text-sm font-medium">Where else to list it</div>
        {pending.length > 1 && (
          <button
            type="button"
            className={primary}
            disabled={adding.length > 0}
            onClick={() => pending.forEach((n) => add(n.id))}
          >
            Add the {pending.length} I picked
          </button>
        )}
      </div>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
        {networks.map((n) => {
          const pub = pubs[n.id];
          return (
            <li key={n.id} className="space-y-2 px-1 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 text-sm">
                  <div className="flex items-center gap-2">
                    <a href={n.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                      {n.name}
                    </a>
                    {n.recommended && (
                      <span className="rounded-full bg-[#ff385c]/10 px-1.5 py-0.5 text-[11px] font-medium text-[#e00b41]">
                        Recommended
                      </span>
                    )}
                  </div>
                  <div className="text-zinc-600 dark:text-zinc-400">{n.pitch}</div>
                  <div className="text-xs text-zinc-500">{n.reason}</div>
                </div>
                {!pub && (
                  <button
                    type="button"
                    className={n.recommended ? primary : secondary}
                    disabled={adding.includes(n.id)}
                    onClick={() => add(n.id)}
                  >
                    {adding.includes(n.id) ? "Adding…" : "Add"}
                  </button>
                )}
              </div>
              {pub && <PublicationCard key={pub.id} initial={pub} networkName={n.name} />}
            </li>
          );
        })}
      </ul>
      {error && <div className="px-1 text-sm text-red-600 dark:text-red-400">{error}</div>}
    </div>
  );
}

const ACTIVE = new Set(["queued", "running", "needs_user"]);

/** One network's publication: status, the live browser while it runs, and the host's controls. */
export function PublicationCard({
  initial,
  networkName,
}: {
  initial: PublicationView | { id: string; status: string };
  networkName?: string;
}) {
  const [pub, setPub] = useState<PublicationView | null>("networkName" in initial ? initial : null);
  const [status, setStatus] = useState(initial.status);
  const [control, setControl] = useState(false);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const id = initial.id;

  function apply(p: PublicationView) {
    setPub(p);
    setStatus(p.status);
  }

  async function send(action: "start" | "continue" | "done" | "stop") {
    setBusy(true);
    try {
      const res = await fetch(`/api/hosting/publications/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json();
      if (res.ok) apply(body.publication);
    } finally {
      setBusy(false);
    }
  }

  // Queued from the chat (addToNetworks): start it once this card shows up.
  useEffect(() => {
    if (status === "queued" && !started.current) {
      started.current = true;
      send("start");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start once
  }, [status]);

  const polling = !pub || ACTIVE.has(status);
  useEffect(() => {
    if (!polling) return;
    let stop = false;
    const tick = async () => {
      const res = await fetch(`/api/hosting/publications/${id}`, { cache: "no-store" });
      if (!stop && res.ok) apply((await res.json()).publication);
    };
    tick();
    const timer = setInterval(tick, 2000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [id, polling]);

  // The host can always grab the browser; it's theirs by default whenever the agent asks for help.
  const interactive = control || status === "needs_user";

  const name = pub?.networkName ?? networkName ?? "the site";

  return (
    <div className="space-y-2 rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
      {status === "live" ? (
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium text-emerald-700 dark:text-emerald-400">✓ Live on {name}</span>
          {pub?.externalUrl && (
            <a href={pub.externalUrl} target="_blank" rel="noreferrer" className="text-xs underline underline-offset-2">
              View ↗
            </a>
          )}
        </div>
      ) : status === "failed" ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-red-600 dark:text-red-400">{pub?.error ?? "That didn't work."}</span>
          <button type="button" className={secondary} disabled={busy} onClick={() => send("start")}>
            Retry
          </button>
        </div>
      ) : status === "needs_user" ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <div className="font-medium">Your turn</div>
          <div>{pub?.statusMessage ?? `I need you for a moment on ${name}.`}</div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span className="animate-pulse text-zinc-600 dark:text-zinc-400">
            {pub?.statusMessage ?? `Starting ${name}…`}
          </span>
          {status === "running" && (
            <button type="button" className="text-xs text-zinc-500 hover:text-foreground" onClick={() => send("stop")}>
              Stop
            </button>
          )}
        </div>
      )}

      {pub?.liveViewUrl && (
        <div className="relative aspect-[16/10] overflow-hidden rounded-md border border-zinc-200 bg-white dark:border-zinc-800">
          <iframe
            src={pub.liveViewUrl}
            title={`Live browser on ${name}`}
            sandbox="allow-same-origin allow-scripts"
            allow="clipboard-read; clipboard-write"
            className="h-full w-full"
          />
          {!interactive && (
            <div className="absolute inset-0 flex items-end justify-end bg-transparent p-2">
              <button
                type="button"
                onClick={() => setControl(true)}
                className="rounded-full bg-black/75 px-3 py-1.5 text-xs font-medium text-white backdrop-blur hover:bg-black"
              >
                Take control
              </button>
            </div>
          )}
        </div>
      )}

      {status === "needs_user" && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={primary} disabled={busy} onClick={() => send("continue")}>
            Continue
          </button>
          {pub?.liveViewUrl && (
            <button type="button" className={secondary} disabled={busy} onClick={() => send("done")}>
              I finished it myself
            </button>
          )}
        </div>
      )}
    </div>
  );
}
