"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function RespondButtons({
  requestId,
  status,
  platform,
  platformUrl,
}: {
  requestId: string;
  status: string;
  platform: string | null;
  platformUrl: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = status === "new" || status === "replied";

  async function respond(decision: "accept" | "decline") {
    setBusy(decision);
    setError(null);
    const res = await fetch(`/api/v1/requests/${requestId}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    if (!res.ok) setError((await res.json().catch(() => null))?.error?.message ?? "Couldn't save that.");
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {open ? (
        <div className="flex gap-3">
          <Button disabled={busy !== null} onClick={() => respond("accept")} className="flex-1">
            {busy === "accept" ? "Accepting…" : "Accept"}
          </Button>
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() => respond("decline")}
            className="flex-1 disabled:opacity-50"
          >
            {busy === "decline" ? "Declining…" : "Decline"}
          </Button>
        </div>
      ) : (
        <p className="text-[15px] text-body">
          You {status === "accepted" ? "accepted" : status === "declined" ? "declined" : "closed"} this request.
        </p>
      )}
      {platform && platformUrl && (
        <a
          href={platformUrl}
          target="_blank"
          rel="noreferrer"
          className="block text-center text-[14px] font-medium text-ink underline underline-offset-2"
        >
          {open ? `Reply on ${platform}` : `Let them know on ${platform}`}
        </a>
      )}
      {error && <p className="text-[14px] text-error">{error}</p>}
    </div>
  );
}
