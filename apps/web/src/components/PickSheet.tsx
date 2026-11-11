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
import { type FormEvent, useEffect, useState } from "react";
import { kickoffDay, kickoffTime, matchup } from "../format";

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

  // Warn before a reload or tab close throws away picks that haven't been saved.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <form onSubmit={submit}>
      <p className="muted">
        Picks and your POW lock at {LOCK_HOUR}am on game day. A missed pick can still go in until kickoff, but
        it can't be your POW. Your POW is worth {POW_BONUS} extra points if it wins.
      </p>

      {days.map(({ day, games: dayGames }) => (
        <section key={day} aria-label={day}>
          <h4 className="day">{day}</h4>
          {dayGames.map((game) => {
            const window = windowOf(game);
            const sideLocked = window === "closed" || (window === "late" && saved.has(game.id));
            const autoPowHere = autoPow && game.id === tiebreakerGameId;
            const powLocked = window !== "open" || powFrozen || !sides[game.id] || (autoPow && !autoPowHere);
            const isPow = pow === game.id || (autoPowHere && pow === null && !!sides[game.id]);
            const covered = coveringSide({ ...game, kickoff: new Date(game.kickoff) });
            const mine = sides[game.id];
            return (
              <div className="game" key={game.id}>
                <div className="game-meta">
                  <span>{kickoffTime(game.kickoff, timeZone)}</span>
                  <span className="badge">
                    {game.points} {game.points === 1 ? "pt" : "pts"}
                  </span>
                  {game.id === tiebreakerGameId && <span className="badge">Tiebreaker game</span>}
                  {window === "late" && !saved.has(game.id) && (
                    <span className="badge loss">Late pick: final once saved, can't be POW</span>
                  )}
                  {sideLocked && covered === null && <span className="badge">Locked</span>}
                  {covered !== null && (
                    <span className="badge">
                      Final {game.awayScore}–{game.homeScore}
                    </span>
                  )}
                  {covered !== null && mine && (
                    <span className={`badge ${covered === mine ? "win" : covered === "push" ? "" : "loss"}`}>
                      {covered === mine ? "Won" : covered === "push" ? "Push" : "Lost"}
                    </span>
                  )}
                </div>
                <div className="game-picks">
                  {(["away", "home"] as const).map((side, i) => {
                    const abbr = side === "home" ? game.homeTeam : game.awayTeam;
                    const line = formatLine(teamName(abbr), lineFor(side, game.spread ?? 0));
                    return [
                      i === 1 && (
                        <span className="at" key="at">
                          at
                        </span>
                      ),
                      <button
                        key={side}
                        type="button"
                        className="side"
                        aria-pressed={mine === side}
                        disabled={sideLocked}
                        onClick={() => choose(game, side)}
                      >
                        {line}
                      </button>,
                    ];
                  })}
                  <button
                    type="button"
                    className="pow"
                    aria-label={`POW: ${matchup(game)}`}
                    aria-pressed={isPow}
                    disabled={powLocked}
                    onClick={() => togglePow(game)}
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
        <div className="game">
          <label>
            Tiebreaker: total points scored in {matchup(tiebreakerGame)}
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={200}
              step={1}
              value={total}
              disabled={tiebreakerLocked}
              onChange={(e) => {
                setMessage(undefined);
                setTotal(e.target.value);
              }}
            />
          </label>
        </div>
      )}

      {!pow && tiebreakerGame && (
        <p className="muted">
          {autoPow
            ? `It is after ${LOCK_HOUR}am on Sunday, so your POW is automatically your pick in ${matchup(tiebreakerGame)}.`
            : `No POW chosen. If you leave it that way, your pick in ${matchup(tiebreakerGame)} becomes your POW.`}
        </p>
      )}

      <div className="savebar">
        <button type="submit" className="primary" disabled={pending}>
          Save picks
        </button>
        <span className="muted">
          {picked} of {games.length} picked
        </span>
        {dirty && !message && <span className="badge pow">Unsaved changes</span>}
        {message?.kind === "saved" && <p role="status">{message.text}</p>}
        {message?.kind === "error" && <p role="alert">{message.text}</p>}
      </div>
    </form>
  );
}
