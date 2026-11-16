// biome-ignore-all lint/a11y/noRedundantRoles: on a phone these rows are laid out as cards, and a browser drops a table's built-in roles once its display changes. The explicit roles keep it a table for screen readers.

import { DotsThreeIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import {
  type CreateGame,
  type Game,
  NFL_TEAMS,
  TEAM_ABBRS,
  type UpdateGame,
  type WeekStatus,
  zonedTimeToUtc,
} from "@picks/shared";
import { cn } from "cn";
import { type FormEvent, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, Eyebrow, Notice } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { kickoffDay, kickoffTime, matchup, zoneName } from "../format";
import { useUnsavedGuard } from "./ConfirmDialog";
import { TAB_BAR_OFFSET } from "./LeagueNav";
import { TeamLogo } from "./TeamLogo";

export type GameUpdate = { gameId: string; changes: UpdateGame };

type Props = {
  games: Game[];
  status: WeekStatus;
  tiebreakerGameId: string | null;
  timeZone: string;
  /** Passed in (not read from the clock) so which games offer score boxes is testable. */
  now: Date;
  /** Saves every edited row at once. */
  onSave: (updates: GameUpdate[]) => void;
  /** True while a change is being sent, so nothing is submitted twice. */
  busy?: boolean;
  /** Which of this editor's own actions is being sent, so its button can say so. */
  pending?: "save" | "add";
  onRemove: (gameId: string) => void;
  /** Resolves to whether the game was added; the form clears only then. */
  onAdd: (game: CreateGame) => Promise<boolean>;
  onSetTiebreaker: (gameId: string) => void;
};

type GameField = "spread" | "points" | "awayScore" | "homeScore";
/** What the admin typed, and the saved value it was typed over. */
type Edit = { value: string; base: string };
type Edits = Record<string, Partial<Record<GameField, Edit>>>;

const toNumber = (value: string) => (value.trim() === "" ? null : Number(value));
const toText = (value: number | null) => (value === null ? "" : String(value));

/** The admin's view of a week: spreads, point values, the tiebreaker game and (once open) final scores. */
export function GameEditor({
  games,
  status,
  tiebreakerGameId,
  timeZone,
  now,
  onSave,
  busy = false,
  pending,
  onRemove,
  onAdd,
  onSetTiebreaker,
}: Props) {
  const showScores = status === "open";
  // What the admin has typed but not saved. A field with no entry shows the saved value.
  const [edits, setEdits] = useState<Edits>({});
  // Games whose score boxes the admin opened before kickoff.
  const [scoring, setScoring] = useState<ReadonlySet<string>>(new Set());
  // Score boxes show once a game has kicked off or has a score. Before that they wait behind "Enter score",
  // since a result closes the game to picks whatever the clock says.
  const scoresOpen = (game: Game) =>
    showScores &&
    (new Date(game.kickoff) <= now ||
      game.homeScore !== null ||
      scoring.has(game.id) ||
      !!edits[game.id]?.awayScore ||
      !!edits[game.id]?.homeScore);

  // An edit only counts while the saved value under it is unchanged. Once that value moves (the edit was
  // saved, or fresher data arrived, e.g. corrected scores pulled from ESPN) the edit is dropped, so a stale
  // value can never be shown or sent again over newer data.
  const shown = (game: Game, field: GameField) => {
    const saved = toText(game[field]);
    const edit = edits[game.id]?.[field];
    return edit && edit.base === saved ? edit.value : saved;
  };
  const setValue = (game: Game, field: GameField, value: string) =>
    setEdits((prev) => ({
      ...prev,
      [game.id]: { ...prev[game.id], [field]: { value, base: toText(game[field]) } },
    }));

  const updates: GameUpdate[] = [];
  let problem: string | undefined;
  for (const game of games) {
    const changes: UpdateGame = {};
    const spread = toNumber(shown(game, "spread"));
    const points = toNumber(shown(game, "points"));
    if (spread !== null && spread !== game.spread) changes.spread = spread;
    if (points !== null && points !== game.points) changes.points = points;
    if (showScores) {
      const awayScore = toNumber(shown(game, "awayScore"));
      const homeScore = toNumber(shown(game, "homeScore"));
      if ((awayScore === null) !== (homeScore === null)) {
        problem ??= `Enter both scores for ${matchup(game)}, or neither.`;
      } else if (awayScore !== game.awayScore || homeScore !== game.homeScore) {
        changes.awayScore = awayScore;
        changes.homeScore = homeScore;
      }
    }
    if (Object.keys(changes).length > 0) updates.push({ gameId: game.id, changes });
  }

  const unsavedDialog = useUnsavedGuard(updates.length > 0, "changes to this week's games");

  const input = (
    game: Game,
    field: GameField,
    label: string,
    props: { min?: number; step?: number } = {},
  ) => (
    <Input
      type="number"
      inputMode="decimal"
      aria-label={label}
      value={shown(game, field)}
      onChange={(e) => setValue(game, field, e.target.value)}
      className="h-10 tabular-nums md:w-20"
      {...props}
    />
  );

  return (
    <div className="grid gap-4">
      {unsavedDialog}
      <p className="m-0 text-sm text-muted-foreground">
        Spreads are the home team's line: −3.5 means the home team is favored by 3.5.
        {showScores && " A game with both scores entered is final and closed to picks."}
      </p>
      <div className="table-scroll md:rounded-xl md:bg-card">
        <table role="table" aria-label="Games" className="data-table card-rows">
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col">Kickoff</th>
              <th scope="col">Game</th>
              <th scope="col">Home spread</th>
              <th scope="col">Points</th>
              {showScores && <th scope="col">Away score</th>}
              {showScores && <th scope="col">Home score</th>}
              <th scope="col">Tiebreaker</th>
              <th scope="col">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {games.map((game) => {
              const name = matchup(game);
              return (
                <tr role="row" key={game.id} className="max-md:grid-cols-2">
                  <td role="cell" className="max-md:order-2 max-md:col-span-2 max-md:-mt-2 max-md:text-sm">
                    {kickoffDay(game.kickoff, timeZone)}
                    <br className="max-md:hidden" />
                    <span className="text-muted-foreground"> {kickoffTime(game.kickoff, timeZone)}</span>
                  </td>
                  <td
                    role="cell"
                    className="font-display text-xl font-bold tracking-wide max-md:order-1 max-md:col-span-2 max-md:text-2xl"
                  >
                    <span className="flex items-center gap-2">
                      <TeamLogo abbr={game.awayTeam} size={24} />
                      {name}
                      <TeamLogo abbr={game.homeTeam} size={24} />
                    </span>
                  </td>
                  <td role="cell" data-label="Home spread" className="max-md:order-3">
                    {input(game, "spread", `Home spread for ${name}`, { step: 0.5 })}
                  </td>
                  <td role="cell" data-label="Points" className="max-md:order-3">
                    {input(game, "points", `Points for ${name}`, { min: 1 })}
                  </td>
                  {showScores &&
                    (scoresOpen(game) ? (
                      <>
                        <td role="cell" data-label={`${game.awayTeam} score`} className="max-md:order-3">
                          {input(game, "awayScore", `${game.awayTeam} score in ${name}`, { min: 0 })}
                        </td>
                        <td role="cell" data-label={`${game.homeTeam} score`} className="max-md:order-3">
                          {input(game, "homeScore", `${game.homeTeam} score in ${name}`, { min: 0 })}
                        </td>
                      </>
                    ) : (
                      <>
                        <td role="cell" className="max-md:order-3 max-md:col-span-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Enter score for ${name}`}
                            className="text-muted-foreground max-md:w-full max-md:bg-raised/60"
                            onClick={() => setScoring((prev) => new Set(prev).add(game.id))}
                          >
                            <PlusIcon aria-hidden className="size-4" />
                            Enter score
                          </Button>
                        </td>
                        <td role="cell" className="max-md:hidden" />
                      </>
                    ))}
                  <td role="cell" className="max-md:order-4">
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="tiebreaker"
                        aria-label={`Use ${name} as the tiebreaker game`}
                        checked={game.id === tiebreakerGameId}
                        onChange={() => onSetTiebreaker(game.id)}
                        className="size-5 accent-primary"
                      />
                      <span className="md:sr-only">Tiebreaker game</span>
                    </label>
                  </td>
                  <td role="cell" className="max-md:order-4 max-md:justify-self-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Options for ${name}`}
                          className="rounded-full text-muted-foreground hover:text-foreground"
                        >
                          <DotsThreeIcon aria-hidden weight="bold" className="size-6" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          variant="destructive"
                          aria-label={`Remove ${name}`}
                          onSelect={() => onRemove(game.id)}
                        >
                          <TrashIcon aria-hidden />
                          Remove game
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {games.length === 0 && (
        <p className="m-0 text-muted-foreground">No games yet. Import the schedule or add games below.</p>
      )}
      {games.length > 0 && (
        <div
          className={cn(
            "sticky z-30 -mx-4 flex flex-wrap items-center gap-3 border-t bg-chrome/90 px-4 py-3 backdrop-blur-md",
            TAB_BAR_OFFSET,
          )}
        >
          <Button
            type="button"
            disabled={busy || updates.length === 0 || !!problem}
            onClick={() => onSave(updates)}
          >
            {pending === "save" ? "Saving…" : "Save changes"}
          </Button>
          {problem ? (
            <Notice kind="alert">{problem}</Notice>
          ) : (
            updates.length > 0 && (
              <Badge variant="warn">
                {updates.length} {updates.length === 1 ? "game" : "games"} changed
              </Badge>
            )
          )}
        </div>
      )}
      <AddGameForm onAdd={onAdd} busy={busy} adding={pending === "add"} timeZone={timeZone} />
    </div>
  );
}

/** The instant a `datetime-local` value ("2026-11-15T13:00") names on the wall clock of `timeZone`. */
export function kickoffFromInput(value: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const hourStart = zonedTimeToUtc(year, month, day, hour, timeZone);
  return Number.isNaN(hourStart.getTime()) ? null : new Date(hourStart.getTime() + minute * 60_000);
}

function AddGameForm({
  onAdd,
  busy,
  adding,
  timeZone,
}: Pick<Props, "onAdd" | "busy" | "timeZone"> & { adding: boolean }) {
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    // Typed in the league's time zone, the one the slate shows.
    const kickoff = kickoffFromInput(String(form.get("kickoff")), timeZone);
    const awayTeam = String(form.get("awayTeam")) as CreateGame["awayTeam"];
    const homeTeam = String(form.get("homeTeam")) as CreateGame["homeTeam"];
    if (awayTeam === homeTeam) return setError("Choose two different teams.");
    if (!kickoff) return setError("Enter the kickoff date and time.");
    setError(undefined);
    const added = await onAdd({
      awayTeam,
      homeTeam,
      kickoff: kickoff.toISOString(),
      spread: Number(form.get("spread")),
    });
    // A failed add keeps what was typed, so it can be fixed and sent again.
    if (added) formElement.reset();
  }

  const teamOptions = TEAM_ABBRS.map((abbr) => (
    <option key={abbr} value={abbr}>
      {abbr} · {NFL_TEAMS[abbr]}
    </option>
  ));

  return (
    <Card>
      <form onSubmit={submit} className="grid gap-3" aria-label="Add a game">
        <Eyebrow>Add a game</Eyebrow>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-[1fr_1fr_auto_6rem_auto] md:items-end">
          <Field label="Away team">
            <NativeSelect name="awayTeam" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {teamOptions}
            </NativeSelect>
          </Field>
          <Field label="Home team">
            <NativeSelect name="homeTeam" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {teamOptions}
            </NativeSelect>
          </Field>
          <Field label={`Kickoff (${zoneName(timeZone)} time)`} className="max-md:col-span-2">
            <Input name="kickoff" type="datetime-local" required />
          </Field>
          <Field label="Home spread">
            <Input name="spread" type="number" step={0.5} required />
          </Field>
          <Button type="submit" variant="secondary" className="self-end" disabled={busy}>
            {adding ? "Adding…" : "Add game"}
          </Button>
        </div>
        {error && <Notice kind="alert">{error}</Notice>}
      </form>
    </Card>
  );
}
