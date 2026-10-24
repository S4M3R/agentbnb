import { CloseIcon } from "@/components/ui/icons";

export type Attachment = { id: string; preview: string; state: "uploading" | "ready" | "failed" };

/** Photos waiting to be sent: dimmed while uploading, grey with a label if the upload failed. */
export function AttachmentTray({ items, onRemove }: { items: Attachment[]; onRemove: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((a) => (
        <li key={a.id} className="relative size-16 overflow-hidden rounded-xl bg-surface-strong">
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview of a picked photo */}
          <img
            src={a.preview}
            alt=""
            className={`size-full object-cover ${a.state === "uploading" ? "opacity-50" : ""} ${a.state === "failed" ? "grayscale" : ""}`}
          />
          {a.state === "uploading" && (
            <span role="status" aria-label="Uploading" className="absolute inset-0 animate-pulse bg-white/30" />
          )}
          {a.state === "failed" && (
            <span className="absolute inset-x-0 bottom-0 bg-error text-center text-[10px] font-semibold text-white">
              Failed
            </span>
          )}
          <button
            type="button"
            onClick={() => onRemove(a.id)}
            aria-label="Remove photo"
            className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/70 text-white"
          >
            <CloseIcon size={12} strokeWidth={2.6} />
          </button>
        </li>
      ))}
    </ul>
  );
}
