import type { Standings } from "@picks/shared";

type Props = {
  entries: Standings["entries"];
  currentUserId?: string;
};

/** Season leaderboard. Columns after W–L are the season tiebreakers, in order. */
export function StandingsTable({ entries, currentUserId }: Props) {
  return (
    <div className="table-scroll -mx-4 px-4">
      <table aria-label="Season standings" className="data-table max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Player</th>
            <th className="num">Pts</th>
            <th className="num" title="Pick of the Week wins">
              POWs
            </th>
            <th className="num">W–L</th>
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
              <td className="num font-display text-lg font-bold text-muted-foreground">{entry.rank}</td>
              <td className="font-medium">
                {entry.userId === currentUserId ? <strong>{entry.displayName}</strong> : entry.displayName}
                {entry.removed && <span className="text-muted-foreground"> (no longer in the league)</span>}
              </td>
              <td className="num font-display text-xl">
                <strong>{entry.points}</strong>
              </td>
              <td className="num">{entry.powWins}</td>
              <td className="num">
                {entry.wins}–{entry.losses}
                {entry.pushes > 0 && `–${entry.pushes}`}
              </td>
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
