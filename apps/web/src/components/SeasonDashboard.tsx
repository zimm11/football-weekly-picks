import { TrophyIcon } from "@phosphor-icons/react";
import { type Record3, type Standings, weekLabel, winRate } from "@picks/shared";
import { cn } from "cn";
import { useState } from "react";
import { Card, Eyebrow } from "@/components/ui/card";
import { formatAverage, formatPercent, formatRecord, ordinal } from "../format";
import { averagePoints, RankChange } from "./StandingsTable";
import { StatGrid, StatTile } from "./StatTile";

type Entry = Standings["entries"][number];
type Week = Standings["weeks"][number];

/** The signed-in player's season at a glance: where they stand, and how each week went. */
export function YourSeason({ standings, currentUserId }: { standings: Standings; currentUserId: string }) {
  const me = standings.entries.find((e) => e.userId === currentUserId);
  if (!me || standings.weeks.length === 0) return null;
  const leader = standings.entries[0];
  const behind = leader && leader.userId !== me.userId ? leader.points - me.points : 0;
  const played = me.weekly.flatMap((w, i) => (w ? [{ ...w, week: standings.weeks[i] }] : []));
  const best = played.reduce<(typeof played)[number] | undefined>(
    (a, w) => (!a || w.points > a.points ? w : a),
    undefined,
  );
  const pow = { wins: me.powWins, losses: me.powLosses, pushes: me.powPushes };

  return (
    <section aria-label="Your season" className="grid gap-3">
      <Eyebrow>Your season</Eyebrow>
      <StatGrid label="Your season stats">
        <StatTile
          label="Rank"
          value={
            <>
              {ordinal(me.rank)}
              <RankChange change={me.rankChange} />
            </>
          }
          detail={
            me.rank === 1
              ? "Leading the league"
              : `${behind} pt${behind === 1 ? "" : "s"} behind ${leader?.displayName}`
          }
        />
        <StatTile label="Points" value={me.points} detail={`${formatAverage(averagePoints(me))} a week`} />
        <StatTile
          label="Record"
          value={formatRecord(me)}
          detail={`${formatPercent(winRate(me))} against the spread`}
        />
        <StatTile
          label="POW"
          value={formatRecord(pow)}
          detail={`${formatPercent(winRate(pow))} of POWs won`}
        />
        <StatTile label="Weeks won" value={me.weeksWon} detail={`of ${standings.weeks.length} closed`} />
        <StatTile
          label="Best week"
          value={best ? best.points : "—"}
          detail={best?.week ? `${weekLabel(best.week.number)} · ${ordinal(best.rank)}` : undefined}
        />
      </StatGrid>
      <WeeklyPointsChart weeks={standings.weeks} entry={me} />
    </section>
  );
}

/**
 * Bars for the player's points each week, a tick for the league average. One series plus a reference mark,
 * so the colors stay on the theme: blue for your points, the muted ink for the average.
 */
export function WeeklyPointsChart({ weeks, entry }: { weeks: Week[]; entry: Pick<Entry, "weekly"> }) {
  const [hovered, setHovered] = useState<number>();
  const max = Math.max(1, ...weeks.map((w) => w.topPoints ?? 0), ...entry.weekly.map((w) => w?.points ?? 0));
  const shown = hovered ?? weeks.length - 1;
  const readout = (i: number) => {
    const week = weeks[i];
    const mine = entry.weekly[i];
    if (!week) return "";
    const mineText = mine
      ? `${mine.points} pts, ${ordinal(mine.rank)}${mine.isWinner ? " (won the week)" : ""}`
      : "Didn't play";
    return `${weekLabel(week.number)}: ${mineText} · league average ${formatAverage(week.averagePoints)} · top ${week.topPoints ?? "—"}`;
  };

  return (
    <Card className="gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h4 className="text-base tracking-widest text-muted-foreground">Points by week</h4>
        <div className="flex items-center gap-4 text-xs text-muted-foreground" aria-hidden>
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-[2px] bg-primary" /> You
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 bg-muted-foreground" /> League average
          </span>
        </div>
      </div>
      <ol
        aria-label="Your points by week"
        className="m-0 flex h-36 list-none items-end gap-[2px] p-0"
        onPointerLeave={() => setHovered(undefined)}
      >
        {weeks.map((week, i) => {
          const mine = entry.weekly[i];
          const average = week.averagePoints ?? 0;
          return (
            <li
              key={week.id}
              className="relative flex h-full max-w-14 min-w-0 flex-1 flex-col justify-end"
              onPointerEnter={() => setHovered(i)}
            >
              <span className="sr-only">{readout(i)}</span>
              <div className="relative flex-1">
                {mine && (
                  <div
                    aria-hidden
                    className={cn(
                      "absolute inset-x-[15%] bottom-0 rounded-t-[3px] bg-primary transition-opacity",
                      hovered !== undefined && hovered !== i && "opacity-50",
                    )}
                    style={{ height: `${(mine.points / max) * 100}%` }}
                  />
                )}
                <div
                  aria-hidden
                  className="absolute inset-x-0 h-0.5 bg-muted-foreground"
                  style={{ bottom: `${(average / max) * 100}%` }}
                />
                {mine?.isWinner && (
                  <TrophyIcon
                    aria-hidden
                    weight="fill"
                    className="absolute left-1/2 size-3.5 -translate-x-1/2 text-win"
                    style={{ bottom: `calc(${(mine.points / max) * 100}% + 2px)` }}
                  />
                )}
              </div>
              <span
                aria-hidden
                className="mt-1 border-t pt-1 text-center text-[11px] text-muted-foreground tabular-nums"
              >
                {week.number}
              </span>
            </li>
          );
        })}
      </ol>
      <p aria-hidden className="m-0 min-h-5 text-sm text-muted-foreground">
        {readout(shown)}
      </p>
    </Card>
  );
}

/** Every player's points in every closed week, with each week's winner marked. */
export function WeekByWeekTable({
  standings,
  currentUserId,
}: {
  standings: Standings;
  currentUserId?: string;
}) {
  return (
    <section aria-label="Week by week" className="grid gap-3">
      <Eyebrow>Week by week</Eyebrow>
      <div className="table-scroll -mx-4 px-4">
        <table aria-label="Points by week" className="data-table max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-full bg-background">Player</th>
              {standings.weeks.map((week) => (
                <th key={week.id} className="num" title={weekLabel(week.number)}>
                  W{week.number}
                </th>
              ))}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {standings.entries.map((entry) => {
              const mine = entry.userId === currentUserId;
              return (
                <tr key={entry.userId}>
                  <th
                    scope="row"
                    className={cn(
                      "sticky left-0 z-10 border-b bg-background px-2.5 py-2.5 text-left font-sans text-sm font-medium tracking-normal whitespace-nowrap normal-case text-foreground",
                      mine && "font-bold shadow-[inset_3px_0_0_var(--primary)]",
                    )}
                  >
                    {entry.displayName}
                  </th>
                  {standings.weeks.map((week, i) => {
                    const result = entry.weekly[i];
                    if (!result) {
                      return (
                        <td key={week.id} className="num text-muted-foreground">
                          —
                        </td>
                      );
                    }
                    return (
                      <td
                        key={week.id}
                        className={cn(
                          "num",
                          result.isWinner && "bg-win/10 font-semibold text-win",
                          mine && !result.isWinner && "bg-primary/10",
                        )}
                        title={`${weekLabel(week.number)}: ${ordinal(result.rank)}`}
                      >
                        {result.isWinner && (
                          <TrophyIcon
                            aria-hidden
                            weight="fill"
                            className="mr-1 inline size-3.5 align-[-2px]"
                          />
                        )}
                        {result.points}
                        {result.isWinner && <span className="sr-only"> (won the week)</span>}
                      </td>
                    );
                  })}
                  <td className="num font-display text-lg">
                    <strong>{entry.points}</strong>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th
                scope="row"
                className="sticky left-0 z-10 border-b-0 bg-background px-2.5 py-2 text-left text-sm"
              >
                Avg
              </th>
              {standings.weeks.map((week) => (
                <td key={week.id} className="num border-b-0 text-muted-foreground">
                  {formatAverage(week.averagePoints)}
                </td>
              ))}
              <td className="border-b-0" />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

const SPLITS = [
  { key: "favorite", label: "Favorites", title: "Picks on the team giving points" },
  { key: "underdog", label: "Underdogs", title: "Picks on the team getting points" },
  { key: "home", label: "Home", title: "Picks on the home team" },
  { key: "away", label: "Away", title: "Picks on the road team" },
] as const;

function SplitCell({ record }: { record: Record3 }) {
  const total = record.wins + record.losses + record.pushes;
  if (total === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <>
      {formatRecord(record)}
      <span className="ml-1.5 text-muted-foreground">{formatPercent(winRate(record))}</span>
    </>
  );
}

/** How each player does picking favorites, underdogs, home and road teams. */
export function PickSplitsTable({ entries, currentUserId }: { entries: Entry[]; currentUserId?: string }) {
  return (
    <section aria-label="Pick splits" className="grid gap-3">
      <Eyebrow>Pick splits</Eyebrow>
      <div className="table-scroll -mx-4 px-4">
        <table aria-label="Pick splits" className="data-table max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
          <thead>
            <tr>
              <th>Player</th>
              {SPLITS.map((s) => (
                <th key={s.key} className="num" title={s.title}>
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.userId} className={entry.userId === currentUserId ? "bg-primary/10" : undefined}>
                <td className="font-medium">
                  {entry.userId === currentUserId ? <strong>{entry.displayName}</strong> : entry.displayName}
                </td>
                {SPLITS.map((s) => (
                  <td key={s.key} className="num">
                    <SplitCell record={entry.splits[s.key]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m-0 text-sm text-muted-foreground">
        Records against the spread. Pick'em games count as home or away only.
      </p>
    </section>
  );
}
