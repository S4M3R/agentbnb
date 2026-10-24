"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Development only: fills the inbox with made-up requests. */
export function DemoButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/requests/demo", { method: "POST" });
        router.refresh();
        setBusy(false);
      }}
      className="mt-6 h-12 rounded-lg border border-[#222] px-6 text-base font-medium hover:bg-[#f7f7f7] disabled:opacity-50"
    >
      {busy ? "Adding…" : "Add sample requests"}
    </button>
  );
}
