import type { Game, Pick } from "@picks/shared";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { PickSheet } from "./PickSheet";

// Week 10 of 2026, Eastern time (UTC-5).
const game = (
  id: string,
  awayTeam: string,
  homeTeam: string,
  kickoff: string,
  spread: number,
  points: number,
) => ({ id, awayTeam, homeTeam, kickoff, spread, points, homeScore: null, awayScore: null }) satisfies Game;
const games: Game[] = [
  game("thu", "WSH", "NYG", "2026-11-13T01:15:00Z", -2.5, 3),
  game("sun", "KC", "ATL", "2026-11-15T18:00:00Z", 3.5, 1),
  game("mon", "LAC", "BAL", "2026-11-17T01:15:00Z", -4.5, 3),
];
const WEDNESDAY = new Date("2026-11-11T17:00:00Z");
const SUNDAY_7AM = new Date("2026-11-15T12:00:00Z");

async function renderSheet(props: { now?: Date; picks?: Pick[]; tiebreakerTotal?: number | null } = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const screen = await render(
    <PickSheet
      games={games}
      picks={props.picks ?? []}
      tiebreakerGameId="mon"
      tiebreakerTotal={props.tiebreakerTotal ?? null}
      timeZone="America/New_York"
      now={props.now ?? WEDNESDAY}
      onSave={onSave}
    />,
  );
  return { screen, onSave };
}

describe("PickSheet", () => {
  it("shows each side with its line, grouped by day", async () => {
    const { screen } = await renderSheet();
    await expect.element(screen.getByRole("heading", { name: "Thursday, Nov 12" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Giants -2.5" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Commanders +2.5" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Chiefs -3.5" })).toBeVisible();
  });

  it("submits picks, the POW and the tiebreaker guess", async () => {
    const { screen, onSave } = await renderSheet();
    await screen.getByRole("button", { name: "Giants -2.5" }).click();
    await screen.getByRole("button", { name: "Chiefs -3.5" }).click();
    await screen.getByRole("button", { name: "POW: WSH at NYG" }).click();
    await screen.getByLabelText(/Tiebreaker/).fill("44");
    await expect.element(screen.getByText("2 of 3 picked")).toBeVisible();
    await screen.getByRole("button", { name: "Save picks" }).click();

    expect(onSave).toHaveBeenCalledWith({
      picks: [
        { gameId: "thu", side: "home" },
        { gameId: "sun", side: "away" },
      ],
      powGameId: "thu",
      tiebreakerTotal: 44,
    });
    await expect.element(screen.getByRole("status")).toHaveTextContent("Picks saved.");
  });

  it("counts down the games left to pick, going by what is saved", async () => {
    const { screen } = await renderSheet({ picks: [{ gameId: "thu", side: "home", isPow: false }] });
    const status = screen.getByRole("region", { name: "Pick status" });
    await expect.element(status.getByText("games left to pick")).toBeVisible();
    await expect.element(status.getByText(/1 of 3 saved/)).toBeVisible();
    await expect.element(status.getByText(/Choose your POW\. Add your tiebreaker guess\./)).toBeVisible();
  });

  it("still counts the POW as left to do when every game is picked", async () => {
    const { screen } = await renderSheet({
      picks: ["thu", "sun", "mon"].map((gameId) => ({ gameId, side: "home" as const, isPow: false })),
      tiebreakerTotal: 44,
    });
    const status = screen.getByRole("region", { name: "Pick status" });
    await expect.element(status.getByText("thing left to do")).toBeVisible();
    await expect.element(status.getByText(/3 of 3 saved\. Choose your POW\./)).toBeVisible();
  });

  it("stops asking for a POW once it can no longer be chosen", async () => {
    // After 6am on Sunday the Monday night pick is the POW, so there is nothing left to choose.
    const { screen } = await renderSheet({
      now: SUNDAY_7AM,
      picks: ["thu", "sun", "mon"].map((gameId) => ({ gameId, side: "home" as const, isPow: false })),
      tiebreakerTotal: 44,
    });
    const status = screen.getByRole("region", { name: "Pick status" });
    await expect.element(status.getByText("You're set for the week")).toBeVisible();
    await expect.element(status.getByText(/POW: defaults to LAC at BAL\./)).toBeVisible();
  });

  it("says the player is set once every pick and the tiebreaker guess are saved", async () => {
    const { screen } = await renderSheet({
      picks: [
        { gameId: "thu", side: "home", isPow: true },
        { gameId: "sun", side: "away", isPow: false },
        { gameId: "mon", side: "home", isPow: false },
      ],
      tiebreakerTotal: 44,
    });
    const status = screen.getByRole("region", { name: "Pick status" });
    await expect.element(status.getByText("You're set for the week")).toBeVisible();
    await expect.element(status.getByText(/All 3 games picked and saved\. POW: WSH at NYG\./)).toBeVisible();

    // Changing a pick takes the all-clear away until it is saved again.
    await screen.getByRole("button", { name: "Commanders +2.5" }).click();
    await expect.element(status.getByText("Not saved yet")).toBeVisible();
  });

  it("only allows a POW on a game that has a pick", async () => {
    const { screen } = await renderSheet();
    await expect.element(screen.getByRole("button", { name: "POW: KC at ATL" })).toBeDisabled();
    await screen.getByRole("button", { name: "Falcons +3.5" }).click();
    await expect.element(screen.getByRole("button", { name: "POW: KC at ATL" })).toBeEnabled();
  });

  it("says the Monday night pick becomes the POW when none is chosen", async () => {
    const { screen } = await renderSheet();
    await expect.element(screen.getByText(/your pick in LAC at BAL becomes your POW/)).toBeVisible();
  });

  it("on game day, takes a late pick but not as the POW, and locks games that kicked off", async () => {
    const { screen } = await renderSheet({ now: SUNDAY_7AM });
    // Thursday has been played.
    await expect.element(screen.getByRole("button", { name: "Giants -2.5" })).toBeDisabled();
    // Sunday can still be picked, but not as the POW.
    await screen.getByRole("button", { name: "Chiefs -3.5" }).click();
    await expect.element(screen.getByRole("button", { name: "POW: KC at ATL" })).toBeDisabled();
    await expect.element(screen.getByText("Late pick: final once saved, can't be POW")).toBeVisible();
    // Monday is still fully open.
    await screen.getByRole("button", { name: "Ravens -4.5" }).click();
    await expect.element(screen.getByRole("button", { name: "POW: LAC at BAL" })).toBeEnabled();
  });

  it("after 6am on Sunday, makes the Monday night game the only possible POW", async () => {
    // A Tuesday game is still days away, but a player with no POW can no longer choose it.
    const withTuesday = [...games, game("tue", "MIA", "BUF", "2026-11-18T01:15:00Z", -6.5, 2)];
    const screen = await render(
      <PickSheet
        games={withTuesday}
        picks={[]}
        tiebreakerGameId="mon"
        tiebreakerTotal={null}
        timeZone="America/New_York"
        now={SUNDAY_7AM}
        onSave={vi.fn()}
      />,
    );
    await screen.getByRole("button", { name: "Bills -6.5" }).click();
    await expect.element(screen.getByRole("button", { name: "POW: MIA at BUF" })).toBeDisabled();
    await expect
      .element(
        screen.getByText("It is after 6am on Sunday, so your POW is automatically your pick in LAC at BAL."),
      )
      .toBeVisible();
    // Picking the Monday night game shows it as the POW.
    await screen.getByRole("button", { name: "Ravens -4.5" }).click();
    await expect
      .element(screen.getByRole("button", { name: "POW: LAC at BAL" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("freezes saved picks and a saved POW after 6am on game day", async () => {
    const { screen } = await renderSheet({
      now: SUNDAY_7AM,
      picks: [
        { gameId: "sun", side: "home", isPow: true },
        { gameId: "mon", side: "home", isPow: false },
      ],
    });
    await expect.element(screen.getByRole("button", { name: "Chiefs -3.5" })).toBeDisabled();
    await expect
      .element(screen.getByRole("button", { name: "Falcons +3.5" }))
      .toHaveAttribute("aria-pressed", "true");
    // The POW sits on a locked game, so it can't move to Monday either.
    await expect.element(screen.getByRole("button", { name: "POW: LAC at BAL" })).toBeDisabled();
    // Monday's pick itself can still change.
    await expect.element(screen.getByRole("button", { name: "Chargers +4.5" })).toBeEnabled();
  });

  it("closes a game that already has a result, even before kickoff", async () => {
    const withResult = games.map((g) => (g.id === "mon" ? { ...g, homeScore: 27, awayScore: 20 } : g));
    const screen = await render(
      <PickSheet
        games={withResult}
        picks={[{ gameId: "mon", side: "home", isPow: false }]}
        tiebreakerGameId="mon"
        tiebreakerTotal={null}
        timeZone="America/New_York"
        now={WEDNESDAY}
        onSave={vi.fn()}
      />,
    );
    await expect.element(screen.getByRole("button", { name: "Chargers +4.5" })).toBeDisabled();
    await expect.element(screen.getByRole("button", { name: "POW: LAC at BAL" })).toBeDisabled();
    await expect.element(screen.getByLabelText(/Tiebreaker/)).toBeDisabled();
    await expect.element(screen.getByText("Final 20–27")).toBeVisible();
    await expect.element(screen.getByText("Won", { exact: true })).toBeVisible();
    // Thursday is untouched.
    await expect.element(screen.getByRole("button", { name: "Giants -2.5" })).toBeEnabled();
  });

  it("flags unsaved changes", async () => {
    const { screen } = await renderSheet();
    await expect.element(screen.getByText("Unsaved changes")).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Giants -2.5" }).click();
    await expect.element(screen.getByText("Unsaved changes")).toBeVisible();
  });

  it("shows the error when saving fails", async () => {
    const { screen, onSave } = await renderSheet();
    onSave.mockResolvedValue("KC at ATL has already kicked off.");
    await screen.getByRole("button", { name: "Save picks" }).click();
    await expect.element(screen.getByRole("alert")).toHaveTextContent("KC at ATL has already kicked off.");
  });
});
