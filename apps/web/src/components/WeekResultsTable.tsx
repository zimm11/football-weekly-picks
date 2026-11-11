// biome-ignore-all lint/a11y/noRedundantRoles: on a phone these rows are laid out as cards, and a browser drops a table's built-in roles once its display changes. The explicit roles keep it a table for screen readers.
import { TrophyIcon } from "@phosphor-icons/react";
import { coveringSide, formatLine, type Game, lineFor, type WeekResults } from "@picks/shared";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { matchup } from "../format";
import { TeamLogo } from "./TeamLogo";

type Props = {
  games: Game[];
  results: WeekResults;
  tiebreakerGameId: string | null;
  /** Highlights the signed-in player's row. */
  currentUserId?: string;
};

/**
 * Everyone's picks for a closed week: one row per player, one column per game.
 * On a phone each row becomes a card with the player's picks as a grid of team chips.
 */
export function WeekResultsTable({ games, results, tiebreakerGameId, currentUserId }: Props) {
  const pickOf = new Map(results.picks.map((p) => [`${p.userId}:${p.gameId}`, p.side]));
  const tiebreakerGame = games.find((g) => g.id === tiebreakerGameId);
  const actualTotal =
    tiebreakerGame && tiebreakerGame.homeScore !== null && tiebreakerGame.awayScore !== null
      ? tiebreakerGame.homeScore + tiebreakerGame.awayScore
      : null;
  const winners = results.entries.filter((e) => e.isWinner).map((e) => e.displayName);
  const tiebreakerHeading = actualTotal === null ? "Tiebreaker" : `Tiebreaker (${actualTotal})`;

  return (
    <div className="grid gap-4">
      {winners.length > 0 && (
        <p className="m-0 flex items-center gap-2 font-display text-2xl font-bold tracking-wide uppercase">
          <TrophyIcon aria-hidden weight="fill" className="size-6 text-primary" />
          <strong>
            {winners.length === 1 ? "Winner" : "Winners"}: {winners.join(", ")}
          </strong>
        </p>
      )}
      <div className="table-scroll">
        <table role="table" aria-label="Week results" className="data-table card-rows">
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" className="num">
                #
              </th>
              <th scope="col">Player</th>
              <th scope="col" className="num">
                Pts
              </th>
              <th scope="col" className="num">
                W–L
              </th>
              <th scope="col" className="num">
                {tiebreakerHeading}
              </th>
              {games.map((game) => (
                <th scope="col" key={game.id} title={`${game.points} pts`}>
                  <span className="flex items-center gap-1">
                    <TeamLogo abbr={game.awayTeam} size={18} />
                    {matchup(game)}
                    <TeamLogo abbr={game.homeTeam} size={18} />
                  </span>
                  <span className="font-sans font-normal tracking-normal normal-case">
                    {formatLine(game.homeTeam, lineFor("home", game.spread ?? 0))} · {game.awayScore}–
                    {game.homeScore}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {results.entries.map((entry) => (
              <tr
                role="row"
                key={entry.userId}
                className={cn(
                  "max-md:grid-cols-6",
                  entry.isWinner && "shadow-[inset_3px_0_0_var(--primary)]",
                  entry.userId === currentUserId && "md:bg-primary/10",
                )}
              >
                <td
                  role="cell"
                  className="num font-display text-lg font-bold text-muted-foreground max-md:text-left"
                >
                  {entry.rank}
                </td>
                <td role="cell" className="font-medium max-md:col-span-3 max-md:text-lg">
                  {entry.userId === currentUserId ? <strong>{entry.displayName}</strong> : entry.displayName}
                  {entry.removed && <span className="text-muted-foreground"> (no longer in the league)</span>}
                </td>
                <td
                  role="cell"
                  className="num font-display text-xl max-md:col-span-2 max-md:text-3xl max-md:leading-none"
                >
                  <strong>{entry.points}</strong>
                </td>
                <td role="cell" data-label="W–L" className="num max-md:col-span-3 max-md:text-left">
                  {entry.wins}–{entry.losses}
                  {entry.pushes > 0 && `–${entry.pushes}`}
                </td>
                <td
                  role="cell"
                  data-label={tiebreakerHeading}
                  className="num max-md:col-span-3 max-md:text-left"
                >
                  {entry.tiebreakerGuess ?? "—"}
                </td>
                {games.map((game) => {
                  const side = pickOf.get(`${entry.userId}:${game.id}`);
                  const chip =
                    "max-md:flex max-md:min-h-11 max-md:py-1.5 max-md:flex-col max-md:items-center max-md:justify-center max-md:gap-0.5 max-md:rounded-md max-md:border max-md:font-display max-md:text-base max-md:font-bold";
                  if (!side) {
                    return (
                      <td role="cell" key={game.id} className={cn(chip, "text-muted-foreground")}>
                        —
                      </td>
                    );
                  }
                  const covered = coveringSide({ ...game, kickoff: new Date(game.kickoff) });
                  const outcome = covered === side ? "win" : covered === "push" ? "push" : "loss";
                  return (
                    <td
                      role="cell"
                      key={game.id}
                      className={cn(
                        chip,
                        outcome === "win" && "bg-win/10 font-semibold text-win max-md:border-win/40",
                        outcome === "loss" && "text-muted-foreground",
                      )}
                    >
                      <TeamLogo
                        abbr={side === "home" ? game.homeTeam : game.awayTeam}
                        size={22}
                        className={cn("md:mr-1.5", outcome === "loss" && "opacity-45 grayscale")}
                      />
                      <span className={outcome === "loss" ? "line-through" : undefined}>
                        {side === "home" ? game.homeTeam : game.awayTeam}
                      </span>
                      {entry.powGameId === game.id && (
                        <>
                          {" "}
                          <Badge variant="pow" className="h-4 px-1 text-xs">
                            POW
                          </Badge>
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
    </div>
  );
}
