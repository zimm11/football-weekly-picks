import { type Game, type Pick, scoreSoFar } from "@picks/shared";
import { cn } from "cn";
import { formatRecord } from "../format";

const POW_LABEL = { won: "Won", lost: "Lost", push: "Push", pending: "To play" } as const;

/**
 * The player's own running score in an open week, from the games that have ended. Nothing about anyone
 * else's picks: those stay private until the week is final. Shown once at least one of their picks is in.
 */
export function WeekSoFar({ games, picks }: { games: Game[]; picks: Pick[] }) {
  const so = scoreSoFar(
    games.map((g) => ({ ...g, kickoff: new Date(g.kickoff) })),
    picks,
  );
  const decided = so.wins + so.losses + so.pushes;
  if (decided === 0) return null;

  const tiles: { label: string; value: string; tone?: string }[] = [
    { label: "Points", value: String(so.points), tone: so.points > 0 ? "text-win" : undefined },
    { label: "Record", value: formatRecord(so) },
    {
      label: "POW",
      value: so.pow ? POW_LABEL[so.pow] : "None",
      tone: so.pow === "won" ? "text-win" : so.pow === "pending" ? "text-pow" : undefined,
    },
  ];

  return (
    <section aria-label="Your week so far" className="grid gap-2 rounded-xl bg-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h4 className="m-0">Your week so far</h4>
        <span className="text-sm text-muted-foreground">
          {so.pending === 0
            ? "All your games are in"
            : `${so.pending} ${so.pending === 1 ? "pick" : "picks"} still to play`}
        </span>
      </div>
      {/* Announced as results arrive while the sheet is open. */}
      <dl aria-live="polite" className="m-0 grid grid-cols-3 gap-2">
        {tiles.map((tile) => (
          <div key={tile.label} className="grid gap-1 rounded-lg bg-raised px-3 py-2">
            <dt className="text-xs font-medium text-muted-foreground">{tile.label}</dt>
            <dd className={cn("m-0 font-display text-2xl leading-none font-bold tabular-nums", tile.tone)}>
              {tile.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="m-0 text-xs text-muted-foreground">Unofficial until an admin finalizes the week.</p>
    </section>
  );
}
