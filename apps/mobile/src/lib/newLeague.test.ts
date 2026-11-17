import { describe, expect, it } from "vitest";
import {
  chooseType,
  copyableLeagues,
  initialDraft,
  newLeagueBody,
  skippedNotice,
  typeChoices,
} from "./newLeague";

describe("New league", () => {
  it("starts on weekly pick'em, run Automatic", () => {
    expect(initialDraft("America/Chicago")).toMatchObject({ type: "weekly", management: "auto" });
  });

  it("offers all four types, weekly first", () => {
    expect(typeChoices()).toEqual(["weekly", "playoff", "squares", "survivor"]);
  });

  it("runs the types other than weekly automatically", () => {
    const draft = initialDraft("UTC");
    expect(chooseType(draft, "survivor").management).toBe("auto");
    expect(chooseType(chooseType(draft, "squares"), "weekly").management).toBe("auto");
  });

  it("sends the type's settings and the league to copy members from", () => {
    const draft = { ...initialDraft("UTC"), name: "Crew" };
    expect(newLeagueBody(draft)).toEqual({
      name: "Crew",
      timeZone: "UTC",
      type: "weekly",
      management: "auto",
    });
    expect(newLeagueBody({ ...chooseType(draft, "playoff"), format: "guillotine" })).toMatchObject({
      type: "playoff",
      settings: { format: "guillotine" },
    });
    expect(newLeagueBody({ ...chooseType(draft, "survivor"), lives: 2 })).toMatchObject({
      settings: { lives: 2 },
    });
    expect(newLeagueBody({ ...chooseType(draft, "survivor"), startWeek: 5 }).settings).toEqual({
      lives: 1,
      startWeek: 5,
    });
    expect(newLeagueBody({ ...draft, copyMembersFrom: "league-1" })).toMatchObject({
      copyMembersFrom: "league-1",
    });
  });

  it("offers only the leagues the player is an admin of to copy members from", () => {
    const league = (id: string, role: "admin" | "member") =>
      ({ id, name: id, role, type: "weekly", management: "manual" }) as const;
    expect(copyableLeagues([league("a", "admin"), league("b", "member")]).map((l) => l.id)).toEqual(["a"]);
  });

  it("names the members who couldn't be copied in", () => {
    expect(skippedNotice({ skipped: [] }, 25)).toBeNull();
    expect(
      skippedNotice(
        {
          skipped: [
            { userId: "1", displayName: "Pat", reason: "player_limit" },
            { userId: "2", displayName: "Sam", reason: "player_limit" },
            { userId: "3", displayName: "Alex", reason: "league_full" },
          ],
        },
        25,
      ),
    ).toBe(
      "League created. Not added: Pat and Sam are already in 25 leagues; Alex didn't fit: the league is full.",
    );
  });
});
