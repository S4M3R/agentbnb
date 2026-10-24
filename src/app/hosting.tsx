"use client";

import { useEffect, useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { CheckIcon, ExternalIcon } from "@/components/ui/icons";
import type { HostListing } from "@/lib/hosting/listings";
import { MAX_PARALLEL_RUNS } from "@/lib/hosting/networks";
import type { PublicationView } from "@/lib/hosting/publications";
import { SiteIcon, SiteName } from "@/components/ui/site-name";
import { isHeld, toPickerRows, type NetworkWithPublication } from "@/components/hosting/adapters";
import { PublishPicker } from "@/components/hosting/publish-picker";

// Host-side cards in the chat: the listing preview, the network picker, and the live browser
// where the agent publishes to an external network (and the host takes over when asked).

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
      className={`overflow-hidden rounded-card border border-hairline bg-canvas ${stale ? "opacity-50" : ""}`}
    >
      {cover ? (
        <div className="grid grid-cols-4 gap-1 bg-canvas">
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
        <div className="flex aspect-[4/1] items-center justify-center bg-surface-soft px-4 text-center text-sm text-muted">
          No photos yet. Attach a few and I&apos;ll add them.
        </div>
      )}

      <div className="space-y-3 p-4 text-sm sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] text-muted">
              {TYPE_LABEL[l.type] ?? l.type}
              {l.publicLocation && ` · ${l.publicLocation}`}
            </div>
            <h3 className="mt-0.5 text-base font-semibold leading-snug text-ink">{l.title}</h3>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
              l.status === "active" ? "bg-success-soft text-success" : "bg-surface-strong text-body"
            }`}
          >
            {STATUS_LABEL[l.status]}
          </span>
        </div>

        <p className="line-clamp-6 whitespace-pre-wrap text-[15px] leading-relaxed text-body">{l.description}</p>

        <div className="flex flex-wrap gap-1.5">
          {[
            l.maxGuests && `Up to ${l.maxGuests} guest${l.maxGuests === 1 ? "" : "s"}`,
            l.pets,
            ...l.amenities.slice(0, 5),
            ...l.dates.map((d) => (d.start === d.end ? d.start : `${d.start} → ${d.end}`)),
          ]
            .filter(Boolean)
            .map((chip) => (
              <span
                key={String(chip)}
                className="inline-flex h-7 items-center rounded-full border border-hairline px-2.5 text-[13px] text-ink"
              >
                {chip}
              </span>
            ))}
        </div>

        {l.address && (
          <div className="text-[13px] text-muted">
            Exact address, only shared with guests you accept: {l.address}
          </div>
        )}

        {l.publications.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted">
            {l.publications.map((p) => (
              <SiteName key={p.id} site={p.network} size={14}>
                {p.networkName}: {p.status === "live" ? "live" : p.status.replace("_", " ")}
              </SiteName>
            ))}
          </div>
        )}

        {l.status === "draft" && !stale && (
          <div className="flex flex-wrap items-center gap-3 border-t border-hairline-soft pt-4">
            <Button size="sm" onClick={() => onSend("Looks good, publish it on AgentBnB.")}>
              Publish on AgentBnB
            </Button>
            <span className="text-[13px] text-muted">Or tell me what to change.</span>
          </div>
        )}
      </div>
    </article>
  );
}

type NetworkRow = NetworkWithPublication;
type Pub = PublicationView | { id: string; status: string };

/**
 * "Where else to list it": tick the networks (recommended ones start ticked), then "Publish to N
 * sites" starts them all in one request. The server opens up to MAX_PARALLEL_RUNS browsers at
 * once and queues the rest; this card starts each queued one as a browser frees up. Every
 * network being published shows its PublicationCard (live browser, take control, Continue).
 *
 * `initialSelected` overrides the recommended picks (the addToNetworks result passes none, since
 * the agent already queued what the host asked for). `onChange` fires after publishing starts.
 */
export function NetworkPicker({
  listingId,
  networks,
  initialSelected,
  framed = true,
  onChange,
}: {
  listingId: string;
  networks: NetworkRow[];
  initialSelected?: string[];
  framed?: boolean;
  onChange?: () => void;
}) {
  const [pubs, setPubs] = useState<Record<string, Pub>>(() =>
    Object.fromEntries(networks.filter((n) => n.publication).map((n) => [n.id, n.publication!])),
  );
  // Latest status and whether a browser is open, as each PublicationCard reports it.
  const [live, setLive] = useState<Record<string, { status: string; session: boolean }>>({});
  const [started, setStarted] = useState<ReadonlySet<string>>(() => new Set());
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        initialSelected ?? networks.filter((n) => n.recommended && !isHeld(n.publication?.status)).map((n) => n.id),
      ),
  );
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = (id: string) => live[id]?.status ?? pubs[id]?.status;
  const rows = toPickerRows(networks, { selected, status, started });
  const locked = new Set(rows.filter((r) => r.locked).map((r) => r.id));

  // A few browsers at a time: running ones, and ones waiting on the host with the browser open.
  const open = rows.filter(
    (r) => r.locked && (status(r.id) === "running" || (status(r.id) === "needs_user" && live[r.id]?.session)),
  ).length;
  const waiting = rows.filter((r) => r.locked && status(r.id) === "queued").map((r) => r.id);
  const canStart = new Set(waiting.slice(0, Math.max(0, MAX_PARALLEL_RUNS - open)));

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function publish() {
    const ids = rows.filter((r) => r.selected).map((r) => r.id);
    if (!ids.length) return;
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch("/api/hosting/publications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingId, networks: ids }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Couldn't start.");
      const fresh: PublicationView[] = body.publications;
      setPubs((p) => ({ ...p, ...Object.fromEntries(fresh.map((pub) => [pub.network, pub])) }));
      setLive((l) => Object.fromEntries(Object.entries(l).filter(([id]) => !ids.includes(id))));
      setStarted((s) => new Set([...s, ...ids]));
      setSelected(new Set());
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <PublishPicker
      framed={framed}
      heading={framed ? "Where else to list it" : undefined}
      lead={
        framed
          ? "Pick the sites. I fill each one in a live browser you can watch; you log in when a site asks."
          : "I fill each one in a live browser you can watch; you log in when a site asks."
      }
      rows={rows}
      onToggle={toggle}
      onClear={() => setSelected(new Set())}
      onPublish={publish}
      publishing={publishing}
      error={error}
      footnote={`I open ${MAX_PARALLEL_RUNS} at a time.`}
      progress={(id) => {
        const pub = pubs[id];
        const n = networks.find((x) => x.id === id);
        if (!pub || !locked.has(id)) return null;
        return (
          <PublicationCard
            key={pub.id}
            initial={pub}
            networkId={id}
            networkName={n?.name}
            autoStart={canStart.has(id)}
            onUpdate={(p) =>
              setLive((l) => ({ ...l, [id]: { status: p.status, session: p.liveViewUrl != null } }))
            }
          />
        );
      }}
    />
  );
}

const ACTIVE = new Set(["queued", "running", "needs_user"]);

/** One network's publication: status, the live browser while it runs, and the host's controls. */
export function PublicationCard({
  initial,
  networkId,
  networkName,
  autoStart = true,
  onUpdate,
}: {
  initial: PublicationView | { id: string; status: string };
  networkId?: string;
  networkName?: string;
  /** Start a queued run when it shows up. The picker holds it back until a browser is free. */
  autoStart?: boolean;
  /** Every status the card learns, so the picker knows how many browsers are open. */
  onUpdate?: (p: PublicationView) => void;
}) {
  const [pub, setPub] = useState<PublicationView | null>("networkName" in initial ? initial : null);
  const [status, setStatus] = useState(initial.status);
  const [control, setControl] = useState(false);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const id = initial.id;

  // The polling effect below outlives renders; it reports through the latest onUpdate.
  const report = useRef(onUpdate);
  useEffect(() => {
    report.current = onUpdate;
  });

  function apply(p: PublicationView) {
    setPub(p);
    setStatus(p.status);
    report.current?.(p);
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

  // Queued (by addToNetworks, or waiting for a free browser): start it once it's allowed to.
  useEffect(() => {
    if (status === "queued" && autoStart && !started.current) {
      started.current = true;
      send("start");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start once
  }, [status, autoStart]);

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
    <div className="space-y-3 rounded-xl bg-surface-soft p-3 text-sm">
      {status === "live" ? (
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 font-semibold text-success">
            <CheckIcon size={15} strokeWidth={2.6} />
            Live on <SiteIcon site={pub?.network ?? networkId} />
            {name}
          </span>
          {pub?.externalUrl && (
            <ButtonLink href={pub.externalUrl} variant="ghost" size="sm" className="-my-1 h-8 px-2.5">
              View
              <ExternalIcon size={14} />
            </ButtonLink>
          )}
        </div>
      ) : status === "failed" ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-error">{pub?.error ?? "That didn't work."}</span>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => send("start")}>
            Retry
          </Button>
        </div>
      ) : status === "needs_user" ? (
        <div className="rounded-lg bg-amber-soft p-3 text-amber">
          <div className="flex items-center gap-2 font-semibold">
            <span className="size-2 rounded-full bg-amber-dot" />
            Your turn
          </div>
          <div>{pub?.statusMessage ?? `I need you for a moment on ${name}.`}</div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span className="animate-shimmer text-body">
            {status === "queued" && !autoStart
              ? `Waiting for a free browser to open ${name}…`
              : (pub?.statusMessage ?? `Starting ${name}…`)}
          </span>
          {status === "running" && (
            <button
              type="button"
              className="text-[13px] font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
              onClick={() => send("stop")}
            >
              Stop
            </button>
          )}
        </div>
      )}

      {pub?.liveViewUrl && (
        <div className="relative aspect-[16/10] overflow-hidden rounded-lg border border-hairline bg-canvas">
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
                className="rounded-full bg-ink/85 px-3.5 py-2 text-[13px] font-semibold text-white shadow-float backdrop-blur transition-colors hover:bg-ink"
              >
                Take control
              </button>
            </div>
          )}
        </div>
      )}

      {status === "needs_user" && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={() => send("continue")}>
            Continue
          </Button>
          {pub?.liveViewUrl && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => send("done")}>
              I finished it myself
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
