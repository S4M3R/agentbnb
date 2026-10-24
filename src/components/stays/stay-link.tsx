import { PanelRightIcon } from "@/components/ui/icons";

/** A listing mentioned in the chat; opens it in the side panel. Outlined while that panel is open. */
export function StayLink({
  title,
  detail,
  photo,
  open,
  onOpen,
}: {
  title: string;
  detail: string;
  photo?: string | null;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={open}
      className={`flex w-full items-center gap-3 rounded-[14px] border-[1.5px] p-2 pr-3.5 text-left transition-colors ${open ? "border-ink" : "border-hairline hover:border-ink"}`}
    >
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element -- listing photo
        <img src={photo} alt="" className="size-14 shrink-0 rounded-[10px] object-cover" />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-semibold">{title}</span>
        <span className="truncate text-sm text-muted">{detail}</span>
      </span>
      <PanelRightIcon size={18} className="shrink-0" />
    </button>
  );
}
