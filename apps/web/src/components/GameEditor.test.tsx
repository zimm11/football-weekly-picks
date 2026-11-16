import type { Game } from "@picks/shared";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { GameEditor, kickoffFromInput } from "./GameEditor";

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

// After the test game's kickoff, so its score boxes show.
const afterKickoff = new Date("2026-11-15T21:00:00Z");

function editor(games: Game[], onSave = vi.fn(), now = afterKickoff) {
  return (
    <GameEditor
      games={games}
      status="open"
      tiebreakerGameId="g1"
      timeZone="America/New_York"
      now={now}
      onSave={onSave}
      onRemove={vi.fn()}
      onAdd={vi.fn()}
      onSetTiebreaker={vi.fn()}
    />
  );
}

describe("kickoffFromInput", () => {
  it("reads the typed time on the league's clock, whatever the device's zone", () => {
    expect(kickoffFromInput("2026-11-15T13:00", "America/New_York")?.toISOString()).toBe(
      "2026-11-15T18:00:00.000Z",
    );
    expect(kickoffFromInput("2026-11-15T10:25", "America/Los_Angeles")?.toISOString()).toBe(
      "2026-11-15T18:25:00.000Z",
    );
    // Daylight time, before the November change.
    expect(kickoffFromInput("2026-09-13T13:00", "America/New_York")?.toISOString()).toBe(
      "2026-09-13T17:00:00.000Z",
    );
    expect(kickoffFromInput("", "America/New_York")).toBeNull();
  });
});

describe("Add a game", () => {
  async function addGame(onAdd: (game: unknown) => Promise<boolean>) {
    const screen = await render(
      <GameEditor
        games={[game]}
        status="draft"
        tiebreakerGameId="g1"
        timeZone="America/Chicago"
        now={afterKickoff}
        onSave={vi.fn()}
        onRemove={vi.fn()}
        onAdd={onAdd}
        onSetTiebreaker={vi.fn()}
      />,
    );
    const form = screen.getByRole("form", { name: "Add a game" });
    await form.getByRole("combobox", { name: /^Away team/ }).selectOptions("BUF");
    await form.getByRole("combobox", { name: /^Home team/ }).selectOptions("MIA");
    await form.getByLabelText("Kickoff (Central time)").fill("2026-11-15T12:00");
    await form.getByLabelText("Home spread").fill("-3");
    await form.getByRole("button", { name: "Add game" }).click();
    return form;
  }

  it("sends the kickoff in the league's time zone and clears the form once the game is added", async () => {
    const onAdd = vi.fn(async () => true);
    const form = await addGame(onAdd);
    expect(onAdd).toHaveBeenCalledWith({
      awayTeam: "BUF",
      homeTeam: "MIA",
      kickoff: "2026-11-15T18:00:00.000Z",
      spread: -3,
    });
    await expect.element(form.getByLabelText("Home spread")).toHaveValue(null);
  });

  it("keeps what was typed when adding fails", async () => {
    const form = await addGame(vi.fn(async () => false));
    await expect.element(form.getByLabelText("Home spread")).toHaveValue(-3);
  });
});

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

  it("keeps score boxes behind Enter score until kickoff", async () => {
    const screen = await render(editor([game], vi.fn(), new Date("2026-11-14T12:00:00Z")));
    await expect.element(screen.getByLabelText("KC score in KC at ATL")).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Enter score for KC at ATL" }).click();
    await expect.element(screen.getByLabelText("KC score in KC at ATL")).toBeVisible();
    await expect.element(screen.getByLabelText("ATL score in KC at ATL")).toBeVisible();
  });
});
