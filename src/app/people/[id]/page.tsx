import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import { formatRange, TYPE_LABEL } from "@/components/stays/format";
import { PageShell } from "@/components/shell/page-shell";
import { PinIcon } from "@/components/ui/icons";
import { getPublicProfile, type PublicProfile } from "@/lib/profile";
import { currentUser } from "@/lib/session";
import { ConfirmedInfo, firstName, ProfileAbout, ProfileCard } from "../profile-card";

// A member's public profile, modeled on Airbnb's host profile. Anyone with the link can see it:
// no email, and their places only by area.

const load = cache(getPublicProfile);

export async function generateMetadata({ params }: PageProps<"/people/[id]">): Promise<Metadata> {
  const profile = await load((await params).id);
  if (!profile) return { title: "Member not found" };
  const first = firstName(profile.name);
  return {
    title: profile.name,
    description: profile.bio?.slice(0, 160) || `${first} is a member of AgentBnB${profile.homeCity ? ` from ${profile.homeCity}` : ""}.`,
  };
}

export default function PersonPage({ params }: PageProps<"/people/[id]">) {
  return (
    <PageShell width="wide">
      <Suspense fallback={<ProfileSkeleton />}>
        <Person params={params} />
      </Suspense>
    </PageShell>
  );
}

/** The member looking at their own profile gets a way to edit it. */
async function EditLink({ id }: { id: string }) {
  const me = await currentUser();
  if (me?.id !== id) return null;
  return (
    <p className="text-center text-[14px] text-muted">
      This is you.{" "}
      <Link href="/me/profile" className="font-semibold text-ink underline underline-offset-2">
        Edit your profile
      </Link>
    </p>
  );
}

async function Person({ params }: { params: PageProps<"/people/[id]">["params"] }) {
  const profile = await load((await params).id);
  if (!profile) notFound();
  const view = { ...profile, places: profile.listings.length };
  const first = firstName(profile.name);

  return (
    <div className="grid gap-10 pt-2 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)] md:gap-14 lg:gap-20 lg:pt-6">
      <aside className="space-y-6 md:sticky md:top-6 md:self-start">
        <ProfileCard profile={view} />
        <ConfirmedInfo profile={view} />
        <Suspense fallback={null}>
          <EditLink id={profile.id} />
        </Suspense>
      </aside>

      <div className="min-w-0">
        <ProfileAbout profile={view} />

        {profile.listings.length > 0 && (
          <section className="mt-10 border-t border-hairline pt-10">
            <h2 className="text-[22px] font-medium tracking-[-0.44px]">{first}&apos;s places</h2>
            <ul className="mt-6 grid grid-cols-1 gap-x-6 gap-y-8 min-[480px]:grid-cols-2">
              {profile.listings.map((l) => (
                <li key={l.id}>
                  <PlaceCard place={l} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

/** Photo-first, like a stay card. Only the area, never the address. */
function PlaceCard({ place }: { place: PublicProfile["listings"][number] }) {
  const meta = [
    place.nextOpen && `Open ${formatRange(place.nextOpen.start, place.nextOpen.end)}`,
    place.maxGuests && `Up to ${place.maxGuests} ${place.maxGuests === 1 ? "guest" : "guests"}`,
  ].filter(Boolean);
  return (
    <article className="flex flex-col gap-3">
      <div className="relative aspect-[20/19] w-full overflow-hidden rounded-card bg-surface-strong">
        {place.photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- host photos on Vercel Blob
          <img src={place.photo} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-muted">
            <PinIcon size={28} />
          </span>
        )}
        <span className="absolute left-3 top-3 rounded-full bg-canvas px-[11px] py-1 text-[13px] font-semibold text-ink shadow-[0_2px_6px_rgb(0_0_0/0.14)]">
          {TYPE_LABEL[place.type] ?? "Stay"}
        </span>
      </div>
      <div className="flex flex-col gap-0.5 px-0.5 text-[15px] leading-5">
        <span className="truncate font-semibold">{place.place ?? "On AgentBnB"}</span>
        <span className="truncate text-muted">{place.title}</span>
        {meta.length > 0 && <span className="truncate text-muted">{meta.join(" · ")}</span>}
      </div>
    </article>
  );
}

function ProfileSkeleton() {
  return (
    <div className="grid gap-10 pt-2 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)] md:gap-14 lg:gap-20 lg:pt-6">
      <div className="h-[244px] animate-pulse rounded-[20px] bg-surface-soft" />
      <div className="space-y-4">
        <div className="h-9 w-48 animate-pulse rounded-lg bg-surface-soft" />
        <div className="h-32 animate-pulse rounded-card bg-surface-soft" />
      </div>
    </div>
  );
}
