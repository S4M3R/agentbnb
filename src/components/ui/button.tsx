import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";

const VARIANTS = {
  primary:
    "bg-rausch text-white hover:bg-rausch-active active:bg-rausch-active disabled:bg-rausch-disabled disabled:cursor-not-allowed",
  secondary: "bg-canvas text-ink border border-ink hover:bg-surface-soft",
  ghost: "text-ink hover:bg-surface-strong",
} as const;

const SIZES = {
  md: "h-12 px-6 text-base rounded-lg",
  sm: "h-10 px-4 text-sm rounded-lg",
} as const;

type Style = { variant?: keyof typeof VARIANTS; size?: keyof typeof SIZES };

function classes({ variant = "primary", size = "md" }: Style, extra = "") {
  return `inline-flex shrink-0 items-center justify-center gap-2 font-medium transition-colors ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

export function Button({ variant, size, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & Style) {
  return <button type="button" className={classes({ variant, size }, className)} {...props} />;
}

/** An anchor styled as a Button. External links open in a new tab. */
export function ButtonLink({ variant, size, className, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & Style) {
  const external = props.href?.startsWith("http");
  return (
    <a
      className={classes({ variant, size }, className)}
      {...(external && { target: "_blank", rel: "noreferrer" })}
      {...props}
    />
  );
}

/** Round icon-only button; `label` is its accessible name. */
export function IconButton({
  label,
  tone = "outline",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; tone?: "outline" | "soft" | "rausch" | "ink" }) {
  const tones = {
    outline: "bg-canvas text-ink border border-hairline hover:shadow-float",
    soft: "bg-surface-strong text-ink hover:bg-hairline-soft",
    rausch: "bg-rausch text-white hover:bg-rausch-active disabled:bg-rausch-disabled",
    ink: "bg-ink text-white hover:bg-body",
  };
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full transition-[background-color,box-shadow] disabled:cursor-not-allowed ${tones[tone]} ${className}`}
      {...props}
    />
  );
}

/** Pill chip for suggestions and quick replies. */
export function Chip({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`inline-flex h-10 items-center gap-2 rounded-full border border-hairline bg-canvas px-4 text-sm font-medium text-ink transition-colors hover:border-ink ${className}`}
      {...props}
    />
  );
}
