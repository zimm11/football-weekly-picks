import {
  CaretLeftIcon,
  ChatCircleIcon,
  FootballIcon,
  ListChecksIcon,
  TrophyIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import type { MessageThread } from "@picks/shared";
import { cn } from "cn";
import { type ReactNode, useEffect, useState } from "react";
import { api, unwrap } from "../api";
import { Link } from "../router";

export type LeagueTab = "picks" | "results" | "standings" | "league" | "messages";

const TABS = [
  { tab: "picks", label: "Picks", path: "", icon: FootballIcon },
  { tab: "results", label: "Results", path: "/results", icon: ListChecksIcon },
  { tab: "standings", label: "Standings", path: "/standings", icon: TrophyIcon },
  { tab: "messages", label: "Messages", path: "/messages", icon: ChatCircleIcon },
  { tab: "league", label: "League", path: "/league", icon: UsersThreeIcon },
] as const;

/** Height of the phone tab bar. Anything else pinned to the bottom edge sits this far above it. */
export const TAB_BAR_OFFSET = "bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] md:bottom-0";

/** The five places inside a league: a bar along the bottom of a phone, a row under the league name on wider screens. */
export function LeagueNav({ leagueId, active }: { leagueId: string; active: LeagueTab }) {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      unwrap<MessageThread[]>(api.leagues[":leagueId"].messages.$get({ param: { leagueId } })).then(
        (rows) => {
          if (alive) setUnread(rows.filter((t) => t.unread).length);
        },
        () => {},
      );
    refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener("messages-changed", refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("messages-changed", refresh);
    };
  }, [leagueId]);
  return (
    <nav
      aria-label="League"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-chrome/90 pb-safe backdrop-blur-md md:static md:flex md:gap-1 md:border-t-0 md:bg-transparent md:pb-0 md:backdrop-blur-none"
    >
      {TABS.map(({ tab, label, path, icon: Icon }) => (
        <Link
          key={tab}
          to={`/leagues/${leagueId}${path}`}
          aria-current={tab === active ? "page" : undefined}
          className={cn(
            "relative flex h-16 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium text-muted-foreground no-underline transition-colors",
            "md:h-11 md:flex-row md:gap-2 md:rounded-full md:px-4 md:text-sm",
            "hover:text-foreground aria-[current=page]:text-primary md:aria-[current=page]:bg-primary/12",
          )}
        >
          <span className="relative">
            <Icon aria-hidden className="size-6 md:size-5" weight={tab === active ? "fill" : "regular"} />
            {tab === "messages" && unread > 0 && (
              <span
                role="img"
                className="absolute -top-0.5 -right-1 size-2.5 rounded-full bg-primary ring-2 ring-chrome md:ring-background"
                aria-label={`${unread} unread threads`}
              />
            )}
          </span>
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}

/**
 * The frame every screen inside a league shares: a compact header (back link, name, season), the tabs, then
 * the screen. `seasonPanel` is anything the season control opens, such as starting a season.
 */
export function LeagueLayout({
  leagueId,
  leagueName,
  active,
  seasonSelector,
  seasonPanel,
  children,
}: {
  leagueId: string;
  leagueName: string;
  active: LeagueTab;
  seasonSelector?: ReactNode;
  seasonPanel?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-5">
      <div className="grid gap-3">
        <div className="flex items-end gap-2">
          <div className="grid min-w-0 flex-1">
            <Link
              to="/"
              className="flex w-fit items-center gap-1 py-1 text-sm font-medium text-muted-foreground no-underline hover:text-foreground"
            >
              <CaretLeftIcon aria-hidden weight="bold" className="size-3.5" />
              All leagues
            </Link>
            <h2 className="truncate text-3xl leading-none font-extrabold">{leagueName}</h2>
          </div>
          {seasonSelector}
        </div>
        {seasonPanel}
      </div>
      <LeagueNav leagueId={leagueId} active={active} />
      {children}
    </div>
  );
}
