import { describe, expect, it } from "vitest";
import { postActions, postPlaceholder } from "./moderation";

const visible = { state: "visible" as const, mine: false, canAppeal: false };

describe("postActions", () => {
  it("lets anyone report and block someone else's message", () => {
    expect(postActions(visible, { canModerate: false, blockedAuthor: false })).toEqual(["report", "block"]);
    expect(postActions(visible, { canModerate: false, blockedAuthor: true })).toEqual(["report", "unblock"]);
  });

  it("gives admins remove, and restore once removed", () => {
    expect(postActions(visible, { canModerate: true, blockedAuthor: false })).toEqual([
      "report",
      "block",
      "remove",
    ]);
    expect(
      postActions({ ...visible, state: "removed" }, { canModerate: true, blockedAuthor: false }),
    ).toEqual(["block", "restore"]);
  });

  it("never offers reporting or blocking yourself; an author may appeal a removal once", () => {
    const mine = { ...visible, mine: true };
    expect(postActions(mine, { canModerate: false, blockedAuthor: false })).toEqual([]);
    expect(
      postActions(
        { ...mine, state: "removed", canAppeal: true },
        { canModerate: false, blockedAuthor: false },
      ),
    ).toEqual(["appeal"]);
    expect(
      postActions(
        { ...mine, state: "removed", canAppeal: false },
        { canModerate: false, blockedAuthor: false },
      ),
    ).toEqual([]);
  });
});

describe("postPlaceholder", () => {
  it("stands in for removed and hidden messages, and collapses a blocked player's until shown", () => {
    expect(postPlaceholder("removed", true)).toEqual({ text: "Message removed", canShow: false });
    expect(postPlaceholder("hidden", false)?.text).toBe("Hidden while it's reviewed");
    expect(postPlaceholder("blocked", false)).toEqual({
      text: "Message from a blocked player",
      canShow: true,
    });
    expect(postPlaceholder("blocked", true)).toBeNull();
    expect(postPlaceholder("visible", false)).toBeNull();
    expect(postPlaceholder("review", false)).toBeNull();
    // An admin may show a hidden message to review it.
    expect(postPlaceholder("hidden", false, true)?.canShow).toBe(true);
    expect(postPlaceholder("hidden", true, true)).toBeNull();
  });
});
