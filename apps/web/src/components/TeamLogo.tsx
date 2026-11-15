import { teamLogoUrl } from "@picks/shared";
import { cn } from "cn";
import { useState } from "react";

/**
 * Decorative: the team's name or abbreviation is always written beside it, so it has no alt text.
 * A side with no logo (a Pro Bowl team, say) or a failed download leaves an empty space of the same size.
 */
export function TeamLogo({ abbr, size, className }: { abbr: string; size: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };
  if (failed) return <span aria-hidden className={cn("inline-block shrink-0", className)} style={box} />;
  return (
    <img
      src={teamLogoUrl(abbr, size)}
      alt=""
      {...box}
      loading="lazy"
      decoding="async"
      // Page addresses carry league and week ids; ESPN has no need of them.
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn("inline-block shrink-0 object-contain", className)}
    />
  );
}
