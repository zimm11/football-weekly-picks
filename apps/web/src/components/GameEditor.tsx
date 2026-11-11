import {
  type CreateGame,
  type Game,
  NFL_TEAMS,
  TEAM_ABBRS,
  type UpdateGame,
  type WeekStatus,
} from "@picks/shared";
import { type FormEvent, useState } from "react";
import { kickoffDay, kickoffTime, matchup } from "../format";

export type GameUpdate = { gameId: string; changes: UpdateGame };

type Props = {
  games: Game[];
  status: WeekStatus;
  tiebreakerGameId: string | null;
  timeZone: string;
  /** Saves every edited row at once. */
  onSave: (updates: GameUpdate[]) => void;
  onRemove: (gameId: string) => void;
  onAdd: (game: CreateGame) => void;
  onSetTiebreaker: (gameId: string) => void;
};

type Field = "spread" | "points" | "awayScore" | "homeScore";
/** What the admin typed, and the saved value it was typed over. */
type Edit = { value: string; base: string };
type Edits = Record<string, Partial<Record<Field, Edit>>>;

const toNumber = (value: string) => (value.trim() === "" ? null : Number(value));
const toText = (value: number | null) => (value === null ? "" : String(value));

/** The admin's view of a week: spreads, point values, the tiebreaker game and (once open) final scores. */
export function GameEditor({
  games,
  status,
  tiebreakerGameId,
  timeZone,
  onSave,
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
  const shown = (game: Game, field: Field) => {
    const saved = toText(game[field]);
    const edit = edits[game.id]?.[field];
    return edit && edit.base === saved ? edit.value : saved;
  };
  const setValue = (game: Game, field: Field, value: string) =>
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

  const input = (game: Game, field: Field, label: string, props: { min?: number; step?: number } = {}) => (
    <input
      type="number"
      inputMode="decimal"
      aria-label={label}
      value={shown(game, field)}
      onChange={(e) => setValue(game, field, e.target.value)}
      {...props}
    />
  );

  return (
    <>
      <p className="muted">
        The spread is the home team's line: −3.5 means the home team is favored by 3.5.
        {showScores && " Enter both scores to mark a game final; a final game is closed to picks."}
      </p>
      <div className="table-scroll">
        <table aria-label="Games">
          <thead>
            <tr>
              <th>Kickoff</th>
              <th>Game</th>
              <th>Home spread</th>
              <th>Points</th>
              {showScores && <th>Away score</th>}
              {showScores && <th>Home score</th>}
              <th>Tiebreaker</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {games.map((game) => {
              const name = matchup(game);
              return (
                <tr key={game.id}>
                  <td>
                    {kickoffDay(game.kickoff, timeZone)}
                    <br />
                    <span className="muted">{kickoffTime(game.kickoff, timeZone)}</span>
                  </td>
                  <td>{name}</td>
                  <td>{input(game, "spread", `Home spread for ${name}`, { step: 0.5 })}</td>
                  <td>{input(game, "points", `Points for ${name}`, { min: 1 })}</td>
                  {showScores && (
                    <td>{input(game, "awayScore", `${game.awayTeam} score in ${name}`, { min: 0 })}</td>
                  )}
                  {showScores && (
                    <td>{input(game, "homeScore", `${game.homeTeam} score in ${name}`, { min: 0 })}</td>
                  )}
                  <td>
                    <input
                      type="radio"
                      name="tiebreaker"
                      aria-label={`Use ${name} as the tiebreaker game`}
                      checked={game.id === tiebreakerGameId}
                      onChange={() => onSetTiebreaker(game.id)}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="link"
                      aria-label={`Remove ${name}`}
                      onClick={() => onRemove(game.id)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {games.length === 0 && <p className="muted">No games yet. Import the schedule or add games below.</p>}
      {games.length > 0 && (
        <div className="row" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="primary"
            disabled={updates.length === 0 || !!problem}
            onClick={() => onSave(updates)}
          >
            Save changes
          </button>
          {problem ? (
            <p role="alert">{problem}</p>
          ) : (
            updates.length > 0 && (
              <span className="badge pow">
                {updates.length} {updates.length === 1 ? "game" : "games"} changed
              </span>
            )
          )}
        </div>
      )}
      <AddGameForm onAdd={onAdd} />
    </>
  );
}

function AddGameForm({ onAdd }: Pick<Props, "onAdd">) {
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
    <form onSubmit={submit} className="stack" aria-label="Add a game" style={{ marginTop: 16 }}>
      <h3 style={{ margin: 0 }}>Add a game</h3>
      <div className="row" style={{ alignItems: "end" }}>
        <label>
          Away team
          <select name="awayTeam" required defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {teamOptions}
          </select>
        </label>
        <label>
          Home team
          <select name="homeTeam" required defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {teamOptions}
          </select>
        </label>
        <label>
          Kickoff (your local time)
          <input name="kickoff" type="datetime-local" required />
        </label>
        <label>
          Home spread
          <input name="spread" type="number" step={0.5} required />
        </label>
        <button type="submit">Add game</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
