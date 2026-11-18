import {
  BOARD_SIZE,
  type BoardGame,
  type BoardQuarter,
  type BoardSquare,
  type BoardSummary,
  type BoardView,
  estimatedWeekStart,
  LAST_WEEK,
  SQUARE_PERIOD_LABEL,
  type SquarePeriod,
  teamName,
} from "@picks/shared";
import { colors, elevation } from "../components/theme";
import { parseLeagueKickoff } from "./leagueLogic";

/*
 * The squares board's presentation, as pure functions: what each cell shows and says, the optimistic claims
 * laid over the last saved board, the grid's measurements and the Boards list's order. The screens in
 * screens/squares/ draw them.
 */

export const squareKey = (row: number, col: number) => `${row}:${col}`;

/** A change sent but not yet answered: a claim shows at once as the player's, a release as open. */
export type PendingChange = {
  row: number;
  col: number;
  claim: boolean;
  name: string;
  avatarId?: number | null;
  userId: string | null;
};

/** The board's squares with unanswered changes laid over them. */
export function withPending(squares: BoardSquare[], pending: PendingChange[]): BoardSquare[] {
  const byKey = new Map(squares.map((sq) => [squareKey(sq.row, sq.col), sq]));
  for (const change of pending) {
    const key = squareKey(change.row, change.col);
    if (change.claim) {
      byKey.set(key, {
        row: change.row,
        col: change.col,
        userId: change.userId,
        name: change.name,
        avatarId: change.avatarId,
        guest: change.userId === null,
      });
    } else byKey.delete(key);
  }
  return [...byKey.values()];
}

/** An open square chosen at random ("Claim a random square"), or null when the board is full. */
export function randomOpenSquare(
  squares: Pick<BoardSquare, "row" | "col">[],
  random: () => number = Math.random,
): { row: number; col: number } | null {
  const taken = new Set(squares.map((sq) => squareKey(sq.row, sq.col)));
  const open: { row: number; col: number }[] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) if (!taken.has(squareKey(row, col))) open.push({ row, col });
  }
  return open[Math.floor(random() * open.length)] ?? null;
}

/** A row's or column's number: the drawn digit, or "?" until the draw. */
export const digitAt = (digits: number[] | null, index: number) =>
  digits ? String(digits[index] ?? "?") : "?";

/** The periods a square has won, in order. */
export const winsOf = (quarters: BoardQuarter[], row: number, col: number): SquarePeriod[] =>
  quarters.filter((q) => q.square?.row === row && q.square.col === col).map((q) => q.period);

/** "Q1", "Half", "Q3", "Final": the short label a winning cell carries. */
export const SHORT_PERIOD: Record<SquarePeriod, string> = {
  q1: "Q1",
  half: "Half",
  q3: "Q3",
  final: "Final",
};

const joinPeriods = (periods: SquarePeriod[]) =>
  periods.map((p) => SQUARE_PERIOD_LABEL[p]).join(periods.length > 2 ? ", " : " and ");

/** Where a square sits, in words: its two numbers once drawn ("Chiefs 4, Eagles 1"), else its row and column. */
export function squarePlace(
  view: Pick<BoardView, "homeTeam" | "awayTeam" | "homeDigits" | "awayDigits">,
  row: number,
  col: number,
) {
  if (!view.homeDigits || !view.awayDigits) return `row ${row + 1}, column ${col + 1}`;
  return `${teamName(view.homeTeam)} ${view.homeDigits[col]}, ${teamName(view.awayTeam)} ${view.awayDigits[row]}`;
}

/**
 * A cell's accessible name: whose it is, its numbers, and anything it has won or would win now. "Pat's square,
 * Chiefs 4, Eagles 1, won Q1", "Your square, row 3, column 5", "Open square, Chiefs 0, Eagles 7". A quarter that
 * landed on a square nobody holds has no winner, and says so: "Open square, Chiefs 0, Eagles 7, hit Halftime,
 * nobody's square".
 */
export function cellLabel(input: {
  view: Pick<BoardView, "homeTeam" | "awayTeam" | "homeDigits" | "awayDigits">;
  row: number;
  col: number;
  square: BoardSquare | undefined;
  userId: string;
  wins: SquarePeriod[];
  current: boolean;
}) {
  const { view, row, col, square, userId, wins, current } = input;
  const whose = !square
    ? "Open square"
    : square.userId === userId
      ? "Your square"
      : `${square.name}'s square${square.guest ? " (guest)" : ""}`;
  const parts = [whose, squarePlace(view, row, col)];
  if (wins.length)
    parts.push(square ? `won ${joinPeriods(wins)}` : `hit ${joinPeriods(wins)}, nobody's square`);
  if (current) parts.push("would win if the quarter ended now");
  return parts.join(", ");
}

/**
 * What a square has won, for its sheet: "Won Q1 and Final", or "Nothing yet". A quarter that landed on a square
 * nobody holds (`held` false) is no win: "Hit Halftime: nobody's square, so no winner".
 */
export const winsText = (wins: SquarePeriod[], held = true) =>
  !wins.length
    ? "Nothing yet"
    : held
      ? `Won ${joinPeriods(wins)}`
      : `Hit ${joinPeriods(wins)}: nobody's square, so no winner`;

/** Who holds a square, as one key: the player's id, or a guest's name (guests have no account). */
export const holderKey = (holder: Pick<BoardSquare, "userId" | "name">) =>
  holder.userId ?? `guest:${holder.name}`;

/**
 * A held square's look. Solid fills mean only "yours" (`primary`) or "won" (`win`), each running from its light
 * end at the top left (`primaryLight`, `winLight`) and lifted by a glow; everyone else's square is their avatar
 * color (`colorOf`, `avatarColor` in components/Avatar.tsx), strong at the top left and fading into the card at
 * the bottom right, with the foreground's ink. Every held square has a lit top edge (`squareEdge`), so the
 * board reads as glossy tiles rather than flat paint, and your own squares still stand out from across the room.
 * `fill` is the flat color under the gradient (and all a renderer without gradients shows). The Players card
 * draws each holder's chip with the same tone, so it is the grid's legend.
 */
export function squareTone(
  { mine, won, name }: { mine: boolean; won: boolean; name: string },
  colorOf: (name: string) => string | undefined,
): { fill: string; gradient: string; shadow: string; ink: string } {
  if (won)
    return {
      fill: colors.win,
      gradient: `linear-gradient(145deg, ${colors.winLight}, ${colors.win} 65%)`,
      shadow: `${elevation.glowWin}, ${elevation.squareEdge}`,
      ink: colors.primaryForeground,
    };
  if (mine)
    return {
      fill: colors.primary,
      gradient: `linear-gradient(145deg, ${colors.primaryLight}, ${colors.primary} 65%)`,
      shadow: `${elevation.glowPrimary}, ${elevation.squareEdge}`,
      ink: colors.primaryForeground,
    };
  const hue = colorOf(name) ?? colors.avatars[0];
  return {
    fill: `${hue}66`,
    gradient: `linear-gradient(145deg, ${hue}e6, ${hue}4d)`,
    shadow: elevation.squareEdge,
    ink: colors.foreground,
  };
}

const words = (name: string) => name.trim().split(/\s+/).filter(Boolean);

/**
 * What each holder is called on this board's squares (keyed by `holderKey`), as short as stays unique among
 * everyone holding one: the first name ("Chris"); with the last name's initial when two holders share it
 * ("Chris M", "Chris H"); the whole name when that still collides. Compared ignoring case, guests included.
 */
export function boardNames(holders: Pick<BoardSquare, "userId" | "name">[]): Map<string, string> {
  const unique = new Map<string, Pick<BoardSquare, "userId" | "name">>();
  for (const holder of holders) unique.set(holderKey(holder), holder);
  const first = (name: string) => words(name)[0] ?? name;
  const firstAndInitial = (name: string) => {
    const w = words(name);
    return w.length > 1 ? `${w[0]} ${(w.at(-1) ?? "").charAt(0).toUpperCase()}` : name.trim();
  };
  const tally = (pick: (name: string) => string) => {
    const counts = new Map<string, number>();
    for (const { name } of unique.values()) {
      const key = pick(name).toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return (name: string) => counts.get(pick(name).toLowerCase()) === 1;
  };
  const firstIsUnique = tally(first);
  const initialIsUnique = tally(firstAndInitial);
  const names = new Map<string, string>();
  for (const [key, { name }] of unique) {
    names.set(
      key,
      firstIsUnique(name) ? first(name) : initialIsUnique(name) ? firstAndInitial(name) : name.trim(),
    );
  }
  return names;
}

/**
 * Each holder's initials on this board (keyed by `holderKey`), for a square too narrow for their name: two
 * letters as their avatar shows them ("CM"), and the last name's first two when two holders share those
 * ("CMA", "CMO").
 */
export function boardInitials(holders: Pick<BoardSquare, "userId" | "name">[]): Map<string, string> {
  const unique = new Map<string, string>();
  for (const holder of holders) unique.set(holderKey(holder), holder.name);
  const two = (name: string) => {
    const w = words(name);
    return ((w[0]?.[0] ?? "?") + (w.length > 1 ? (w.at(-1)?.[0] ?? "") : (w[0]?.[1] ?? ""))).toUpperCase();
  };
  const counts = new Map<string, number>();
  for (const name of unique.values()) counts.set(two(name), (counts.get(two(name)) ?? 0) + 1);
  const initials = new Map<string, string>();
  for (const [key, name] of unique) {
    const w = words(name);
    const clash = (counts.get(two(name)) ?? 0) > 1 && w.length > 1;
    initials.set(key, clash ? `${w[0]?.[0] ?? ""}${(w.at(-1) ?? "").slice(0, 2)}`.toUpperCase() : two(name));
  }
  return initials;
}

/**
 * Barlow Condensed SemiBold's advance widths for the printable ASCII characters (space to "~"), in thousandths
 * of an em, read from assets/fonts/BarlowCondensed_600SemiBold.ttf. They size a name to its square without
 * laying the text out first.
 */
const CONDENSED_WIDTHS = [
  200, 269, 306, 606, 434, 772, 581, 152, 279, 279, 361, 439, 199, 325, 211, 386, 450, 274, 425, 426, 459,
  428, 429, 392, 434, 423, 252, 218, 439, 439, 439, 413, 759, 456, 462, 457, 472, 435, 415, 462, 477, 224,
  443, 477, 415, 538, 507, 467, 457, 455, 461, 434, 452, 478, 471, 665, 460, 456, 406, 330, 386, 330, 413,
  405, 206, 434, 437, 422, 437, 426, 291, 431, 439, 215, 211, 433, 199, 665, 439, 432, 441, 441, 313, 398,
  282, 438, 415, 592, 417, 403, 368, 319, 171, 319, 480,
];

/**
 * How wide `text` sets in Barlow Condensed SemiBold at `fontSize`. A letter outside ASCII (an accent, another
 * script) counts as a wide one, and an emoji as a full em, so an estimate errs toward not fitting.
 */
export function condensedWidth(text: string, fontSize: number): number {
  let thousandths = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    thousandths +=
      code >= 32 && code < 127 ? (CONDENSED_WIDTHS[code - 32] ?? 480) : code >= 0x2000 ? 1000 : 520;
  }
  return (thousandths / 1000) * fontSize;
}

/** The room a square leaves its name: 2px each side, so the letters don't touch the edge. */
const NAME_INSET = 4;

/**
 * What a held square shows for its holder: their board name (`boardNames`) when it fits the square at the
 * layout's `holderSize`, else their initials (`boardInitials`), never a name cut short.
 */
export function cellName(
  key: string,
  names: Map<string, string>,
  initials: Map<string, string>,
  layout: { cell: number; holderSize: number },
): string {
  const name = names.get(key);
  if (name && condensedWidth(name, layout.holderSize) <= layout.cell - NAME_INSET) return name;
  return initials.get(key) ?? "?";
}

/**
 * The player's own squares once the numbers are drawn, in the grid's reading order: each with its two numbers
 * (home first, as `squarePlace` orders them: "WSH 8 · TB 5"), the quarters it has won and whether it would win
 * now. Empty before the draw, when a square has no numbers yet.
 */
export function mySquares(
  view: Pick<
    BoardView,
    "homeTeam" | "awayTeam" | "homeDigits" | "awayDigits" | "squares" | "quarters" | "current"
  >,
  userId: string,
) {
  const { homeDigits, awayDigits } = view;
  if (!homeDigits || !awayDigits) return [];
  return view.squares
    .filter((sq) => sq.userId === userId)
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .map((sq) => ({
      square: sq,
      row: sq.row,
      col: sq.col,
      numbers: `${view.homeTeam} ${homeDigits[sq.col]} · ${view.awayTeam} ${awayDigits[sq.row]}`,
      wins: winsOf(view.quarters, sq.row, sq.col),
      current: view.current?.row === sq.row && view.current.col === sq.col,
    }));
}

/** What a score is, in the scoreboard's words: "After Q1", "Halftime", "After Q3", "Final", and for a screen reader. */
export function scoreStatus(period: SquarePeriod) {
  const name = SQUARE_PERIOD_LABEL[period];
  const settled = period === "final" || period === "half";
  return {
    status: settled ? name : `After ${name}`,
    label: settled ? `${name} score` : `Score after ${name}`,
  };
}

/** The gap between cells, in every size of grid. */
export const GRID_GAP = 2;

/** The grid card's height besides its eleven rows of cells: its padding, the home team's name, and the gaps. */
const gridChrome = (bleed: boolean, side: number) =>
  2 * (bleed ? 10 : 16) + side + 4 + (bleed ? 2 : 6) + BOARD_SIZE * GRID_GAP;

/**
 * The grid's measurements for the width the page gives it (`contentWidth`, inside the page's `gutter` on each
 * side), so all ten columns always show: no sideways scrolling. Left of the cells sit two narrow columns: the
 * away team's name, turned to read up the side (`side`), then its numbers (`axis`).
 * - Under 560px of screen the card runs edge to edge (`bleed`) with 4px of padding: 32px cells on a 390px
 *   phone, 25px at 320px. Cells may be under the 44px tap size there, because the whole board has to be in view.
 * - From 560px the card sits inside the gutter and its cells are 43px or more, growing to 56px.
 * - With `maxHeight` (the room from the card's top to the window's bottom: the desktop layout, where the grid
 *   sits beside a rail), the whole card also fits that height: cells stop at 52px, and don't shrink under 40px
 *   for the height (the width still has the last word).
 */
export function gridLayout(contentWidth: number, gutter = 16, maxHeight?: number) {
  const bleed = contentWidth + 2 * gutter < 560;
  const padding = bleed ? 4 : 12;
  const side = bleed ? 18 : 24;
  const axis = bleed ? 22 : 28;
  const inner = (bleed ? contentWidth + 2 * gutter : contentWidth) - 2 * padding;
  const widthFit = Math.floor((inner - side - axis - BOARD_SIZE * GRID_GAP) / BOARD_SIZE);
  const heightFit =
    maxHeight === undefined
      ? 56
      : Math.min(52, Math.max(40, Math.floor((maxHeight - gridChrome(bleed, side)) / (BOARD_SIZE + 1))));
  const cell = Math.max(16, Math.min(56, widthFit, heightFit));
  return {
    bleed,
    padding,
    /** The width of the column holding the away team's name. */
    side,
    /** The width of the column of row numbers. */
    axis,
    cell,
    /** The ten cells of a row or column, with the gaps between them. */
    span: BOARD_SIZE * cell + (BOARD_SIZE - 1) * GRID_GAP,
    /** The whole board: the name column, the number column, ten cells and the gaps between them. */
    width: side + axis + BOARD_SIZE * (cell + GRID_GAP),
    /** The whole card's height: its padding, the home team's name, the row of numbers and the ten rows. */
    height: gridChrome(bleed, side) + (BOARD_SIZE + 1) * cell,
    /** Room for a holder's name and a quarter's label, one above the other; a smaller cell shows one of them. */
    twoLines: cell >= 32,
    /** Type sizes that stay readable as the cell shrinks. */
    digitSize: Math.max(13, Math.min(22, Math.round(cell * 0.5))),
    nameSize: bleed ? (cell < 28 ? 13 : 14) : 18,
    /** A holder's name in their square (Barlow Condensed, `cellName`). */
    holderSize: cell >= 52 ? 15 : cell >= 44 ? 13 : 11,
    labelSize: cell >= 52 ? 12 : cell >= 44 ? 11 : cell >= 30 ? 10 : 9,
  };
}

/**
 * Where an arrow key moves the keyboard focus on the grid: one square over, stopping at the edges; Home and End
 * go to the ends of the row. Undefined for any other key, or when there is nowhere to go.
 */
export function gridMove(key: string, row: number, col: number): { row: number; col: number } | undefined {
  const last = BOARD_SIZE - 1;
  const next =
    key === "ArrowUp"
      ? { row: row - 1, col }
      : key === "ArrowDown"
        ? { row: row + 1, col }
        : key === "ArrowLeft"
          ? { row, col: col - 1 }
          : key === "ArrowRight"
            ? { row, col: col + 1 }
            : key === "Home"
              ? { row, col: 0 }
              : key === "End"
                ? { row, col: last }
                : undefined;
  if (!next || next.row < 0 || next.row > last || next.col < 0 || next.col > last) return undefined;
  return next.row === row && next.col === col ? undefined : next;
}

/**
 * The NFL week being played at `now`, by the calendar: the first whose games aren't over yet (until the morning
 * after its Monday night, four and a half days on from its Thursday evening), the postseason rounds following on;
 * the Super Bowl after that. Where "A game from the schedule" starts, so it opens on games that can still be chosen.
 */
export function scheduleWeekAt(year: number, now: Date): number {
  const weekLasts = 4.5 * 24 * 60 * 60_000;
  for (let number = 1; number < LAST_WEEK; number++) {
    if (estimatedWeekStart(year, number).getTime() + weekLasts > now.getTime()) return number;
  }
  return LAST_WEEK;
}

/** A board's short name, for a link's label and the admin's confirmations: "BUF at SEA · Feb 14". */
export function boardTitle(board: Pick<BoardSummary, "homeTeam" | "awayTeam" | "kickoff">, timeZone: string) {
  const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(
    new Date(board.kickoff),
  );
  return `${board.awayTeam} at ${board.homeTeam} · ${day}`;
}

/** The Boards list's order: boards still to finish first, the soonest kickoff on top, then finished ones, latest first. */
export function boardsInOrder<B extends Pick<BoardSummary, "kickoff" | "phase">>(boards: B[]): B[] {
  const at = (board: B) => Date.parse(board.kickoff);
  return [
    ...boards.filter((b) => b.phase !== "final").sort((a, b) => at(a) - at(b)),
    ...boards.filter((b) => b.phase === "final").sort((a, b) => at(b) - at(a)),
  ];
}

/**
 * The score the board shows above its grid, and what it is: the feed's live score while the game is on, else
 * the latest quarter scored ("After Q1", "Halftime", "After Q3", "Final"). `label` names it for a screen reader
 * ("Live score", "Score after Q1"). Null until there is a score.
 */
export function boardScore(view: Pick<BoardView, "live" | "quarters">) {
  if (view.live) return { ...view.live, status: "Live", label: "Live score", live: true };
  const latest = quarterRows(view)
    .reverse()
    .find((row) => row.result)?.result;
  if (!latest) return null;
  return {
    homeScore: latest.homeScore,
    awayScore: latest.awayScore,
    ...scoreStatus(latest.period),
    live: false,
  };
}

/** How many squares a player can still claim, and whether the board still takes claims. */
export function claimRoom(view: Pick<BoardView, "phase" | "mine" | "maxPerPlayer" | "claimed">) {
  const open = view.phase === "open";
  return { open, left: open ? Math.max(0, Math.min(view.maxPerPlayer - view.mine, 100 - view.claimed)) : 0 };
}

/** The quarter results under the grid: one row per period, scored or still to come. */
export function quarterRows(view: Pick<BoardView, "quarters">) {
  return (["q1", "half", "q3", "final"] as const).map((period) => ({
    period,
    label: SQUARE_PERIOD_LABEL[period],
    result: view.quarters.find((q) => q.period === period) ?? null,
  }));
}

/** The admin's choice of a board's game, as typed: the Super Bowl, a game from the feed, or one typed by hand. */
export type GameDraft = {
  source: "superbowl" | "feed" | "manual";
  year: number;
  week: number;
  externalId: string;
  homeTeam: string;
  awayTeam: string;
  /** `YYYY-MM-DD HH:mm` in the league's time zone. */
  kickoff: string;
};

/** What to send for the drafted game, or a message when something is missing. */
export function gameFromDraft(draft: GameDraft, timeZone: string): { game?: BoardGame; error?: string } {
  if (draft.source === "superbowl") return { game: { source: "superbowl" } };
  if (draft.source === "feed") {
    return draft.externalId
      ? { game: { source: "feed", year: draft.year, week: draft.week, externalId: draft.externalId } }
      : { error: "Choose a game." };
  }
  if (!draft.homeTeam || !draft.awayTeam) return { error: "Choose both teams." };
  if (draft.homeTeam === draft.awayTeam) return { error: "A team can't play itself." };
  const kickoff = parseLeagueKickoff(draft.kickoff, timeZone);
  if (!kickoff) return { error: "Enter a valid kickoff as YYYY-MM-DD HH:mm." };
  return {
    game: {
      source: "manual",
      homeTeam: draft.homeTeam as never,
      awayTeam: draft.awayTeam as never,
      kickoff: kickoff.toISOString(),
    },
  };
}
