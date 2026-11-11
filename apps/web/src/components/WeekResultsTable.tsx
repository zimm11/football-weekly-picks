import { coveringSide, formatLine, type Game, lineFor, type WeekResults } from "@picks/shared";
import { matchup } from "../format";

type Props = {
  games: Game[];
  results: WeekResults;
  tiebreakerGameId: string | null;
  /** Highlights the signed-in player's row. */
  currentUserId?: string;
};

/** Everyone's picks for a closed week: one row per player, one column per game. */
export function WeekResultsTable({ games, results, tiebreakerGameId, currentUserId }: Props) {
  const pickOf = new Map(results.picks.map((p) => [`${p.userId}:${p.gameId}`, p.side]));
  const tiebreakerGame = games.find((g) => g.id === tiebreakerGameId);
  const actualTotal =
    tiebreakerGame && tiebreakerGame.homeScore !== null && tiebreakerGame.awayScore !== null
      ? tiebreakerGame.homeScore + tiebreakerGame.awayScore
      : null;
  const winners = results.entries.filter((e) => e.isWinner).map((e) => e.displayName);

  return (
    <>
      {winners.length > 0 && (
        <p>
          <strong>
            {winners.length === 1 ? "Winner" : "Winners"}: {winners.join(", ")}
          </strong>
        </p>
      )}
      <div className="table-scroll">
        <table aria-label="Week results">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Player</th>
              <th className="num">Pts</th>
              <th className="num">W–L</th>
              <th className="num">{actualTotal === null ? "Tiebreaker" : `Tiebreaker (${actualTotal})`}</th>
              {games.map((game) => (
                <th key={game.id} title={`${game.points} pts`}>
                  {matchup(game)}
                  <br />
                  {formatLine(game.homeTeam, lineFor("home", game.spread ?? 0))} · {game.awayScore}–
                  {game.homeScore}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.entries.map((entry) => (
              <tr key={entry.userId} className={entry.isWinner ? "winner" : undefined}>
                <td className="num">{entry.rank}</td>
                <td>
                  {entry.userId === currentUserId ? <strong>{entry.displayName}</strong> : entry.displayName}
                  {entry.removed && <span className="muted"> (no longer in the league)</span>}
                </td>
                <td className="num">
                  <strong>{entry.points}</strong>
                </td>
                <td className="num">
                  {entry.wins}–{entry.losses}
                  {entry.pushes > 0 && `–${entry.pushes}`}
                </td>
                <td className="num">{entry.tiebreakerGuess ?? "—"}</td>
                {games.map((game) => {
                  const side = pickOf.get(`${entry.userId}:${game.id}`);
                  if (!side) return <td key={game.id}>—</td>;
                  const covered = coveringSide({ ...game, kickoff: new Date(game.kickoff) });
                  const outcome = covered === side ? "win" : covered === "push" ? undefined : "loss";
                  return (
                    <td key={game.id} className={outcome}>
                      {side === "home" ? game.homeTeam : game.awayTeam}
                      {entry.powGameId === game.id && (
                        <>
                          {" "}
                          <span className="badge pow">POW</span>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
