import { cn } from "cn";
import { useState } from "react";

/**
 * A team's logo from ESPN's image CDN, in the variant drawn for dark backgrounds. ESPN resizes it on
 * request, so a 28px logo is a few kilobytes rather than the 500px original. The abbreviations are ESPN's
 * own (they come from its schedule feed), so they map straight onto its file names.
 */
export function teamLogoUrl(abbr: string, size: number): string {
  // Twice the drawn size, so it stays sharp on a phone's high-density screen.
  const px = size * 2;
  return `https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500-dark/${abbr.toLowerCase()}.png&h=${px}&w=${px}`;
}

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
