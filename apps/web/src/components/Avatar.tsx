import { cn } from "cn";

/** The `--avatar-*` tokens. A player keeps the same fill everywhere because it comes from their name. */
const FILLS = 8;

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : (words[0]?.[1] ?? "");
  return (first + last).toUpperCase();
}

function fillFor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return `var(--avatar-${(Math.abs(hash) % FILLS) + 1})`;
}

/** A player's initials in a colored circle. Decorative: always show the name beside it. */
export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none before:content-[attr(data-initials)]",
        size === "sm" ? "size-6 text-[0.625rem]" : "size-8 text-xs",
        className,
      )}
      // Drawn by CSS so the initials stay out of the text of the row or cell the avatar sits in.
      data-initials={initials(name)}
      style={{ backgroundColor: fillFor(name) }}
    />
  );
}
