import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import { type Standings, winRate } from "@picks/shared";
import { formatAverage, formatPercent, formatRecord } from "../format";

type Entry = Standings["entries"][number];

type Props = {
  entries: Entry[];
  currentUserId?: string;
};

/** Points per week played, or null before the player has played one. */
export function averagePoints(entry: Pick<Entry, "weekly">): number | null {
  const played = entry.weekly.filter((w) => w !== null);
  return played.length === 0 ? null : played.reduce((a, w) => a + w.points, 0) / played.length;
}

/** ▲2 / ▼1 beside the rank: places moved since the week before the latest one. */
export function RankChange({ change }: { change: number | null }) {
  if (!change) return null;
  const up = change > 0;
  const Icon = up ? CaretUpIcon : CaretDownIcon;
  return (
    <span
      className={`ml-1 inline-flex items-center font-sans text-xs font-semibold ${up ? "text-win" : "text-muted-foreground"}`}
    >
      <Icon aria-hidden weight="fill" className="size-3" />
      {Math.abs(change)}
      <span className="sr-only">
        {up ? " up" : " down"} {Math.abs(change)} since last week
      </span>
    </span>
  );
}

/** Season leaderboard. Pts, POWs, W–L and the night-game columns are the season tiebreakers, in order. */
export function StandingsTable({ entries, currentUserId }: Props) {
  return (
    <div className="table-scroll -mx-4 px-4">
      <table aria-label="Season standings" className="data-table max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Player</th>
            <th className="num">Pts</th>
            <th className="num" title="Pick of the Week record (wins break ties)">
              POW
            </th>
            <th className="num">W–L</th>
            <th className="num" title="Share of decided picks won">
              Win %
            </th>
            <th className="num" title="Average points per week">
              Avg
            </th>
            <th className="num" title="Monday night wins">
              MNF
            </th>
            <th className="num" title="Sunday night wins">
              SNF
            </th>
            <th className="num" title="Weeks won">
              Wks
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.userId} className={entry.userId === currentUserId ? "bg-primary/10" : undefined}>
              <td className="num font-display text-lg font-bold text-muted-foreground">
                {entry.rank}
                <RankChange change={entry.rankChange} />
              </td>
              <td className="font-medium">
                {entry.userId === currentUserId ? <strong>{entry.displayName}</strong> : entry.displayName}
                {entry.removed && <span className="text-muted-foreground"> (no longer in the league)</span>}
              </td>
              <td className="num font-display text-xl">
                <strong>{entry.points}</strong>
              </td>
              <td className="num">
                {formatRecord({ wins: entry.powWins, losses: entry.powLosses, pushes: entry.powPushes })}
              </td>
              <td className="num">{formatRecord(entry)}</td>
              <td className="num">{formatPercent(winRate(entry))}</td>
              <td className="num">{formatAverage(averagePoints(entry))}</td>
              <td className="num">{entry.mondayWins}</td>
              <td className="num">{entry.sundayNightWins}</td>
              <td className="num">{entry.weeksWon}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
