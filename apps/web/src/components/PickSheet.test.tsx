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
const SUNDAY_2PM = new Date("2026-11-15T19:00:00Z");
const MONDAY_NIGHT = new Date("2026-11-17T02:00:00Z");

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

/** The sheet rendered at `start`, so a test can move the clock on with `at(...)`. */
async function renderAt(start: Date, picks: Pick[] = [], tiebreakerTotal: number | null = null) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const sheet = (now: Date, clock?: () => Date) => (
    <PickSheet
      games={games}
      picks={picks}
      tiebreakerGameId="mon"
      tiebreakerTotal={tiebreakerTotal}
      timeZone="America/New_York"
      now={now}
      clock={clock}
      onSave={onSave}
    />
  );
  const screen = await render(sheet(start));
  return { screen, onSave, at: (now: Date, clock?: () => Date) => screen.rerender(sheet(now, clock)) };
}

describe("PickSheet locks on unsaved changes", () => {
  const SUNDAY_NOON = new Date("2026-11-15T17:00:00Z");

  it("undoes an unsaved pick when its game kicks off, and saves the rest", async () => {
    const { screen, onSave, at } = await renderAt(SUNDAY_NOON, [
      { gameId: "sun", side: "home", isPow: false },
    ]);
    await screen.getByRole("button", { name: "Chiefs -3.5" }).click();
    await screen.getByRole("button", { name: "Ravens -4.5" }).click();

    await at(SUNDAY_2PM);
    await expect
      .element(screen.getByRole("button", { name: "Falcons +3.5" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Your change to KC at ATL didn't save: it locked first.");

    await screen.getByRole("button", { name: "Save picks" }).click();
    expect(onSave).toHaveBeenCalledWith({
      picks: [
        { gameId: "sun", side: "home" },
        { gameId: "mon", side: "home" },
      ],
      powGameId: null,
      tiebreakerTotal: null,
    });
  });

  it("drops an unsaved pick and a POW whose game locked between the last tick and the save", async () => {
    const { screen, onSave, at } = await renderAt(SUNDAY_NOON);
    await screen.getByRole("button", { name: "Chiefs -3.5" }).click();
    await screen.getByRole("button", { name: "POW: KC at ATL" }).click();
    await screen.getByRole("button", { name: "Ravens -4.5" }).click();
    // The screen's clock hasn't ticked past kickoff yet, but the save happens after it.
    await at(SUNDAY_NOON, () => SUNDAY_2PM);

    await screen.getByRole("button", { name: "Save picks" }).click();
    expect(onSave).toHaveBeenCalledWith({
      picks: [{ gameId: "mon", side: "home" }],
      powGameId: null,
      tiebreakerTotal: null,
    });
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent(
        "Picks saved. Your changes to KC at ATL and your POW didn't save: they locked first.",
      );
  });

  it("puts a POW moved off a game back once that game kicks off", async () => {
    const { screen, onSave, at } = await renderAt(SUNDAY_NOON, [
      { gameId: "sun", side: "home", isPow: true },
      { gameId: "mon", side: "home", isPow: false },
    ]);
    await screen.getByRole("button", { name: "POW: LAC at BAL" }).click();
    await at(SUNDAY_2PM);
    await expect
      .element(screen.getByRole("button", { name: "POW: KC at ATL" }))
      .toHaveAttribute("aria-pressed", "true");
    await screen.getByRole("button", { name: "Save picks" }).click();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ powGameId: "sun" }));
  });

  it("stops sending a pick or POW for a game the admin removed from the slate", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const sheet = (slate: Game[]) => (
      <PickSheet
        games={slate}
        picks={[]}
        tiebreakerGameId="mon"
        tiebreakerTotal={null}
        timeZone="America/New_York"
        now={WEDNESDAY}
        onSave={onSave}
      />
    );
    const screen = await render(sheet(games));
    await screen.getByRole("button", { name: "Chiefs -3.5" }).click();
    await screen.getByRole("button", { name: "POW: KC at ATL" }).click();
    await screen.getByRole("button", { name: "Ravens -4.5" }).click();
    await screen.rerender(sheet(games.filter((g) => g.id !== "sun")));
    await screen.getByRole("button", { name: "Save picks" }).click();
    expect(onSave).toHaveBeenCalledWith({
      picks: [{ gameId: "mon", side: "home" }],
      powGameId: null,
      tiebreakerTotal: null,
    });
  });

  it("leaves saved picks and unlocked changes alone as the clock moves on", async () => {
    const { screen, at } = await renderAt(SUNDAY_NOON);
    await screen.getByRole("button", { name: "Ravens -4.5" }).click();
    await at(SUNDAY_2PM);
    await expect
      .element(screen.getByRole("button", { name: "Ravens -4.5" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  });
});

describe("PickSheet", () => {
  it("opens a game's stats without touching the picks", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const loadInsights = vi.fn().mockResolvedValue({ matchup: null, market: null });
    const screen = await render(
      <PickSheet
        games={games}
        picks={[]}
        tiebreakerGameId="mon"
        tiebreakerTotal={null}
        timeZone="America/New_York"
        now={WEDNESDAY}
        onSave={onSave}
        loadInsights={loadInsights}
      />,
    );
    await screen.getByRole("button", { name: "Chiefs -3.5" }).click();
    await screen.getByRole("button", { name: "Matchup: KC at ATL" }).click();
    await expect.element(screen.getByRole("heading", { name: "Chiefs at Falcons" })).toBeVisible();
    expect(loadInsights).toHaveBeenCalledWith("sun");

    await screen.getByRole("button", { name: "Close" }).click();
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    await expect
      .element(screen.getByRole("button", { name: "Chiefs -3.5" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("offers no stats button when there is nowhere to load them from", async () => {
    const { screen } = await renderSheet();
    await expect.element(screen.getByRole("button", { name: /^Matchup:/ })).not.toBeInTheDocument();
  });

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
    // Every game has kicked off, so a player with no POW has none this week.
    const { screen } = await renderSheet({
      now: MONDAY_NIGHT,
      picks: ["thu", "sun", "mon"].map((gameId) => ({ gameId, side: "home" as const, isPow: false })),
      tiebreakerTotal: 44,
    });
    const status = screen.getByRole("region", { name: "Pick status" });
    await expect.element(status.getByText("You're set for the week")).toBeVisible();
    await expect.element(status.getByText(/No POW this week\./)).toBeVisible();
    await expect.element(screen.getByText("No POW this week: every game has locked.")).toBeVisible();
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

  it("says there is no automatic POW when none is chosen", async () => {
    const { screen } = await renderSheet();
    await expect.element(screen.getByText(/No POW chosen\..*you won't have one this week/)).toBeVisible();
  });

  it("on game day, takes a pick and the POW until kickoff, and locks games that kicked off", async () => {
    const { screen } = await renderSheet({ now: SUNDAY_7AM });
    // Thursday has been played.
    await expect.element(screen.getByRole("button", { name: "Giants -2.5" })).toBeDisabled();
    await expect.element(screen.getByRole("button", { name: "POW: WSH at NYG" })).toBeDisabled();
    // Sunday hasn't kicked off: it can be picked, and be the POW.
    await screen.getByRole("button", { name: "Chiefs -3.5" }).click();
    await expect.element(screen.getByRole("button", { name: "POW: KC at ATL" })).toBeEnabled();
    await screen.getByRole("button", { name: "Ravens -4.5" }).click();
    await expect.element(screen.getByRole("button", { name: "POW: LAC at BAL" })).toBeEnabled();
  });

  it("lets saved picks, a saved POW and the tiebreaker guess change until kickoff", async () => {
    const { screen } = await renderSheet({
      now: SUNDAY_7AM,
      picks: [
        { gameId: "sun", side: "home", isPow: true },
        { gameId: "mon", side: "home", isPow: false },
      ],
      tiebreakerTotal: 44,
    });
    await expect.element(screen.getByRole("button", { name: "Chiefs -3.5" })).toBeEnabled();
    await expect.element(screen.getByRole("button", { name: "POW: KC at ATL" })).toBeEnabled();
    await expect.element(screen.getByRole("button", { name: "POW: LAC at BAL" })).toBeEnabled();
    await expect.element(screen.getByLabelText(/Tiebreaker/)).toBeEnabled();
  });

  it("keeps the POW on its game once that game has kicked off", async () => {
    const { screen } = await renderSheet({
      now: SUNDAY_2PM,
      picks: [
        { gameId: "sun", side: "home", isPow: true },
        { gameId: "mon", side: "home", isPow: false },
      ],
    });
    await expect.element(screen.getByRole("button", { name: "Chiefs -3.5" })).toBeDisabled();
    await expect
      .element(screen.getByRole("button", { name: "Falcons +3.5" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect.element(screen.getByRole("button", { name: "POW: KC at ATL" })).toBeDisabled();
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
    await expect.element(screen.getByText("Won +3", { exact: true })).toBeVisible();
    // Thursday is untouched.
    await expect.element(screen.getByRole("button", { name: "Giants -2.5" })).toBeEnabled();
  });

  it("keeps a running score of the player's own picks as results come in", async () => {
    const picks: Pick[] = [
      { gameId: "thu", side: "home", isPow: true },
      { gameId: "sun", side: "away", isPow: false },
    ];
    const sheet = (withScores: Game[]) => (
      <PickSheet
        games={withScores}
        picks={picks}
        tiebreakerGameId="mon"
        tiebreakerTotal={null}
        timeZone="America/New_York"
        now={SUNDAY_2PM}
        onSave={vi.fn()}
      />
    );
    const scored = (scores: Record<string, [number, number]>) =>
      games.map((g) => {
        const score = scores[g.id];
        return score ? { ...g, homeScore: score[0], awayScore: score[1] } : g;
      });

    const screen = await render(sheet(games));
    // Nothing is in yet, so there is nothing to tally.
    await expect.element(screen.getByRole("region", { name: "Your week so far" })).not.toBeInTheDocument();

    // Thursday ends: NYG -2.5 wins by 7, and it was the POW.
    await screen.rerender(sheet(scored({ thu: [24, 17] })));
    const soFar = screen.getByRole("region", { name: "Your week so far" });
    await expect.element(screen.getByText("Won +8", { exact: true })).toBeVisible();
    await expect.element(soFar.getByText("8", { exact: true })).toBeVisible();
    await expect.element(soFar.getByText("1–0", { exact: true })).toBeVisible();
    await expect.element(soFar.getByText("Won", { exact: true })).toBeVisible();
    await expect.element(soFar.getByText("1 pick still to play")).toBeVisible();

    // A pick the player is making on Monday survives the refresh that brings Sunday's result.
    await screen.getByRole("button", { name: "Chargers +4.5" }).click();
    await screen.rerender(sheet(scored({ thu: [24, 17], sun: [10, 20] })));
    await expect.element(screen.getByText("Won +1", { exact: true })).toBeVisible();
    await expect.element(soFar.getByText("9", { exact: true })).toBeVisible();
    await expect.element(soFar.getByText("2–0", { exact: true })).toBeVisible();
    await expect.element(soFar.getByText("All your games are in")).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Chargers +4.5" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect.element(screen.getByText("Unsaved changes")).toBeVisible();
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
