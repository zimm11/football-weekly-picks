import {
  type Icon,
  PawPrintIcon,
  SmileyXEyesIcon,
  StarIcon,
  TargetIcon,
  TrophyIcon,
} from "@phosphor-icons/react";
import { type Game, type WeekResults, weekAwards } from "@picks/shared";
import { cn } from "cn";
import { Eyebrow } from "@/components/ui/card";
import { matchup } from "../format";

type Props = {
  games: Game[];
  results: WeekResults;
  tiebreakerGameId: string | null;
  /**
   * Leads the list with the week's winner. Off where the winner is already announced beside it, as on the
   * results screen.
   */
  showWinner?: boolean;
};

type Award = { key: string; icon: Icon; tone?: string; title: string; names: string[]; detail: string };

const points = (n: number) => `${n} ${n === 1 ? "point" : "points"}`;

/** The week's awards for a closed week, worked out from its results. */
export function awardsFor({ games, results, tiebreakerGameId }: Omit<Props, "showWinner">) {
  return weekAwards({
    games: games.map((g) => ({ ...g, kickoff: new Date(g.kickoff) })),
    entries: results.entries,
    picks: results.picks,
    tiebreakerGameId,
  });
}

/**
 * The week's bragging rights, and the Low Point Loser. Renders nothing in a week with nothing to hand out.
 */
export function WeekAwards({ games, results, tiebreakerGameId, showWinner = false }: Props) {
  const awards = awardsFor({ games, results, tiebreakerGameId });
  const entryOf = new Map(results.entries.map((e) => [e.userId, e]));
  const nameOf = (userId: string) => entryOf.get(userId)?.displayName ?? "Player";
  const pointsOf = (userIds: string[]) => points(entryOf.get(userIds[0] ?? "")?.points ?? 0);
  const tiebreakerGame = games.find((g) => g.id === tiebreakerGameId);

  const list: Award[] = [];
  if (showWinner && awards.winners.length > 0) {
    list.push({
      key: "winner",
      icon: TrophyIcon,
      tone: "text-primary",
      title: awards.winners.length === 1 ? "Winner" : "Winners",
      names: awards.winners.map(nameOf),
      detail: `Top of the week with ${pointsOf(awards.winners)}.`,
    });
  }
  if (awards.lowPointLosers.length > 0) {
    list.push({
      key: "lpl",
      icon: SmileyXEyesIcon,
      title: awards.lowPointLosers.length === 1 ? "Low Point Loser" : "Low Point Losers",
      names: awards.lowPointLosers.map(nameOf),
      detail: `Bottom of the week with ${pointsOf(awards.lowPointLosers)}. Wear it with pride.`,
    });
  }
  if (awards.perfectWeeks.length > 0) {
    list.push({
      key: "perfect",
      icon: StarIcon,
      tone: "text-win",
      title: "Perfect week",
      names: awards.perfectWeeks.map(nameOf),
      detail: "Picked every game and won them all.",
    });
  }
  if (awards.bullseyes.length > 0 && tiebreakerGame) {
    list.push({
      key: "bullseye",
      icon: TargetIcon,
      tone: "text-win",
      title: "Bullseye",
      names: awards.bullseyes.map(nameOf),
      detail: `Called the tiebreaker total exactly: ${(tiebreakerGame.homeScore ?? 0) + (tiebreakerGame.awayScore ?? 0)}.`,
    });
  }
  // One row per player, however many games they were alone on.
  const wolfGames = new Map<string, typeof awards.loneWolves>();
  for (const wolf of awards.loneWolves) {
    wolfGames.set(wolf.userId, [...(wolfGames.get(wolf.userId) ?? []), wolf]);
  }
  for (const [userId, wolves] of wolfGames) {
    const [first] = wolves;
    const game = games.find((g) => g.id === first?.gameId);
    const side = results.picks.find((p) => p.userId === userId && p.gameId === first?.gameId)?.side;
    if (!game || !side) continue;
    list.push({
      key: `wolf:${userId}`,
      icon: PawPrintIcon,
      tone: "text-win",
      title: "Lone wolf",
      names: [nameOf(userId)],
      detail:
        wolves.length === 1
          ? `The only one to take ${side === "home" ? game.homeTeam : game.awayTeam} in ${matchup(game)}, and it paid off.`
          : `Alone on the right side of ${wolves.length} games.`,
    });
  }

  if (list.length === 0) return null;
  return (
    <section aria-label="Week awards" className="grid gap-3">
      <Eyebrow>Awards</Eyebrow>
      <ul className="m-0 grid list-none gap-2 p-0 md:grid-cols-2">
        {list.map((award) => (
          <li key={award.key} className="flex items-start gap-3 rounded-md border bg-card p-3">
            <award.icon
              aria-hidden
              weight="fill"
              className={cn("mt-0.5 size-7 shrink-0", award.tone ?? "text-muted-foreground")}
            />
            <div className="grid min-w-0 gap-0.5">
              <span className="font-display text-xs font-bold tracking-wider text-muted-foreground uppercase">
                {award.title}
              </span>
              <strong className="font-display text-2xl leading-none font-bold tracking-wide break-words uppercase">
                {award.names.join(", ")}
              </strong>
              <span className="text-sm text-muted-foreground">{award.detail}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
