import { CheckCircleIcon, LockIcon, PencilSimpleLineIcon } from "@phosphor-icons/react";
import {
  coveringSide,
  formatLine,
  type Game,
  isAutoPow,
  LOCK_HOUR,
  lineFor,
  type Pick,
  POW_BONUS,
  pickWindow,
  type Side,
  type SubmitPicks,
  teamName,
} from "@picks/shared";
import { cn } from "cn";
import { type FormEvent, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { kickoffDay, kickoffTime, matchup } from "../format";
import { useUnsavedGuard } from "./ConfirmDialog";
import { TAB_BAR_OFFSET } from "./LeagueNav";

// A pressed button stays fully lit after it locks, so a frozen pick still reads as the pick.
const pickButton =
  "min-h-14 rounded-md border-2 border-input bg-background transition-colors enabled:hover:border-primary/60 disabled:cursor-not-allowed disabled:aria-[pressed=false]:opacity-40";
const sideClass = cn(
  pickButton,
  "grid min-w-0 content-center gap-0.5 px-3 py-1.5 text-left aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground",
);
const powClass = cn(
  pickButton,
  "w-14 font-display text-base font-extrabold tracking-wider text-muted-foreground aria-pressed:border-pow aria-pressed:bg-pow aria-pressed:text-pow-foreground",
);

type Props = {
  games: Game[];
  /** What the player has already saved. */
  picks: Pick[];
  tiebreakerGameId: string | null;
  tiebreakerTotal: number | null;
  timeZone: string;
  /** Passed in (not read from the clock) so the lock states are testable. */
  now: Date;
  /** Resolves to an error message, or undefined on success. */
  onSave: (submission: SubmitPicks) => Promise<string | undefined>;
};

export function PickSheet({ games, picks, tiebreakerGameId, tiebreakerTotal, timeZone, now, onSave }: Props) {
  const saved = new Map(picks.map((p) => [p.gameId, p.side]));
  const savedPow = picks.find((p) => p.isPow)?.gameId ?? null;

  const [sides, setSides] = useState<Record<string, Side>>(() => Object.fromEntries(saved));
  const [pow, setPow] = useState<string | null>(savedPow);
  const [total, setTotal] = useState(tiebreakerTotal === null ? "" : String(tiebreakerTotal));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "saved" | "error"; text: string }>();

  // A game with a result is closed, whatever the clock says.
  const windowOf = (game: Game) =>
    pickWindow({ kickoff: new Date(game.kickoff), final: game.homeScore !== null }, timeZone, now);
  const savedPowGame = games.find((g) => g.id === savedPow);
  // Once it is 6am on the day of the game holding the POW, the POW can't move.
  const powFrozen = !!savedPowGame && windowOf(savedPowGame) !== "open";
  const tiebreakerGame = games.find((g) => g.id === tiebreakerGameId);
  // After 6am on Sunday a player with no saved POW gets the tiebreaker (Monday night) game, and only that one.
  const autoPow = isAutoPow({
    games: games.map((g) => ({ id: g.id, kickoff: new Date(g.kickoff) })),
    tiebreakerGameId,
    hasPow: savedPow !== null,
    timeZone,
    now,
  });
  const tiebreakerWindow = tiebreakerGame ? windowOf(tiebreakerGame) : "closed";
  const tiebreakerLocked =
    tiebreakerWindow === "closed" || (tiebreakerWindow === "late" && tiebreakerTotal !== null);

  function choose(game: Game, side: Side) {
    setMessage(undefined);
    setSides((prev) => ({ ...prev, [game.id]: side }));
  }

  function togglePow(game: Game) {
    setMessage(undefined);
    setPow((prev) => (prev === game.id ? null : game.id));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    const error = await onSave({
      picks: Object.entries(sides).map(([gameId, side]) => ({ gameId, side })),
      powGameId: pow,
      tiebreakerTotal: total.trim() === "" ? null : Number(total),
    });
    setPending(false);
    setMessage(error ? { kind: "error", text: error } : { kind: "saved", text: "Picks saved." });
  }

  const days: { day: string; games: Game[] }[] = [];
  for (const game of games) {
    const day = kickoffDay(game.kickoff, timeZone);
    const last = days[days.length - 1];
    if (last?.day === day) last.games.push(game);
    else days.push({ day, games: [game] });
  }

  const picked = games.filter((g) => sides[g.id]).length;
  const dirty =
    games.some((g) => sides[g.id] !== saved.get(g.id)) ||
    pow !== savedPow ||
    total.trim() !== (tiebreakerTotal === null ? "" : String(tiebreakerTotal));

  // Where the player stands, going by what is saved rather than what is tapped but not yet saved.
  const savedCount = games.filter((g) => saved.has(g.id)).length;
  const unsavedGames = games.filter((g) => !saved.has(g.id));
  const left = unsavedGames.filter((g) => windowOf(g) !== "closed").length;
  const missed = unsavedGames.length - left;
  const needsTotal = !!tiebreakerGame && tiebreakerTotal === null && !tiebreakerLocked;
  // Leaving the POW to its default is allowed, but it is a choice the player hasn't made yet. It stops
  // counting once it can no longer be made: after 6am on Sunday, or when every game has locked.
  const needsPow = savedPow === null && !autoPow && games.some((g) => windowOf(g) === "open");

  // Warn before a tab tap, a link or a reload throws away picks that haven't been saved.
  const unsavedDialog = useUnsavedGuard(dirty, "picks");

  return (
    <form onSubmit={submit} className="grid gap-3">
      {unsavedDialog}
      <PickStatus
        dirty={dirty}
        savedCount={savedCount}
        gameCount={games.length}
        left={left}
        missed={missed}
        needsTotal={needsTotal}
        needsPow={needsPow}
        pow={
          savedPowGame
            ? matchup(savedPowGame)
            : tiebreakerGame && saved.has(tiebreakerGame.id)
              ? `defaults to ${matchup(tiebreakerGame)}`
              : null
        }
      />
      <p className="m-0 text-sm text-muted-foreground">
        Picks and your POW lock at {LOCK_HOUR}am on game day. A missed pick can still go in until kickoff, but
        it can't be your POW. Your POW is worth {POW_BONUS} extra points if it wins.
      </p>

      {days.map(({ day, games: dayGames }) => (
        <section key={day} aria-label={day} className="grid gap-2">
          <h4 className="mt-2 text-lg tracking-widest text-muted-foreground">{day}</h4>
          {dayGames.map((game) => {
            const window = windowOf(game);
            const sideLocked = window === "closed" || (window === "late" && saved.has(game.id));
            const autoPowHere = autoPow && game.id === tiebreakerGameId;
            const powLocked = window !== "open" || powFrozen || !sides[game.id] || (autoPow && !autoPowHere);
            const isPow = pow === game.id || (autoPowHere && pow === null && !!sides[game.id]);
            const covered = coveringSide({ ...game, kickoff: new Date(game.kickoff) });
            const mine = sides[game.id];
            return (
              <div className="grid gap-2.5 rounded-md border bg-card p-3" key={game.id}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-muted-foreground">
                  <span className="mr-auto tabular-nums">{kickoffTime(game.kickoff, timeZone)}</span>
                  {game.id === tiebreakerGameId && <Badge variant="outline">Tiebreaker game</Badge>}
                  {window === "late" && !saved.has(game.id) && (
                    <Badge variant="warn">Late pick: final once saved, can't be POW</Badge>
                  )}
                  {sideLocked && covered === null && (
                    <Badge variant="outline">
                      <LockIcon aria-hidden weight="fill" className="size-3.5" />
                      Locked
                    </Badge>
                  )}
                  {covered !== null && (
                    <Badge variant="outline">
                      Final {game.awayScore}–{game.homeScore}
                    </Badge>
                  )}
                  {covered !== null && mine && (
                    <Badge variant={covered === mine ? "win" : covered === "push" ? "outline" : "loss"}>
                      {covered === mine ? "Won" : covered === "push" ? "Push" : "Lost"}
                    </Badge>
                  )}
                  <Badge className="-skew-x-12">
                    {game.points} {game.points === 1 ? "pt" : "pts"}
                  </Badge>
                </div>
                <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  {(["away", "home"] as const).map((side) => {
                    const team = teamName(side === "home" ? game.homeTeam : game.awayTeam);
                    const line = formatLine(team, lineFor(side, game.spread ?? 0));
                    return (
                      <button
                        key={side}
                        type="button"
                        // The team and its line are set on separate rows, so say them together.
                        aria-label={line}
                        aria-pressed={mine === side}
                        disabled={sideLocked}
                        onClick={() => choose(game, side)}
                        className={sideClass}
                      >
                        <span className="truncate font-display text-lg leading-tight font-bold uppercase sm:text-xl sm:tracking-wide">
                          {team}
                        </span>
                        <span className="text-sm tabular-nums opacity-80">
                          {line.slice(team.length + 1)}
                          {side === "home" && " · home"}
                        </span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    aria-label={`POW: ${matchup(game)}`}
                    aria-pressed={isPow}
                    disabled={powLocked}
                    onClick={() => togglePow(game)}
                    className={powClass}
                  >
                    POW
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      ))}

      {tiebreakerGame && (
        <div className="mt-2 rounded-md border bg-card p-3">
          <Field label={`Tiebreaker: total points scored in ${matchup(tiebreakerGame)}`}>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={200}
              step={1}
              value={total}
              disabled={tiebreakerLocked}
              className="max-w-32 text-lg font-semibold tabular-nums"
              onChange={(e) => {
                setMessage(undefined);
                setTotal(e.target.value);
              }}
            />
          </Field>
        </div>
      )}

      {!pow && tiebreakerGame && (
        <p className="m-0 text-sm text-muted-foreground">
          {autoPow
            ? `It is after ${LOCK_HOUR}am on Sunday, so your POW is automatically your pick in ${matchup(tiebreakerGame)}.`
            : `No POW chosen. If you leave it that way, your pick in ${matchup(tiebreakerGame)} becomes your POW.`}
        </p>
      )}

      {/* Always on screen, so saving never means scrolling past sixteen games. */}
      <div className={cn("sticky z-30 -mx-4 mt-2 border-t bg-chrome", TAB_BAR_OFFSET)}>
        <div
          role="progressbar"
          aria-label="Games picked"
          aria-valuemin={0}
          aria-valuemax={games.length}
          aria-valuenow={picked}
          className="h-1 bg-secondary"
        >
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: `${(picked / Math.max(games.length, 1)) * 100}%` }}
          />
        </div>
        <div className="flex items-center gap-3 px-4 py-3">
          <Button type="submit" disabled={pending} className="min-w-36">
            {pending ? "Saving…" : "Save picks"}
          </Button>
          <div className="grid min-w-0 gap-1">
            <span className="text-sm text-muted-foreground tabular-nums">
              {picked} of {games.length} picked
            </span>
            {dirty && !message && <Badge variant="warn">Unsaved changes</Badge>}
            {message?.kind === "saved" && <Notice kind="status">{message.text}</Notice>}
            {message?.kind === "error" && <Notice kind="alert">{message.text}</Notice>}
          </div>
        </div>
      </div>
    </form>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The answer to "do I still need to do anything this week?", at the top of the sheet. It counts saved
 * picks only: green once nothing is left to do, a countdown of games while there is.
 */
function PickStatus({
  dirty,
  savedCount,
  gameCount,
  left,
  missed,
  needsTotal,
  needsPow,
  pow,
}: {
  dirty: boolean;
  savedCount: number;
  gameCount: number;
  /** Games with no saved pick that can still be picked. */
  left: number;
  /** Games that closed without a pick. */
  missed: number;
  needsTotal: boolean;
  /** No POW saved, and there is still time to choose one. */
  needsPow: boolean;
  /** The saved POW, or the default it falls back to. Null when there isn't one yet. */
  pow: string | null;
}) {
  const box = "flex items-center gap-3 rounded-md border border-l-4 p-3";
  const savedLine = `${savedCount} of ${gameCount} saved`;

  if (dirty) {
    return (
      <section aria-label="Pick status" className={cn(box, "border-l-destructive bg-destructive/10")}>
        <PencilSimpleLineIcon aria-hidden weight="fill" className="size-8 shrink-0 text-destructive" />
        <div>
          <p className="m-0 font-display text-xl leading-tight font-bold tracking-wide uppercase">
            Not saved yet
          </p>
          <p className="m-0 text-sm text-muted-foreground">
            You've made changes. Press Save to keep them. {savedLine} so far.
          </p>
        </div>
      </section>
    );
  }

  const extras = Number(needsTotal) + Number(needsPow);

  if (left === 0 && extras === 0) {
    return (
      <section aria-label="Pick status" className={cn(box, "border-l-win bg-win/10")}>
        <CheckCircleIcon aria-hidden weight="fill" className="size-8 shrink-0 text-win" />
        <div>
          <p className="m-0 font-display text-xl leading-tight font-bold tracking-wide text-win uppercase">
            You're set for the week
          </p>
          <p className="m-0 text-sm text-muted-foreground">
            {missed === 0
              ? `All ${plural(gameCount, "game", "games")} picked and saved.`
              : `${savedLine}; ${plural(missed, "game", "games")} locked without a pick.`}
            {pow && ` POW: ${pow}.`} Nothing more to do. You can still change a pick until it locks.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Pick status" className={cn(box, "border-l-primary bg-primary/10")}>
      <span className="min-w-10 text-center font-display text-5xl leading-none font-extrabold text-primary tabular-nums">
        {/* With every game picked, what is left is the POW, the tiebreaker guess, or both. */}
        {left || extras}
      </span>
      <div>
        <p className="m-0 font-display text-xl leading-tight font-bold tracking-wide uppercase">
          {left === 0
            ? `${extras === 1 ? "thing" : "things"} left to do`
            : `${left === 1 ? "game" : "games"} left to pick`}
        </p>
        <p className="m-0 text-sm text-muted-foreground">
          {savedLine}.{needsPow && " Choose your POW."}
          {needsTotal && " Add your tiebreaker guess."}
        </p>
      </div>
    </section>
  );
}
