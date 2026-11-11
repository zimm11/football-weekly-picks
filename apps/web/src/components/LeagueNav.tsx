import { FootballIcon, ListChecksIcon, TrophyIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { cn } from "cn";
import type { ReactNode } from "react";
import { Link } from "../router";

export type LeagueTab = "picks" | "results" | "standings" | "league";

const TABS = [
  { tab: "picks", label: "Picks", path: "", icon: FootballIcon },
  { tab: "results", label: "Results", path: "/results", icon: ListChecksIcon },
  { tab: "standings", label: "Standings", path: "/standings", icon: TrophyIcon },
  { tab: "league", label: "League", path: "/league", icon: UsersThreeIcon },
] as const;

/** Height of the phone tab bar. Anything else pinned to the bottom edge sits this far above it. */
export const TAB_BAR_OFFSET = "bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] md:bottom-0";

/** The four places inside a league: a bar along the bottom of a phone, a row under the league name on wider screens. */
export function LeagueNav({ leagueId, active }: { leagueId: string; active: LeagueTab }) {
  return (
    <nav
      aria-label="League"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t bg-chrome pb-safe md:static md:flex md:gap-1 md:border-t-0 md:border-b md:bg-transparent md:pb-0"
    >
      {TABS.map(({ tab, label, path, icon: Icon }) => (
        <Link
          key={tab}
          to={`/leagues/${leagueId}${path}`}
          aria-current={tab === active ? "page" : undefined}
          className={cn(
            "flex h-16 flex-col items-center justify-center gap-0.5 border-t-[3px] border-transparent font-display text-sm font-bold tracking-wider text-muted-foreground uppercase no-underline",
            "md:h-12 md:flex-row md:gap-2 md:border-t-0 md:border-b-[3px] md:px-4 md:text-lg",
            "hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:text-primary",
          )}
        >
          <Icon aria-hidden className="size-6 md:size-5" weight={tab === active ? "fill" : "regular"} />
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** The frame every screen inside a league shares: its name, the tabs, then the screen. */
export function LeagueLayout({
  leagueId,
  leagueName,
  active,
  seasonSelector,
  children,
}: {
  leagueId: string;
  leagueName: string;
  active: LeagueTab;
  seasonSelector?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <Link
          to="/"
          className="w-fit py-1 text-sm font-medium text-muted-foreground no-underline hover:text-foreground"
        >
          ‹ All leagues
        </Link>
        <h2 className="text-3xl leading-none font-extrabold">{leagueName}</h2>
      </div>
      {seasonSelector}
      <LeagueNav leagueId={leagueId} active={active} />
      {children}
    </div>
  );
}
