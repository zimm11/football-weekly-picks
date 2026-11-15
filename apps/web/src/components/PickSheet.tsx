import {
  CaretDownIcon,
  CaretRightIcon,
  ChartBarIcon,
  CheckCircleIcon,
  InfoIcon,
  LockIcon,
  PencilSimpleLineIcon,
} from "@phosphor-icons/react";
import {
  coveringSide,
  formatLine,
  type Game,
  type GameInsights,
  isLocked,
  lineFor,
  type Pick,
  POW_BONUS,
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
import { MatchupSheet } from "./MatchupSheet";
import { TeamLogo } from "./TeamLogo";

// A pressed button stays fully lit after it locks, so a locked pick still reads as the pick.
const pickButton =
  "relative min-h-14 rounded-lg bg-raised ring-inset transition-[background-color,box-shadow,transform] enabled:hover:ring-2 enabled:hover:ring-primary/40 enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:aria-[pressed=false]:opacity-40";
const sideClass = cn(
  pickButton,
  // Logo over name on a phone, where the two buttons share a narrow row; side by side once there is room.
  "flex min-w-0 flex-col items-center justify-center gap-1 px-2 py-2.5 text-center sm:flex-row sm:justify-start sm:gap-3 sm:px-3 sm:text-left aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:shadow-md aria-pressed:shadow-primary/25",
);
const powClass = cn(
  pickButton,
  "w-14 font-display text-base font-extrabold tracking-wider text-muted-foreground aria-pressed:bg-pow aria-pressed:text-pow-foreground aria-pressed:shadow-md aria-pressed:shadow-pow/30 enabled:hover:ring-pow/40",
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
  /** Fetches a game's stats, news and market prices. Each card offers them when this is given. */
  loadInsights?: (gameId: string) => Promise<GameInsights>;
};

export function PickSheet({
  games,
  picks,
  tiebreakerGameId,
  tiebreakerTotal,
  timeZone,
  now,
  onSave,
  loadInsights,
}: Props) {
  const saved = new Map(picks.map((p) => [p.gameId, p.side]));
  const savedPow = picks.find((p) => p.isPow)?.gameId ?? null;

  const [sides, setSides] = useState<Record<string, Side>>(() => Object.fromEntries(saved));
  const [pow, setPow] = useState<string | null>(savedPow);
  const [total, setTotal] = useState(tiebreakerTotal === null ? "" : String(tiebreakerTotal));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "saved" | "error"; text: string }>();
  /** The game whose matchup sheet is open. */
  const [matchupGame, setMatchupGame] = useState<Game | null>(null);

  // A game locks at kickoff; one with a result is locked whatever the clock says.
  const locked = (game: Game) =>
    isLocked({ kickoff: new Date(game.kickoff), final: game.homeScore !== null }, now);
  const savedPowGame = games.find((g) => g.id === savedPow);
  // Once the game holding the POW has kicked off, the POW can't move.
  const powFrozen = !!savedPowGame && locked(savedPowGame);
  const tiebreakerGame = games.find((g) => g.id === tiebreakerGameId);
  const tiebreakerLocked = !tiebreakerGame || locked(tiebreakerGame);

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
  const left = unsavedGames.filter((g) => !locked(g)).length;
  const missed = unsavedGames.length - left;
  const needsTotal = !!tiebreakerGame && tiebreakerTotal === null && !tiebreakerLocked;
  // There is no automatic POW: a player who doesn't choose one has none. It stops counting as something to
  // do once no game can take it (every game has kicked off).
  const needsPow = savedPow === null && games.some((g) => !locked(g));

  // Warn before a tab tap, a link or a reload throws away picks that haven't been saved.
  const unsavedDialog = useUnsavedGuard(dirty, "picks");

  return (
    <>
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
          pow={savedPowGame ? matchup(savedPowGame) : null}
        />
        <details className="group text-sm text-muted-foreground">
          <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-1.5 font-medium hover:text-foreground [&::-webkit-details-marker]:hidden">
            <InfoIcon aria-hidden className="size-4" />
            How locks work
            <CaretDownIcon aria-hidden className="size-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <p className="m-0 pb-1">
            Each game locks at kickoff. Until then you can change your pick and put your POW on it or take it
            off. Once your POW's game kicks off, your POW stays there. It is worth {POW_BONUS} extra points if
            it wins. If you don't choose a POW, you don't get one.
          </p>
        </details>

        {days.map(({ day, games: dayGames }) => (
          <section key={day} aria-label={day} className="grid gap-2">
            <h4 className="mt-3 px-1">{day}</h4>
            {dayGames.map((game) => {
              const sideLocked = locked(game);
              const powLocked = sideLocked || powFrozen || !sides[game.id];
              const isPow = pow === game.id;
              const covered = coveringSide({ ...game, kickoff: new Date(game.kickoff) });
              const mine = sides[game.id];
              return (
                <div className="grid gap-3 rounded-xl bg-card p-3" key={game.id}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-muted-foreground">
                    <span className="mr-auto tabular-nums">{kickoffTime(game.kickoff, timeZone)}</span>
                    {game.id === tiebreakerGameId && <Badge variant="outline">Tiebreaker game</Badge>}
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
                    <Badge>
                      {game.points} {game.points === 1 ? "pt" : "pts"}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                    {(["away", "home"] as const).map((side) => {
                      const abbr = side === "home" ? game.homeTeam : game.awayTeam;
                      const team = teamName(abbr);
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
                          {mine === side && (
                            <CheckCircleIcon
                              aria-hidden
                              weight="fill"
                              className="absolute top-1.5 right-1.5 size-4 opacity-90"
                            />
                          )}
                          <TeamLogo abbr={abbr} size={36} />
                          <span className="grid min-w-0 max-w-full gap-0.5">
                            <span className="truncate font-display text-lg leading-tight font-bold uppercase sm:text-xl sm:tracking-wide">
                              {team}
                            </span>
                            <span className="text-sm font-medium tabular-nums opacity-75">
                              {line.slice(team.length + 1)}
                              {side === "home" && " · home"}
                            </span>
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
                  {loadInsights && (
                    <button
                      type="button"
                      aria-label={`Matchup: ${matchup(game)}`}
                      onClick={() => setMatchupGame(game)}
                      className="-mx-3 -mb-3 flex min-h-11 items-center gap-2 rounded-b-xl border-t px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-raised hover:text-foreground"
                    >
                      <ChartBarIcon aria-hidden weight="fill" className="size-4" />
                      Stats, news &amp; market
                      <CaretRightIcon aria-hidden weight="bold" className="ml-auto size-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </section>
        ))}

        {tiebreakerGame && (
          <div className="mt-2 rounded-xl bg-card p-3">
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

        {!pow && (
          <p className="m-0 text-sm text-muted-foreground">
            {needsPow
              ? "No POW chosen. Tap POW on a pick whose game hasn't locked yet; if you don't, you won't have one this week."
              : "No POW this week: every game has locked."}
          </p>
        )}

        {/* Always on screen, so saving never means scrolling past sixteen games. */}
        <div className={cn("sticky z-30 -mx-4 mt-2 border-t bg-chrome/90 backdrop-blur-md", TAB_BAR_OFFSET)}>
          <div
            role="progressbar"
            aria-label="Games picked"
            aria-valuemin={0}
            aria-valuemax={games.length}
            aria-valuenow={picked}
            className="h-1 bg-raised"
          >
            <div
              className="h-full rounded-r-full bg-primary transition-[width] duration-300"
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
      {/* Outside the form, so nothing in it can submit the picks. */}
      {loadInsights && (
        <MatchupSheet
          game={matchupGame}
          timeZone={timeZone}
          load={loadInsights}
          onClose={() => setMatchupGame(null)}
        />
      )}
    </>
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
  /** The saved POW. Null when there isn't one. */
  pow: string | null;
}) {
  const box = "flex items-center gap-3 rounded-xl p-3";
  const title = "m-0 font-semibold leading-tight";
  const savedLine = `${savedCount} of ${gameCount} saved`;

  if (dirty) {
    return (
      <section aria-label="Pick status" className={cn(box, "bg-destructive/10")}>
        <PencilSimpleLineIcon aria-hidden weight="fill" className="size-7 shrink-0 text-destructive" />
        <div>
          <p className={title}>Not saved yet</p>
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
      <section aria-label="Pick status" className={cn(box, "bg-win/10")}>
        <CheckCircleIcon aria-hidden weight="fill" className="size-7 shrink-0 text-win" />
        <div>
          <p className={cn(title, "text-win")}>You're set for the week</p>
          <p className="m-0 text-sm text-muted-foreground">
            {missed === 0
              ? `All ${plural(gameCount, "game", "games")} picked and saved.`
              : `${savedLine}; ${plural(missed, "game", "games")} locked without a pick.`}
            {pow ? ` POW: ${pow}.` : " No POW this week."} Nothing more to do. You can still change a pick
            until kickoff.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Pick status" className={cn(box, "bg-primary/10")}>
      <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/15 font-display text-3xl leading-none font-extrabold text-primary tabular-nums">
        {/* With every game picked, what is left is the POW, the tiebreaker guess, or both. */}
        {left || extras}
      </span>
      <div>
        <p className={title}>
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
