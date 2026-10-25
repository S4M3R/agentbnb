import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { currentUser } from "@/lib/session";
import { PageHeading, PageShell } from "@/components/shell/page-shell";
import { EmailOptIn } from "../../applications/ui";
import { AllNotifications, PushSetup } from "../../notifications";

export const metadata: Metadata = {
  title: "Notifications",
  description: "What AgentBnB told you lately, and where it reaches you.",
};

export default function NotificationsPage() {
  return (
    <PageShell>
      <PageHeading
        title="Notifications"
        lead="I let you know when a host replies, a guest asks to stay, or I need you for a step. Here's where that reaches you."
      />
      <div className="flex flex-col gap-6">
        <PushSetup
          title="Notifications on this device"
          lead="Pop-ups on this phone or computer, even when AgentBnB is closed. Turn them on on each device you use."
        />
        <Suspense fallback={<div className="h-[74px] animate-pulse rounded-[14px] bg-surface-soft" />}>
          <EmailStatus />
        </Suspense>
        <AllNotifications />
      </div>
    </PageShell>
  );
}

async function EmailStatus() {
  const user = await currentUser();
  return (
    <section className="flex flex-col gap-3 rounded-[14px] border border-hairline p-5 text-sm">
      <div>
        <h2 className="text-base font-semibold">Email</h2>
        <p className="mt-0.5 text-muted">
          {user?.email ? (
            <>
              Every notification is also emailed to <span className="font-semibold text-body">{user.email}</span>. To
              change it, tell me in the{" "}
              <Link href="/" className="font-semibold text-ink underline underline-offset-2">
                chat
              </Link>
              .
            </>
          ) : (
            "Add your email to get every notification by email too."
          )}
        </p>
      </div>
      {!user?.email && <EmailOptIn />}
    </section>
  );
}
