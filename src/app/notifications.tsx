"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { NotificationList } from "@/components/notifications/notification-bell";
import { PushBanner, PushCard } from "@/components/notifications/push-prompt";
import { useNotifications, useNotificationsSnapshot } from "@/components/notifications/use-notifications";
import { usePush } from "@/components/notifications/use-push";

// Where the push opt-in lives outside the header: the card on /applications, /hosting and
// /me/notifications, and the home's one-time banner. The UI is in src/components/notifications.

/** Push on this device, with "Send a test" once it's on. `children` go under it (the email opt-in). */
export function PushSetup({
  title,
  lead,
  hideWhenOn = false,
  children,
}: {
  title?: string;
  lead?: string;
  /** Nothing to show once push is on here (and there's no `children`): on pages where it's a nudge. */
  hideWhenOn?: boolean;
  children?: ReactNode;
}) {
  const push = usePush();
  const [testResult, setTestResult] = useState<string | null>(null);
  if (hideWhenOn && push.state === "on" && !children) return null;
  return (
    <PushCard
      state={push.state}
      ios={push.ios}
      busy={push.busy}
      error={push.error}
      onEnable={push.enable}
      onDisable={push.disable}
      onTest={async () => setTestResult((await push.sendTest()).message)}
      testResult={testResult}
      title={title}
      lead={lead}
    >
      {children}
    </PushCard>
  );
}

const DISMISSED = "abnb:push-banner-dismissed";
const DISMISS_EVENT = "agentbnb:push-banner";

function subscribeDismissed(onChange: () => void) {
  window.addEventListener(DISMISS_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(DISMISS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readDismissed() {
  try {
    return localStorage.getItem(DISMISSED) === "1";
  } catch {
    return true;
  }
}

/**
 * The home's gentle nudge, shown once the person has something worth hearing about (an application
 * out, a place they host, a request) and until they turn push on or tap "Not now".
 */
export function HomePushBanner() {
  const push = usePush();
  const { worthHearing } = useNotificationsSnapshot();
  // Hidden on the server and until we know: no flash for people who already said no.
  const dismissed = useSyncExternalStore(subscribeDismissed, readDismissed, () => true);
  if (!worthHearing || dismissed) return null;
  return (
    <PushBanner
      state={push.state}
      busy={push.busy}
      error={push.error}
      onEnable={push.enable}
      onDismiss={() => {
        try {
          localStorage.setItem(DISMISSED, "1");
        } catch {}
        window.dispatchEvent(new Event(DISMISS_EVENT));
      }}
    />
  );
}

/** Every recent notification on /me/notifications; opening one marks it read. */
export function AllNotifications() {
  const inbox = useNotifications();
  const [now, setNow] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- time-ago labels need the client clock, after hydration
    setNow(Date.now());
  }, [inbox.items]);
  return (
    <section className="overflow-hidden rounded-[14px] border border-hairline">
      <div className="flex items-center gap-2 border-b border-hairline-soft px-4 py-3">
        <h2 className="flex-1 text-base font-semibold">
          Recent
          {inbox.unread > 0 && <span className="ml-1.5 font-medium text-muted tabular-nums">{inbox.unread} unread</span>}
        </h2>
        <button
          type="button"
          onClick={inbox.readAll}
          disabled={inbox.unread === 0}
          className="rounded-md px-1.5 py-1 text-[13px] font-semibold text-ink underline underline-offset-2 transition-colors hover:bg-surface-soft disabled:text-muted-soft disabled:no-underline disabled:hover:bg-transparent"
        >
          Mark all as read
        </button>
      </div>
      <NotificationList
        items={inbox.items}
        now={now}
        fallbackHref="/me/notifications"
        onOpenItem={(item) => inbox.read(item.id)}
        className="divide-y divide-hairline-soft"
      />
    </section>
  );
}
