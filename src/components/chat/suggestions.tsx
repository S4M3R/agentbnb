/** Quick replies under an agent turn; the first can be the suggested next step. */
export function Suggestions({
  items,
  onPick,
  primaryFirst = false,
}: {
  items: string[];
  onPick: (text: string) => void;
  primaryFirst?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((text, i) => (
        <button
          key={text}
          type="button"
          onClick={() => onPick(text)}
          className={`h-[38px] rounded-full border px-4 text-sm transition-colors ${
            primaryFirst && i === 0
              ? "border-ink bg-ink font-semibold text-white hover:bg-body"
              : "border-hairline font-medium hover:border-ink"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
