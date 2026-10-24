import Image from "next/image";

export type Starter = { prompt: string; title: string; photo: string };

/** Photo tiles on the empty home screen; each sends its prompt. */
export function StarterCards({ starters, onPick }: { starters: Starter[]; onPick: (prompt: string) => void }) {
  return (
    <section aria-labelledby="starters-title">
      <div className="mb-3 flex items-baseline justify-between gap-3 sm:mb-3.5">
        <h2 id="starters-title" className="text-[17px] font-semibold">
          Try asking
        </h2>
        <span className="text-[13px] text-muted max-sm:hidden">Couches, spare rooms, house sits and work exchanges</span>
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-3.5 sm:grid-cols-4 sm:gap-4">
        {starters.map((s) => (
          <li key={s.prompt}>
            <button
              type="button"
              onClick={() => onPick(s.prompt)}
              className="group flex w-full flex-col gap-2 rounded-card text-left"
            >
              <span className="relative block aspect-[4/3] w-full overflow-hidden rounded-2xl bg-surface-strong">
                {/* Above the fold on the home screen, so they load first; next/image picks the size. */}
                <Image
                  src={s.photo}
                  alt=""
                  fill
                  sizes="(min-width: 640px) 190px, 45vw"
                  fetchPriority="high"
                  className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
                />
              </span>
              <span className="px-0.5 text-sm font-semibold leading-5 text-ink sm:text-[15px]">{s.title}</span>
              <span className="-mt-1.5 line-clamp-2 px-0.5 text-xs leading-4 text-muted sm:text-[13px] sm:leading-[18px]">
                {s.prompt}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
