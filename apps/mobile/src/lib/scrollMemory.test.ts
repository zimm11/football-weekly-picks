import { describe, expect, it } from "vitest";
import {
  createScrollMemory,
  notePop,
  offsetToRestore,
  POP_WINDOW_MS,
  rememberOffset,
  scrollKey,
} from "./scrollMemory";

describe("scroll memory", () => {
  it("restores an entry's offset only when Back or Forward just reached it", () => {
    const memory = createScrollMemory();
    rememberOffset(memory, scrollKey("a", "page"), 640);
    // Opened fresh: no pop was seen.
    expect(offsetToRestore(memory, "a", "page", 1000)).toBeUndefined();
    notePop(memory, "a", 1000);
    expect(offsetToRestore(memory, "a", "page", 1010)).toBe(640);
    // Another scroll view on the same screen has its own offset.
    expect(offsetToRestore(memory, "a", "table", 1010)).toBeUndefined();
    // A different entry (a new push after the pop) starts at the top.
    expect(offsetToRestore(memory, "b", "page", 1010)).toBeUndefined();
  });

  it("ignores a pop that happened too long before the screen mounted", () => {
    const memory = createScrollMemory();
    rememberOffset(memory, scrollKey("a", "page"), 300);
    notePop(memory, "a", 1000);
    expect(offsetToRestore(memory, "a", "page", 1000 + POP_WINDOW_MS + 1)).toBeUndefined();
  });

  it("forgets an entry scrolled back to the top, and a pop to an entry without an id", () => {
    const memory = createScrollMemory();
    rememberOffset(memory, scrollKey("a", "page"), 300);
    rememberOffset(memory, scrollKey("a", "page"), 0);
    notePop(memory, "a", 0);
    expect(offsetToRestore(memory, "a", "page", 1)).toBeUndefined();
    notePop(memory, undefined, 2);
    expect(memory.popped).toBeUndefined();
  });

  it("keeps the 100 most recently scrolled entries", () => {
    const memory = createScrollMemory();
    for (let n = 0; n <= 100; n++) rememberOffset(memory, scrollKey(`e${n}`, "page"), n + 1);
    expect(memory.offsets.size).toBe(100);
    expect(memory.offsets.has(scrollKey("e0", "page"))).toBe(false);
    expect(memory.offsets.get(scrollKey("e100", "page"))).toBe(101);
  });
});
