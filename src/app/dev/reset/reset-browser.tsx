"use client";

import { useEffect } from "react";

// Everything AgentBnB keeps in the browser lives in this origin's storage: chats (agentbnb:chats and one key
// per chat), the apply list, cached /api/me and attention, reserved home heights, banner dismissals.
// Clearing it all and going home gives a fresh first visit; the account (cookie) stays the same.
export function ResetBrowser() {
  useEffect(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
    window.location.replace("/");
  }, []);
  return <p className="p-8 text-sm text-muted">Clearing this browser&apos;s AgentBnB data…</p>;
}
