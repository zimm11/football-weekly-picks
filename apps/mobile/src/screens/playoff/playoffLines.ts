import {
  coveringSide,
  type GuillotineStatus,
  hasResult,
  LAST_WEEK,
  PLAYOFF_ROUNDS,
  SUPER_BOWL_ROUND,
  teamName,
  type WeekStatus,
  type WeekView,
  weekLabel,
} from "@picks/shared";

/*
 * What playoff pick'em says about where a player and the postseason stand, as pure functions: the Guillotine
 * status line on a round's pick sheet, and the Picks tab's card between rounds. The screens draw them.
 */

/** A status line: in or out (drawn with an icon as well as a color), a headline and a sentence under it. */
export type StatusLine = { out: boolean; title: string; detail: string };

/** A round inside a sentence: "the Wild Card round", "the Super Bowl". */
export const roundInSentence = (number: number) =>
  number === SUPER_BOWL_ROUND ? `the ${weekLabel(number)}` : `the ${weekLabel(number)} round`;

const capitalized = (text: string) => `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;

/** Why the guillotine put a player out: "Your POW lost in the Wild Card round". */
function outReason(status: Pick<GuillotineStatus, "outIn" | "reason">, fallbackRound: number) {
  const round = roundInSentence(status.outIn ?? fallbackRound);
  return status.reason === "pow_lost" ? `Your POW lost in ${round}` : `You had no POW in ${round}`;
}

/**
 * A Guillotine round's status line on the pick sheet, from the player's own saved picks: whether they are still
 * in, and what their POW means for that. It follows the POW once one is saved ("Your POW: Bills. If it
 * loses…") instead of asking for one the player has already chosen. Null outside a Guillotine round.
 */
export function guillotineLine(
  view: Pick<WeekView, "number" | "games" | "myPicks" | "playoff">,
): StatusLine | null {
  const playoff = view.playoff;
  if (playoff?.format !== "guillotine" || !playoff.me) return null;
  const { me, mayPick } = playoff;
  if (me.state === "out" && me.outIn !== null) {
    const why = outReason(me, view.number);
    return mayPick
      ? {
          out: true,
          title: `You're out after ${roundInSentence(me.outIn)}`,
          detail: `${why}. Finish this round's picks: they still count.`,
        }
      : {
          out: true,
          title: "You're out of picking",
          detail: `${why}. You keep your points and your place, and you can still guess the Super Bowl's total.`,
        };
  }
  const title = "You're in";
  if (view.number === SUPER_BOWL_ROUND) {
    return {
      out: false,
      title,
      detail:
        "No POW in the Super Bowl: nobody goes out now. Your pick and your total guess decide the rest.",
    };
  }
  const pow = view.myPicks.find((pick) => pick.isPow);
  const game = pow && view.games.find((g) => g.id === pow.gameId);
  if (!pow || !game) {
    return {
      out: false,
      title,
      detail: "Choose a POW: if it loses, or you skip it, you're out from the next round.",
    };
  }
  const team = teamName(pow.side === "home" ? game.homeTeam : game.awayTeam);
  if (!hasResult(game)) {
    return { out: false, title, detail: `Your POW: ${team}. If it loses, you're out from the next round.` };
  }
  // Still in with the POW's game over: it covered, or it pushed (a push survives).
  const pushed = coveringSide({ ...game, kickoff: new Date(game.kickoff) }) === "push";
  return {
    out: false,
    title,
    detail: pushed
      ? `Your POW (${team}) pushed, and a push sends you on to the next round.`
      : `Your POW (${team}) won: on to the next round.`,
  };
}

/**
 * The Picks tab's card while no round is open: which round comes next and what opens it, or that the playoffs
 * are over. `weeks` are the selected season's rounds as the league lists them.
 */
export function playoffWaiting(weeks: { year: number; number: number; status: WeekStatus }[]): {
  over: boolean;
  /** The round that opens next, or null once all four are final. */
  next: number | null;
  title: string;
  detail: string;
} {
  const final = new Set(weeks.filter((w) => w.status === "final").map((w) => w.number));
  const next = PLAYOFF_ROUNDS.find((n) => !final.has(n)) ?? null;
  if (next === null) {
    const year = weeks[0]?.year;
    return {
      over: true,
      next,
      title: year ? `The ${year} playoffs are over` : "The playoffs are over",
      detail: "The champion and everyone's final place are on Standings.",
    };
  }
  const posted = next === LAST_WEEK ? "its game and line are posted" : "its games and lines are posted";
  return {
    over: false,
    next,
    title: "No round is open",
    detail:
      final.size === 0 && next === PLAYOFF_ROUNDS[0]
        ? `${capitalized(roundInSentence(next))} opens by itself once ${posted}, after the regular season ends.`
        : `${capitalized(roundInSentence(next))} opens once ${posted}.`,
  };
}

/**
 * Between rounds, where the guillotine has left a player, from the standings (final rounds only). Out: said
 * plainly, with what they keep. In: only once a round has been played, with what the next one asks of them.
 */
export function guillotineBetweenRounds(
  status: Pick<GuillotineStatus, "state" | "outIn" | "reason"> | null | undefined,
  next: number | null,
  roundsPlayed: number,
): StatusLine | null {
  if (!status || next === null) return null;
  if (status.state === "out" && status.outIn !== null) {
    return {
      out: true,
      title: "You're out of picking",
      detail: `${outReason(status, status.outIn)}. You keep your points and your place, and you can still guess the Super Bowl's total.`,
    };
  }
  if (roundsPlayed === 0) return null;
  return {
    out: false,
    title: "You're in",
    detail:
      next === SUPER_BOWL_ROUND
        ? "You made it to the Super Bowl: nobody goes out there."
        : `Choose a POW in ${roundInSentence(next)}: if it loses, or you skip it, you're out.`,
  };
}
