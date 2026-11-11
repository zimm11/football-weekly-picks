import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { matchRoute, navigate, useLeaveGuard } from "./router";

let allowLeave: (() => void) | undefined;
const ask = (leave: () => void) => {
  allowLeave = leave;
};
function Guarded({ active }: { active: boolean }) {
  useLeaveGuard(active, ask);
  return null;
}

describe("useLeaveGuard", () => {
  it("holds navigation until the screen lets it go", async () => {
    const start = window.location.pathname;
    const screen = await render(<Guarded active />);

    navigate("/leagues/abc/results");
    expect(window.location.pathname).toBe(start);

    allowLeave?.();
    expect(window.location.pathname).toBe("/leagues/abc/results");

    // Once nothing is unsaved, navigation goes straight through.
    await screen.rerender(<Guarded active={false} />);
    navigate("/leagues/abc/standings");
    expect(window.location.pathname).toBe("/leagues/abc/standings");
    window.history.replaceState(null, "", start);
  });
});

describe("matchRoute", () => {
  it("opens the login page directly", () => {
    expect(matchRoute("/login")).toEqual({ page: "login" });
    expect(matchRoute("/login/unknown")).toEqual({ page: "not-found" });
  });

  it("gives the public guide its own address", () => {
    expect(matchRoute("/how-to-play")).toEqual({ page: "how-to-play" });
    expect(matchRoute("/how-to-play/unknown")).toEqual({ page: "not-found" });
  });

  it("opens a league on its Picks tab", () => {
    expect(matchRoute("/leagues/abc")).toEqual({ page: "league", leagueId: "abc", tab: "picks" });
  });

  it("gives each league tab its own address", () => {
    for (const tab of ["results", "standings", "league"] as const) {
      expect(matchRoute(`/leagues/abc/${tab}`)).toEqual({ page: "league", leagueId: "abc", tab });
    }
  });

  it("keeps week and invite addresses", () => {
    expect(matchRoute("/weeks/w1")).toEqual({ page: "week", weekId: "w1" });
    expect(matchRoute("/weeks/w1/manage")).toEqual({ page: "manage-week", weekId: "w1" });
    expect(matchRoute("/join/code")).toEqual({ page: "join", code: "code" });
  });

  it("rejects addresses it doesn't know", () => {
    expect(matchRoute("/leagues/abc/nope")).toEqual({ page: "not-found" });
    expect(matchRoute("/weeks/w1/nope")).toEqual({ page: "not-found" });
  });
});
