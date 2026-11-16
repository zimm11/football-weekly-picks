import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { Link, matchRoute, navigate, useLeaveGuard } from "./router";

let allowLeave: (() => void) | undefined;
const ask = (leave: () => void) => {
  allowLeave = leave;
};
/** Through a function, so TypeScript doesn't conclude the guard can never have been asked. */
const forgetAsked = () => {
  allowLeave = undefined;
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

describe("leaving by the browser's back button", () => {
  it("stays put until the player agrees, without the screen ever seeing the step", async () => {
    const start = window.location.pathname;
    navigate("/leagues/abc");
    navigate("/leagues/abc/results");
    forgetAsked();
    const screen = await render(<Guarded active />);
    const seen: string[] = [];
    // Only the browser's own steps: `navigate` announces the two changes above a frame later, on its own.
    const listener = (event: PopStateEvent) => {
      if (event.isTrusted) seen.push(window.location.pathname);
    };
    window.addEventListener("popstate", listener);
    try {
      window.history.back();
      // Asked, and back on the screen with the unsaved work.
      await vi.waitFor(() => expect(allowLeave).toBeDefined());
      await vi.waitFor(() => expect(window.location.pathname).toBe("/leagues/abc/results"));
      expect(seen).toEqual([]);

      allowLeave?.();
      await vi.waitFor(() => expect(window.location.pathname).toBe("/leagues/abc"));
      expect(seen).toEqual(["/leagues/abc"]);
    } finally {
      window.removeEventListener("popstate", listener);
      await screen.unmount();
      window.history.replaceState(null, "", start);
    }
  });

  it("goes straight back when nothing is unsaved", async () => {
    const start = window.location.pathname;
    navigate("/leagues/abc");
    navigate("/leagues/abc/standings");
    window.history.back();
    await vi.waitFor(() => expect(window.location.pathname).toBe("/leagues/abc"));
    window.history.replaceState(null, "", start);
  });
});

let allowOther: (() => void) | undefined;
const askOther = (leave: () => void) => {
  allowOther = leave;
};
/** Two parts of one screen, each with its own unsaved work. */
function Two({ first }: { first: boolean }) {
  useLeaveGuard(first, ask);
  useLeaveGuard(true, askOther);
  return null;
}

describe("several guards on one screen", () => {
  it("keeps asking while any part still has unsaved work", async () => {
    const start = window.location.pathname;
    forgetAsked();
    const screen = await render(<Two first />);
    // The first part is saved; the second still holds the screen.
    await screen.rerender(<Two first={false} />);
    navigate("/leagues/abc/league");
    expect(window.location.pathname).toBe(start);
    expect(allowLeave).toBeUndefined();
    allowOther?.();
    expect(window.location.pathname).toBe("/leagues/abc/league");
    await screen.unmount();
    window.history.replaceState(null, "", start);
  });
});

describe("Link", () => {
  it("runs its own onClick before routing, without reloading the page", async () => {
    const start = window.location.pathname;
    const onClick = vi.fn();
    const screen = await render(
      <Link to="/weeks/w1" onClick={onClick}>
        See everyone's picks
      </Link>,
    );
    await screen.getByRole("link", { name: "See everyone's picks" }).click();
    expect(onClick).toHaveBeenCalledOnce();
    expect(window.location.pathname).toBe("/weeks/w1");
    window.history.replaceState(null, "", start);
  });

  it("stays put when its onClick prevents the default", async () => {
    const start = window.location.pathname;
    const screen = await render(
      <Link to="/weeks/w2" onClick={(e) => e.preventDefault()}>
        Stay
      </Link>,
    );
    await screen.getByRole("link", { name: "Stay" }).click();
    expect(window.location.pathname).toBe(start);
  });
});

describe("matchRoute", () => {
  it("opens feedback and operator pages without accepting extra segments", () => {
    for (const page of ["feedback", "operator"]) {
      expect(matchRoute(`/${page}`)).toEqual({ page });
      expect(matchRoute(`/${page}/unknown`)).toEqual({ page: "not-found" });
    }
  });
  it("opens the login page directly", () => {
    expect(matchRoute("/login")).toEqual({ page: "login" });
    expect(matchRoute("/login/unknown")).toEqual({ page: "not-found" });
  });

  it("opens the password reset page", () => {
    expect(matchRoute("/reset-password")).toEqual({ page: "reset-password" });
    expect(matchRoute("/reset-password/unknown")).toEqual({ page: "not-found" });
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
