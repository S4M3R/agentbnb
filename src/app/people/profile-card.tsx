import { Avatar } from "@/components/ui/avatar";
import { CalendarIcon, CheckIcon, HomeIcon, MessageIcon, ShieldIcon } from "@/components/ui/icons";

// The pieces of a member's public profile, shared by /people/[id] and the live preview on
// /me/profile. Presentational only: they render whatever profile they're given.

export type ProfileView = {
  name: string;
  avatarUrl: string | null;
  bio: string | null;
  homeCity: string | null;
  languages: string[];
  verified: boolean;
  memberSince: Date | string;
  /** Live AgentBnB places, for the stat on the card. */
  places?: number;
};

export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

export function memberSince(d: Date | string) {
  return new Date(d).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function languageList(languages: string[]) {
  return new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(languages);
}

/** Airbnb's host card: the face and name on the left, a few stats on the right. */
export function ProfileCard({ profile }: { profile: ProfileView }) {
  const joined = new Date(profile.memberSince);
  const stats = [
    { value: profile.places ?? 0, label: profile.places === 1 ? "Place" : "Places" },
    { value: profile.languages.length, label: profile.languages.length === 1 ? "Language" : "Languages" },
    { value: joined.getUTCFullYear(), label: "Joined" },
  ];
  return (
    <section
      aria-label={`${profile.name}'s card`}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-6 rounded-[20px] bg-canvas p-6 shadow-[0_6px_20px_rgb(0_0_0/0.12)]"
    >
      <div className="flex min-w-0 flex-col items-center text-center">
        <div className="relative">
          <Avatar name={profile.name} src={profile.avatarUrl} size={104} />
          {profile.verified && (
            <span
              title="Verified"
              className="absolute bottom-0.5 right-0.5 flex size-8 items-center justify-center rounded-full bg-rausch text-white ring-[3px] ring-canvas"
            >
              <ShieldIcon size={15} strokeWidth={2.4} />
            </span>
          )}
        </div>
        <h2 className="mt-3 max-w-full break-words text-[28px] font-bold leading-8 tracking-[-0.02em]">
          {firstName(profile.name)}
        </h2>
        {profile.verified ? (
          <p className="mt-1 inline-flex items-center gap-1 text-[13px] font-semibold">
            <ShieldIcon size={13} strokeWidth={2.4} className="text-rausch" />
            Verified
          </p>
        ) : (
          <p className="mt-1 text-[13px] font-medium text-muted">AgentBnB member</p>
        )}
      </div>
      <dl className="w-24 divide-y divide-hairline">
        {stats.map((s) => (
          <div key={s.label} className="py-2.5 first:pt-0 last:pb-0">
            <dd className="text-[22px] font-bold leading-6 tabular-nums">{s.value}</dd>
            <dt className="text-[11px] font-semibold leading-4 text-ink">{s.label}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** "Confirmed information", only for verified members. */
export function ConfirmedInfo({ profile }: { profile: ProfileView }) {
  if (!profile.verified) return null;
  return (
    <section className="rounded-[20px] border border-hairline p-6">
      <h2 className="text-[18px] font-semibold tracking-[-0.18px]">{firstName(profile.name)}&apos;s confirmed information</h2>
      <p className="mt-4 flex items-center gap-3 text-[15px]">
        <CheckIcon size={18} strokeWidth={2.4} />
        Identity
      </p>
    </section>
  );
}

/** The "About" column: where they live, what they speak, when they joined, then the bio. */
export function ProfileAbout({
  profile,
  heading = "h1",
  emptyBio,
}: {
  profile: ProfileView;
  heading?: "h1" | "h2";
  /** Shown when there's no bio yet. */
  emptyBio?: string;
}) {
  const first = firstName(profile.name);
  const Heading = heading;
  const facts = [
    profile.homeCity && { icon: HomeIcon, text: `Lives in ${profile.homeCity}` },
    profile.languages.length > 0 && { icon: MessageIcon, text: `Speaks ${languageList(profile.languages)}` },
    { icon: CalendarIcon, text: `Member since ${memberSince(profile.memberSince)}` },
  ].filter((f) => !!f);

  return (
    <div className="@container">
      <Heading className="break-words text-[28px] font-bold leading-tight tracking-[-0.01em]">About {first}</Heading>
      <ul className="mt-6 grid gap-x-8 gap-y-4 @lg:grid-cols-2">
        {facts.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-3 text-[16px] leading-6">
            <Icon size={22} strokeWidth={1.6} className="mt-px shrink-0" />
            <span className="min-w-0 break-words">{text}</span>
          </li>
        ))}
      </ul>
      {profile.bio ? (
        <p className="mt-7 whitespace-pre-line break-words text-[16px] leading-relaxed text-body">{profile.bio}</p>
      ) : (
        <p className="mt-7 text-[15px] text-muted">{emptyBio ?? `${first} hasn't written a bio yet.`}</p>
      )}
    </div>
  );
}
