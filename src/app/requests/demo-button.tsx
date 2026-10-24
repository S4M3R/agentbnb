"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Development only: fills the inbox with made-up requests. */
export function DemoButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/requests/demo", { method: "POST" });
        router.refresh();
        setBusy(false);
      }}
      className="mt-6 disabled:opacity-50"
    >
      {busy ? "Adding…" : "Add sample requests"}
    </Button>
  );
}
