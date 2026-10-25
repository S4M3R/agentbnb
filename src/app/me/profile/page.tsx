import type { Metadata } from "next";
import { Suspense } from "react";
import { PageShell, PageHeading } from "@/components/shell/page-shell";
import { getMyProfile } from "@/lib/profile";
import { currentUser } from "@/lib/session";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = {
  title: "Your profile",
  description: "What hosts see about you before they say yes.",
};

export default function MyProfilePage() {
  return (
    <PageShell width="wide">
      <PageHeading
        title="Your profile"
        lead="This is what hosts see before they say yes. Fill it in here, or just tell the agent about yourself in the chat."
      />
      <Suspense fallback={<div className="h-[520px] animate-pulse rounded-[20px] bg-surface-soft" />}>
        <Editor />
      </Suspense>
    </PageShell>
  );
}

async function Editor() {
  const user = await currentUser();
  const profile = user ? await getMyProfile(user.id) : null;
  return (
    <ProfileForm
      initial={
        profile && {
          id: profile.id,
          // The placeholder name people get before they tell us theirs.
          name: profile.name === "AgentBnB member" ? "" : profile.name,
          avatarUrl: profile.avatarUrl,
          bio: profile.bio ?? "",
          homeCity: profile.homeCity ?? "",
          email: profile.email ?? "",
          languages: profile.languages,
          verified: profile.verified,
          memberSince: profile.memberSince.toISOString(),
        }
      }
    />
  );
}
