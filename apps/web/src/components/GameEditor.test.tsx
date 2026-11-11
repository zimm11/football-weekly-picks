import type { Game } from "@picks/shared";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { GameEditor } from "./GameEditor";

const game: Game = {
  id: "g1",
  awayTeam: "KC",
  homeTeam: "ATL",
  kickoff: "2026-11-15T18:00:00Z",
  spread: 3.5,
  points: 1,
  homeScore: null,
  awayScore: null,
};

function editor(games: Game[], onSave = vi.fn()) {
  return (
    <GameEditor
      games={games}
      status="open"
      tiebreakerGameId="g1"
      timeZone="America/New_York"
      onSave={onSave}
      onRemove={vi.fn()}
      onAdd={vi.fn()}
      onSetTiebreaker={vi.fn()}
    />
  );
}

describe("GameEditor", () => {
  it("saves every edited field in one go", async () => {
    const onSave = vi.fn();
    const screen = await render(editor([game], onSave));
    await expect.element(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();

    await screen.getByLabelText("Home spread for KC at ATL").fill("4.5");
    await screen.getByLabelText("KC score in KC at ATL").fill("30");
    await screen.getByLabelText("ATL score in KC at ATL").fill("10");
    await screen.getByRole("button", { name: "Save changes" }).click();
    expect(onSave).toHaveBeenCalledWith([
      { gameId: "g1", changes: { spread: 4.5, awayScore: 30, homeScore: 10 } },
    ]);
  });

  it("asks for both scores", async () => {
    const screen = await render(editor([game]));
    await screen.getByLabelText("KC score in KC at ATL").fill("30");
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Enter both scores for KC at ATL, or neither.");
    await expect.element(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("drops a typed value once fresher data arrives, so it can't overwrite it", async () => {
    const onSave = vi.fn();
    const screen = await render(editor([game], onSave));
    // The admin types a score and saves it...
    await screen.getByLabelText("KC score in KC at ATL").fill("30");
    await screen.getByLabelText("ATL score in KC at ATL").fill("10");
    await screen.rerender(editor([{ ...game, awayScore: 30, homeScore: 10 }], onSave));
    // ...then a corrected score is pulled from the provider.
    await screen.rerender(editor([{ ...game, awayScore: 31, homeScore: 10 }], onSave));
    await expect.element(screen.getByLabelText("KC score in KC at ATL")).toHaveValue(31);

    // Saving another field sends only that field, not the stale 30.
    await screen.getByLabelText("Points for KC at ATL").fill("2");
    await screen.getByRole("button", { name: "Save changes" }).click();
    expect(onSave).toHaveBeenCalledWith([{ gameId: "g1", changes: { points: 2 } }]);
  });
});
