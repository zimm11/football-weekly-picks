import { afterEach, describe, expect, it, vi } from "vitest";
import { readSeason, rememberSeason } from "./seasonSelection";

describe("season selection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("remembers a choice per league for the session", () => {
    rememberSeason("league-a", 2027);
    expect(readSeason("league-a")).toBe(2027);
    expect(readSeason("league-b")).toBeUndefined();
  });

  it("reads the browser's session storage after a reload, ignoring values that aren't seasons", () => {
    const stored = new Map<string, string>([
      ["picks:season:reloaded", "2025"],
      ["picks:season:garbage", "abc"],
      ["picks:season:ancient", "1999"],
    ]);
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: () => {} });
    expect(readSeason("reloaded")).toBe(2025);
    expect(readSeason("garbage")).toBeUndefined();
    expect(readSeason("ancient")).toBeUndefined();
  });

  it("still works when storage is blocked", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    rememberSeason("blocked", 2026);
    expect(readSeason("blocked")).toBe(2026);
  });
});
