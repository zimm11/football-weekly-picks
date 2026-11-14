import { coveringSide, type WeekView, weekLabel } from "@picks/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatRecord, matchup, ordinal } from "../format";
import { Link } from "../router";
import { StatTile } from "./StatTile";
import { awardsFor, WeekAwards } from "./WeekAwards";

type Props = {
  /** A final week: `results` must be present. */
  view: WeekView;
  userId: string;
  onClose: () => void;
};

/**
 * The first look at a week that has just been closed: how the signed-in player finished, who won, who is
 * the Low Point Loser, and the rest of the awards, with a way through to the full results.
 */
export function WeekRecap({ view, userId, onClose }: Props) {
  const results = view.results;
  if (!results) return null;
  const me = results.entries.find((e) => e.userId === userId);
  const awards = awardsFor({ games: view.games, results, tiebreakerGameId: view.tiebreakerGameId });
  const myPow = me?.powGameId ? view.games.find((g) => g.id === me.powGameId) : undefined;
  const powPushed = myPow ? coveringSide({ ...myPow, kickoff: new Date(myPow.kickoff) }) === "push" : false;

  const headline = !me
    ? "The results are in."
    : me.isWinner
      ? awards.winners.length > 1
        ? "You shared the win. Half a trophy is still a trophy."
        : "You won the week. Take a bow."
      : awards.lowPointLosers.includes(userId)
        ? "You're this week's Low Point Loser. Somebody had to be."
        : `You finished ${ordinal(me.rank)} of ${results.entries.length}.`;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" showCloseButton={false}>
        <SheetHeader className="pr-4">
          <SheetTitle>{weekLabel(view.number)} is final</SheetTitle>
          <SheetDescription>{headline}</SheetDescription>
        </SheetHeader>
        <div className="grid gap-5 px-4">
          {me && (
            <dl aria-label="Your week" className="m-0 grid grid-cols-3 gap-2">
              <StatTile label="Finish" value={ordinal(me.rank)} detail={`of ${results.entries.length}`} />
              <StatTile label="Points" value={me.points} detail={formatRecord(me)} />
              <StatTile
                label="POW"
                value={me.powGameId ? (me.powWon ? "Won" : powPushed ? "Push" : "Lost") : "None"}
                detail={myPow ? matchup(myPow) : undefined}
              />
            </dl>
          )}
          <WeekAwards
            games={view.games}
            results={results}
            tiebreakerGameId={view.tiebreakerGameId}
            showWinner
          />
        </div>
        <SheetFooter>
          <Link to={`/weeks/${view.id}`} className={buttonVariants()} onClick={onClose}>
            See everyone's picks
          </Link>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
