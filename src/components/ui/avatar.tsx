/** A round photo, or the first letter of `name` on ink when there is no photo. */
export function Avatar({
  name,
  src,
  size = 36,
  className = "",
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- member and host photos come from many hosts
    return <img src={src} alt="" style={style} className={`shrink-0 rounded-full object-cover ${className}`} />;
  }
  return (
    <span
      aria-hidden="true"
      style={{ ...style, fontSize: Math.round(size * 0.42) }}
      className={`flex shrink-0 items-center justify-center rounded-full bg-ink font-semibold text-white ${className}`}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Overlapping faces, for "these three hosts". */
export function AvatarStack({ people, size = 26 }: { people: { name: string; src?: string | null }[]; size?: number }) {
  return (
    <span className="flex">
      {people.map((p, i) => (
        <Avatar key={p.name} name={p.name} src={p.src} size={size} className={`ring-2 ring-canvas ${i ? "-ml-2" : ""}`} />
      ))}
    </span>
  );
}
