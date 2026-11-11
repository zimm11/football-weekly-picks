import { coveringSide, type Game, type WeekResults, weekSummary } from "@picks/shared";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Card, Eyebrow } from "@/components/ui/card";
import { formatAverage, formatRecord, matchup, ordinal } from "../format";
import { StatGrid, StatTile } from "./StatTile";

type Props = {
  games: Game[];
  results: WeekResults;
  tiebreakerGameId: string | null;
  currentUserId?: string;
};

/** A closed week in numbers: how the signed-in player finished, and how the league did. */
export function WeekSummary({ games, results, tiebreakerGameId, currentUserId }: Props) {
  const { entries } = results;
  const me = entries.find((e) => e.userId === currentUserId);
  const { topPoints, averagePoints } = weekSummary(entries);
  const tiebreakerGame = games.find((g) => g.id === tiebreakerGameId);
  const actualTotal =
    tiebreakerGame && tiebreakerGame.homeScore !== null && tiebreakerGame.awayScore !== null
      ? tiebreakerGame.homeScore + tiebreakerGame.awayScore
      : null;
  const winnerCount = entries.filter((e) => e.isWinner).length;
  const powHits = entries.filter((e) => e.powWon).length;
  const myPow = me?.powGameId ? games.find((g) => g.id === me.powGameId) : undefined;
  const powPushed = myPow ? coveringSide({ ...myPow, kickoff: new Date(myPow.kickoff) }) === "push" : false;

  return (
    <StatGrid label="Week summary">
      {me && (
        <StatTile
          label="Your finish"
          value={ordinal(me.rank)}
          detail={me.isWinner ? "You won the week" : `of ${entries.length} players`}
        />
      )}
      {me && (
        <StatTile label="Your points" value={me.points} detail={`${formatRecord(me)} against the spread`} />
      )}
      {me && (
        <StatTile
          label="Your POW"
          value={me.powGameId ? (me.powWon ? "Won" : powPushed ? "Push" : "Lost") : "None"}
          detail={myPow ? matchup(myPow) : undefined}
        />
      )}
      <StatTile
        label="Winning score"
        value={topPoints ?? "—"}
        detail={winnerCount > 1 ? `Shared by ${winnerCount}` : undefined}
      />
      <StatTile
        label="League average"
        value={formatAverage(averagePoints)}
        detail={`${powHits} of ${entries.length} POWs hit`}
      />
      <StatTile
        label="Tiebreaker total"
        value={actualTotal ?? "—"}
        detail={me?.tiebreakerGuess != null ? `You guessed ${me.tiebreakerGuess}` : undefined}
      />
    </StatGrid>
  );
}

/** For each game: who covered, how the league split, and how many got it right. */
export function GameBreakdown({ games, results }: Pick<Props, "games" | "results">) {
  const players = results.entries.length;
  const powCount = new Map<string, number>();
  for (const e of results.entries)
    if (e.powGameId) powCount.set(e.powGameId, (powCount.get(e.powGameId) ?? 0) + 1);

  return (
    <section aria-label="Game by game" className="grid gap-3">
      <Eyebrow>Game by game</Eyebrow>
      <ul className="m-0 grid list-none gap-2 p-0 md:grid-cols-2">
        {games.map((game) => {
          const picks = results.picks.filter((p) => p.gameId === game.id);
          const away = picks.filter((p) => p.side === "away").length;
          const home = picks.length - away;
          const covered = coveringSide({ ...game, kickoff: new Date(game.kickoff) });
          const right = covered === "home" ? home : covered === "away" ? away : 0;
          const awayShare = picks.length ? away / picks.length : 0.5;
          const pows = powCount.get(game.id) ?? 0;
          const side = (team: string, count: number, didCover: boolean) => (
            <span
              className={cn("flex items-baseline gap-1.5", didCover ? "text-win" : "text-muted-foreground")}
            >
              <span className="font-display text-lg font-bold">{team}</span>
              <span className="text-sm tabular-nums">{count}</span>
            </span>
          );
          return (
            <li key={game.id} aria-label={matchup(game)}>
              <Card className="gap-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-base font-bold tracking-wide uppercase">
                    {matchup(game)}{" "}
                    <span className="font-sans font-normal text-muted-foreground normal-case tracking-normal">
                      · {game.awayScore}–{game.homeScore}
                    </span>
                  </span>
                  {covered === "push" ? (
                    <Badge variant="outline">Push</Badge>
                  ) : covered ? (
                    <Badge variant="win">{covered === "home" ? game.homeTeam : game.awayTeam} covered</Badge>
                  ) : null}
                </div>
                <div className="flex items-center justify-between">
                  {side(game.awayTeam, away, covered === "away")}
                  {side(game.homeTeam, home, covered === "home")}
                </div>
                {/* Two segments with a 2px gap; the covering side wears the result color, the other the muted ink. */}
                <div aria-hidden className="flex h-2 gap-[2px]">
                  {away > 0 && (
                    <div
                      className={cn(
                        "rounded-l-[3px]",
                        covered === "away" ? "bg-win" : "bg-muted-foreground/40",
                        home === 0 && "rounded-r-[3px]",
                      )}
                      style={{ flexGrow: awayShare }}
                    />
                  )}
                  {home > 0 && (
                    <div
                      className={cn(
                        "rounded-r-[3px]",
                        covered === "home" ? "bg-win" : "bg-muted-foreground/40",
                        away === 0 && "rounded-l-[3px]",
                      )}
                      style={{ flexGrow: 1 - awayShare }}
                    />
                  )}
                  {picks.length === 0 && <div className="flex-1 rounded-[3px] bg-muted" />}
                </div>
                <p className="m-0 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                  <span>{covered === "push" ? "Nobody scored" : `${right} of ${players} got it right`}</span>
                  {pows > 0 && (
                    <span className="flex items-center gap-1">
                      <Badge variant="pow" className="h-4 px-1 text-xs">
                        POW
                      </Badge>
                      ×{pows}
                    </span>
                  )}
                </p>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
