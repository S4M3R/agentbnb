"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { LogoMark, Wordmark } from "@/components/brand/logo";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { PushMenuItem } from "@/components/notifications/push-prompt";
import { useNotifications } from "@/components/notifications/use-notifications";
import { usePush } from "@/components/notifications/use-push";
import { AccountMenu } from "./account-menu";
import { CategoryTabs } from "./category-tabs";
import { navTabs, useMe, useUnreadApplications } from "./nav";

/**
 * The app frame, Airbnb style: a white header with the product tabs across the top and the page
 * filling the rest of the screen. Below 744px the tabs drop to their own row under the logo, as on
 * Airbnb's mobile web, which keeps the bottom of the screen free for the chat composer.
 * `onNewChat` backs the "New chat" item in the account menu; `actions` sit just left of the account pill
 * (the chat puts its New chat button there, so nothing sits on top of the conversation).
 */
export function SiteShell({
  onNewChat,
  actions,
  children,
}: {
  onNewChat: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const tabs = navTabs(useUnreadApplications());
  const me = useMe();
  const inbox = useNotifications();
  const push = usePush();
  const [testResult, setTestResult] = useState<string | null>(null);
  const sendTest = async () => {
    setTestResult((await push.sendTest()).message);
    setTimeout(() => setTestResult(null), 6000);
  };
  // The bell and the account menu both carry the switch for this device.
  const pushItem = (onNavigate: () => void) => (
    <PushMenuItem
      state={push.state}
      busy={push.busy}
      onEnable={push.enable}
      onDisable={push.disable}
      onTest={sendTest}
      testResult={testResult}
      settingsHref="/me/notifications"
      onNavigate={onNavigate}
    />
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      <header className="relative z-40 shrink-0 border-b border-hairline bg-canvas">
        <div className="grid h-14 grid-cols-[1fr_auto] items-center gap-4 px-4 nav:h-20 nav:grid-cols-[1fr_auto_1fr] nav:px-6 lg:px-10">
          <Link
            href="/"
            aria-label="AgentBnB home"
            className="flex items-center gap-1.5 justify-self-start rounded-lg text-rausch"
          >
            <LogoMark size={32} />
            <Wordmark className="text-[23px] nav:max-lg:hidden" />
          </Link>
          <CategoryTabs tabs={tabs} className="max-nav:hidden" />
          <div className="flex items-center gap-1.5 justify-self-end">
            {actions}
            {/* Only once there's someone to notify: a first-time visitor has no inbox. */}
            {me && (
              <NotificationBell
                items={inbox.items}
                unread={inbox.unread}
                onOpenItem={(item) => inbox.read(item.id)}
                onMarkAllRead={inbox.readAll}
                fallbackHref="/me/notifications"
                footer={
                  <Link
                    href="/me/notifications"
                    className="block px-4 py-3 text-center text-sm font-semibold underline underline-offset-2 transition-colors hover:bg-surface-soft"
                  >
                    All notifications and settings
                  </Link>
                }
              />
            )}
            <AccountMenu onNewChat={onNewChat} me={me} notifications={me ? pushItem : undefined} />
          </div>
        </div>
        <CategoryTabs tabs={tabs} layout="stacked" className="px-2 nav:hidden" />
      </header>
      <div className="flex min-h-0 flex-1">{children}</div>
    </div>
  );
}

/** A slim bar at the top of a page's column: a title or way back on the left, actions on the right. */
export function PageBar({ title, actions }: { title?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 px-4 sm:px-6 lg:px-10">
      <div className="min-w-0 flex-1 truncate text-base font-semibold sm:text-[17px]">{title}</div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}
