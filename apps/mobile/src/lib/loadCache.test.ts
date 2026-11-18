import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLoadCache,
  dropLoadCache,
  loadCacheGeneration,
  readLoadCache,
  writeLoadCache,
} from "./loadCache";

beforeEach(() => clearLoadCache());

describe("the screen load cache", () => {
  it("returns what was stored under a key, and nothing for another key", () => {
    writeLoadCache("/leagues/a", { name: "Sunday Crew" });
    expect(readLoadCache("/leagues/a")).toEqual({ name: "Sunday Crew" });
    expect(readLoadCache("/leagues/b")).toBeUndefined();
  });

  it("keeps values that are falsy but real, and forgets a key set to undefined", () => {
    writeLoadCache("count", 0);
    writeLoadCache("nothing", null);
    expect(readLoadCache("count")).toBe(0);
    expect(readLoadCache("nothing")).toBeNull();
    writeLoadCache("count", undefined);
    expect(readLoadCache("count")).toBeUndefined();
  });

  it("is empty after a clear, so the next player never sees the last one's data", () => {
    writeLoadCache("/leagues/a", { name: "Sunday Crew" });
    clearLoadCache();
    expect(readLoadCache("/leagues/a")).toBeUndefined();
  });

  it("drops a value whose request started before the cache was cleared", () => {
    const started = loadCacheGeneration();
    clearLoadCache();
    writeLoadCache("/leagues/a", { name: "Sunday Crew" }, started);
    expect(readLoadCache("/leagues/a")).toBeUndefined();
    writeLoadCache("/leagues/a", { name: "Mine" }, loadCacheGeneration());
    expect(readLoadCache("/leagues/a")).toEqual({ name: "Mine" });
  });

  it("forgets one key on request", () => {
    writeLoadCache("a", 1);
    writeLoadCache("b", 2);
    dropLoadCache("a");
    expect(readLoadCache("a")).toBeUndefined();
    expect(readLoadCache("b")).toBe(2);
  });

  it("keeps only the 50 most recently used values", () => {
    for (let n = 0; n < 50; n++) writeLoadCache(`key-${n}`, n);
    // Reading the oldest makes it the newest, so the next write pushes out key-1 instead.
    expect(readLoadCache("key-0")).toBe(0);
    writeLoadCache("key-50", 50);
    expect(readLoadCache("key-0")).toBe(0);
    expect(readLoadCache("key-1")).toBeUndefined();
    expect(readLoadCache("key-2")).toBe(2);
    expect(readLoadCache("key-50")).toBe(50);
  });
});
