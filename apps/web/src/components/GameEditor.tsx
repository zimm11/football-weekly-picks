// biome-ignore-all lint/a11y/noRedundantRoles: on a phone these rows are laid out as cards, and a browser drops a table's built-in roles once its display changes. The explicit roles keep it a table for screen readers.
import {
  type CreateGame,
  type Game,
  NFL_TEAMS,
  TEAM_ABBRS,
  type UpdateGame,
  type WeekStatus,
} from "@picks/shared";
import { cn } from "cn";
import { type FormEvent, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, Eyebrow, Notice } from "@/components/ui/card";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { kickoffDay, kickoffTime, matchup } from "../format";
import { useUnsavedGuard } from "./ConfirmDialog";
import { TAB_BAR_OFFSET } from "./LeagueNav";

export type GameUpdate = { gameId: string; changes: UpdateGame };

type Props = {
  games: Game[];
  status: WeekStatus;
  tiebreakerGameId: string | null;
  timeZone: string;
  /** Saves every edited row at once. */
  onSave: (updates: GameUpdate[]) => void;
  /** True while a change is being sent, so nothing is submitted twice. */
  busy?: boolean;
  onRemove: (gameId: string) => void;
  onAdd: (game: CreateGame) => void;
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
  onSave,
  busy = false,
  onRemove,
  onAdd,
  onSetTiebreaker,
}: Props) {
  const showScores = status === "open";
  // What the admin has typed but not saved. A field with no entry shows the saved value.
  const [edits, setEdits] = useState<Edits>({});

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
        The spread is the home team's line: −3.5 means the home team is favored by 3.5.
        {showScores && " Enter both scores to mark a game final; a final game is closed to picks."}
      </p>
      <div className="table-scroll">
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
                    {name}
                  </td>
                  <td role="cell" data-label="Home spread" className="max-md:order-3">
                    {input(game, "spread", `Home spread for ${name}`, { step: 0.5 })}
                  </td>
                  <td role="cell" data-label="Points" className="max-md:order-3">
                    {input(game, "points", `Points for ${name}`, { min: 1 })}
                  </td>
                  {showScores && (
                    <td role="cell" data-label={`${game.awayTeam} score`} className="max-md:order-3">
                      {input(game, "awayScore", `${game.awayTeam} score in ${name}`, { min: 0 })}
                    </td>
                  )}
                  {showScores && (
                    <td role="cell" data-label={`${game.homeTeam} score`} className="max-md:order-3">
                      {input(game, "homeScore", `${game.homeTeam} score in ${name}`, { min: 0 })}
                    </td>
                  )}
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
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      aria-label={`Remove ${name}`}
                      onClick={() => onRemove(game.id)}
                    >
                      Remove
                    </Button>
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
            "sticky z-30 -mx-4 flex flex-wrap items-center gap-3 border-t bg-chrome px-4 py-3",
            TAB_BAR_OFFSET,
          )}
        >
          <Button
            type="button"
            disabled={busy || updates.length === 0 || !!problem}
            onClick={() => onSave(updates)}
          >
            {busy && updates.length > 0 ? "Saving…" : "Save changes"}
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
      <AddGameForm onAdd={onAdd} busy={busy} />
    </div>
  );
}

function AddGameForm({ onAdd, busy }: Pick<Props, "onAdd" | "busy">) {
  const [error, setError] = useState<string>();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const kickoff = new Date(String(form.get("kickoff")));
    const awayTeam = String(form.get("awayTeam")) as CreateGame["awayTeam"];
    const homeTeam = String(form.get("homeTeam")) as CreateGame["homeTeam"];
    if (awayTeam === homeTeam) return setError("Choose two different teams.");
    if (Number.isNaN(kickoff.getTime())) return setError("Enter the kickoff date and time.");
    setError(undefined);
    onAdd({ awayTeam, homeTeam, kickoff: kickoff.toISOString(), spread: Number(form.get("spread")) });
    e.currentTarget.reset();
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
          <Field label="Kickoff (your local time)" className="max-md:col-span-2">
            <Input name="kickoff" type="datetime-local" required />
          </Field>
          <Field label="Home spread">
            <Input name="spread" type="number" step={0.5} required />
          </Field>
          <Button type="submit" variant="secondary" className="self-end" disabled={busy}>
            Add game
          </Button>
        </div>
        {error && <Notice kind="alert">{error}</Notice>}
      </form>
    </Card>
  );
}
